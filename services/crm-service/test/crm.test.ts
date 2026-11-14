import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import express from "express";
import request from "supertest";
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it
} from "vitest";

const CHAVE = { "x-internal-key": "chave-de-teste" };

// ERP falso, em memória: cria um pedido por oportunidade (idempotente).
const erp = {
    pedidos: new Map<number, { clienteNome: string; valorTotal: string }>(),
    chamadas: 0,
    fora: false
};

function criarErpFalso() {
    const fake = express();
    fake.use(express.json());

    fake.post("/integracoes/crm/oportunidades", (req, res) => {
        erp.chamadas++;

        if (erp.fora) {
            return res.status(503).json({ erro: "fora do ar" });
        }

        if (erp.pedidos.has(req.body.oportunidadeId)) {
            return res.status(200).json({ mensagem: "já existe" });
        }

        erp.pedidos.set(req.body.oportunidadeId, {
            clienteNome: req.body.clienteNome,
            valorTotal: req.body.valorTotal
        });

        return res.status(201).json({ mensagem: "criado" });
    });

    return fake;
}

let erpServidor: Server;
let servidor: Server;
let prisma: typeof import("../src/config/prisma.js").prisma;
let processarOutbox: typeof import("../src/lib/outbox.js").processarOutbox;

beforeAll(async () => {
    erpServidor = criarErpFalso().listen(0);
    const { port } = erpServidor.address() as AddressInfo;

    process.env.ERP_SERVICE_URL = `http://127.0.0.1:${port}`;

    const modulo = await import("../src/app.js");
    prisma = (await import("../src/config/prisma.js")).prisma;
    processarOutbox = (await import("../src/lib/outbox.js")).processarOutbox;

    servidor = modulo.app.listen(0);
});

afterAll(async () => {
    servidor.close();
    erpServidor.close();
    await prisma.$disconnect();
});

beforeEach(async () => {
    erp.pedidos.clear();
    erp.chamadas = 0;
    erp.fora = false;

    await prisma.$executeRawUnsafe(`
        TRUNCATE "Cliente", "Lead", "Oportunidade", "EventoOutbox", "ChaveIdempotencia"
        RESTART IDENTITY CASCADE
    `);
});

const api = () => request(servidor);

async function criarOportunidade(dados: Record<string, unknown> = {}) {
    const resposta = await api()
        .post("/oportunidades")
        .set(CHAVE)
        .send({ titulo: "Projeto", cliente: "ACME", valor: "1500.00", ...dados });

    expect(resposta.status).toBe(201);

    return resposta.body.oportunidade as { id: number; versao: number };
}

describe("conversão de lead", () => {
    it("conversões simultâneas criam uma única oportunidade", async () => {
        const lead = await api().post("/leads").set(CHAVE).send({ nome: "Maria" });

        const respostas = await Promise.all(
            Array.from({ length: 6 }, () =>
                api()
                    .post(`/leads/${lead.body.lead.id}/converter`)
                    .set(CHAVE)
                    .send({ titulo: "Oportunidade da Maria", valor: 1000 })
            )
        );

        expect(respostas.filter((r) => r.status === 201)).toHaveLength(1);
        expect(respostas.filter((r) => r.status === 409)).toHaveLength(5);
        expect(await prisma.oportunidade.count()).toBe(1);
    });
});

describe("Idempotency-Key nos cadastros", () => {
    it("POST /clientes com a mesma chave cria um único cliente", async () => {
        const enviar = () =>
            api()
                .post("/clientes")
                .set(CHAVE)
                .set("x-usuario-id", "1")
                .set("Idempotency-Key", "cli-1")
                .send({ nome: "João" });

        const simultaneas = await Promise.all(Array.from({ length: 4 }, enviar));
        expect(simultaneas.every((r) => r.status === 201 || r.status === 409)).toBe(true);

        const repetida = await enviar();
        expect(repetida.status).toBe(201);
        expect(repetida.headers["idempotent-replayed"]).toBe("true");

        expect(await prisma.cliente.count()).toBe(1);
    });

    it("POST /leads e /oportunidades com a mesma chave não duplicam", async () => {
        for (const [caminho, corpo] of [
            ["/leads", { nome: "Lead" }],
            ["/oportunidades", { titulo: "Op", valor: 10 }]
        ] as const) {
            for (let i = 0; i < 3; i++) {
                const resposta = await api()
                    .post(caminho)
                    .set(CHAVE)
                    .set("Idempotency-Key", `chave${caminho}`)
                    .send(corpo);

                expect(resposta.status).toBe(201);
            }
        }

        expect(await prisma.lead.count()).toBe(1);
        expect(await prisma.oportunidade.count()).toBe(1);
    });

    it("a mesma chave com outro corpo responde 422", async () => {
        await api().post("/clientes").set(CHAVE).set("Idempotency-Key", "k").send({ nome: "A" });
        const outra = await api().post("/clientes").set(CHAVE).set("Idempotency-Key", "k").send({ nome: "B" });

        expect(outra.status).toBe(422);
        expect(await prisma.cliente.count()).toBe(1);
    });

    it("erros de validação não consomem a chave com outro resultado", async () => {
        const invalida = await api().post("/clientes").set(CHAVE).set("Idempotency-Key", "v").send({});
        const repetida = await api().post("/clientes").set(CHAVE).set("Idempotency-Key", "v").send({});

        expect(invalida.status).toBe(400);
        expect(repetida.status).toBe(400);
        expect(repetida.headers["idempotent-replayed"]).toBe("true");
    });
});

describe("e-mail duplicado", () => {
    it("cadastros simultâneos com o mesmo e-mail: um 201 e o resto 409", async () => {
        const respostas = await Promise.all(
            Array.from({ length: 5 }, (_, i) =>
                api().post("/clientes").set(CHAVE).send({ nome: `C${i}`, email: "a@b.com" })
            )
        );

        expect(respostas.filter((r) => r.status === 201)).toHaveLength(1);
        expect(respostas.filter((r) => r.status === 409)).toHaveLength(4);
    });

    it("atualizar para um e-mail já usado responde 409 e cliente inexistente 404", async () => {
        await api().post("/clientes").set(CHAVE).send({ nome: "A", email: "a@b.com" });
        const b = await api().post("/clientes").set(CHAVE).send({ nome: "B", email: "b@b.com" });

        const duplicado = await api().put(`/clientes/${b.body.cliente.id}`).set(CHAVE).send({ email: "a@b.com" });
        const inexistente = await api().put("/clientes/999").set(CHAVE).send({ nome: "X" });

        expect(duplicado.status).toBe(409);
        expect(inexistente.status).toBe(404);
    });
});

describe("edição de oportunidade (concorrência otimista)", () => {
    it("edição com versão antiga responde 409 e não sobrescreve", async () => {
        const op = await criarOportunidade();

        const primeira = await api().put(`/oportunidades/${op.id}`).set(CHAVE)
            .send({ titulo: "Título A", versao: op.versao });
        const atrasada = await api().put(`/oportunidades/${op.id}`).set(CHAVE)
            .send({ titulo: "Título B", versao: op.versao });

        expect(primeira.status).toBe(200);
        expect(primeira.body.oportunidade.versao).toBe(op.versao + 1);
        expect(atrasada.status).toBe(409);

        const final = await prisma.oportunidade.findUniqueOrThrow({ where: { id: op.id } });
        expect(final.titulo).toBe("Título A");
    });

    it("edições simultâneas da mesma versão: só uma vence", async () => {
        const op = await criarOportunidade();

        const respostas = await Promise.all(
            Array.from({ length: 5 }, (_, i) =>
                api().put(`/oportunidades/${op.id}`).set(CHAVE)
                    .send({ observacoes: `edição ${i}`, versao: op.versao })
            )
        );

        expect(respostas.filter((r) => r.status === 200)).toHaveLength(1);
        expect(respostas.filter((r) => r.status === 409)).toHaveLength(4);
    });
});

describe("oportunidade ganha", () => {
    it("gera um único pedido no ERP, mesmo com PUTs simultâneos", async () => {
        const op = await criarOportunidade();

        const respostas = await Promise.all(
            Array.from({ length: 4 }, () =>
                api().put(`/oportunidades/${op.id}`).set(CHAVE).send({ status: "GANHA" })
            )
        );

        expect(respostas.some((r) => r.status === 200)).toBe(true);
        expect(await prisma.eventoOutbox.count()).toBe(1);
        expect(erp.pedidos.get(op.id)).toEqual({ clienteNome: "ACME", valorTotal: "1500" });
    });

    it("com o ERP fora, a oportunidade é ganha e o pedido sai depois pelo relay", async () => {
        const op = await criarOportunidade();
        erp.fora = true;

        const resposta = await api().put(`/oportunidades/${op.id}`).set(CHAVE).send({ status: "GANHA" });

        expect(resposta.status).toBe(200);
        expect(resposta.body.oportunidade.status).toBe("GANHA");
        expect(erp.pedidos.size).toBe(0);

        erp.fora = false;
        await prisma.eventoOutbox.updateMany({ data: { proximaTentativaEm: new Date(0) } });
        await processarOutbox();

        expect(erp.pedidos.has(op.id)).toBe(true);
    });

    it("GANHA é definitiva: não volta de status nem muda o valor", async () => {
        const op = await criarOportunidade();
        await api().put(`/oportunidades/${op.id}`).set(CHAVE).send({ status: "GANHA" });

        const voltar = await api().put(`/oportunidades/${op.id}`).set(CHAVE).send({ status: "ABERTA" });
        const valor = await api().put(`/oportunidades/${op.id}`).set(CHAVE).send({ valor: 1 });
        const obs = await api().put(`/oportunidades/${op.id}`).set(CHAVE).send({ observacoes: "ok" });

        expect(voltar.status).toBe(409);
        expect(valor.status).toBe(409);
        expect(obs.status).toBe(200);
        expect(await prisma.eventoOutbox.count()).toBe(1);
    });

    it("exige cliente para marcar como ganha", async () => {
        const op = await criarOportunidade({ cliente: "" });

        const resposta = await api().put(`/oportunidades/${op.id}`).set(CHAVE).send({ status: "GANHA" });

        expect(resposta.status).toBe(400);
        expect(await prisma.eventoOutbox.count()).toBe(0);
    });
});
