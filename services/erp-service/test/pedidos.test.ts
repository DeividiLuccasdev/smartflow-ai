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

// Financeiro falso, em memória, com o mesmo contrato do finance-service:
// criação idempotente por pedidoId e cancelamento atômico (409 se paga).
type Conta = { pedidoId: number; valor: string; status: "PENDENTE" | "PAGO" | "CANCELADO" };

const financeiro = {
    contas: new Map<number, Conta>(),
    fora: false,
    chamadasCriacao: 0
};

function criarFinanceiroFalso() {
    const fake = express();
    fake.use(express.json());

    fake.use((_req, res, next) => {
        if (financeiro.fora) {
            return res.status(503).json({ erro: "fora do ar" });
        }

        next();
    });

    fake.post("/integracoes/erp/pedidos", (req, res) => {
        financeiro.chamadasCriacao++;

        const existente = financeiro.contas.get(req.body.pedidoId);

        if (existente) {
            return res.status(200).json({ conta: existente });
        }

        const conta: Conta = {
            pedidoId: req.body.pedidoId,
            valor: req.body.valor,
            status: "PENDENTE"
        };

        financeiro.contas.set(conta.pedidoId, conta);

        return res.status(201).json({ conta });
    });

    fake.post("/integracoes/erp/pedidos/:pedidoId/cancelar", (req, res) => {
        const conta = financeiro.contas.get(Number(req.params.pedidoId));

        if (!conta) {
            return res.status(200).json({ mensagem: "sem conta" });
        }

        if (conta.status === "PAGO") {
            return res.status(409).json({ erro: "paga" });
        }

        conta.status = "CANCELADO";

        return res.status(200).json({ conta });
    });

    return fake;
}

let financeiroServidor: Server;
let servidor: Server;
let prisma: typeof import("../src/config/prisma.js").prisma;
let processarOutbox: typeof import("../src/lib/outbox.js").processarOutbox;

beforeAll(async () => {
    financeiroServidor = criarFinanceiroFalso().listen(0);
    const { port } = financeiroServidor.address() as AddressInfo;

    // O app lê FINANCE_SERVICE_URL ao ser carregado
    process.env.FINANCE_SERVICE_URL = `http://127.0.0.1:${port}`;

    const modulo = await import("../src/app.js");
    prisma = (await import("../src/config/prisma.js")).prisma;
    processarOutbox = (await import("../src/lib/outbox.js")).processarOutbox;

    servidor = modulo.app.listen(0);
});

afterAll(async () => {
    servidor.close();
    financeiroServidor.close();
    await prisma.$disconnect();
});

beforeEach(async () => {
    financeiro.contas.clear();
    financeiro.fora = false;
    financeiro.chamadasCriacao = 0;

    await prisma.$executeRawUnsafe(`
        TRUNCATE "ItemPedido", "Pedido", "Produto", "EventoOutbox", "ChaveIdempotencia"
        RESTART IDENTITY CASCADE
    `);
});

const api = () => request(servidor);

async function criarProduto(estoque = 10, preco: string | number = "25.00", sku = "SKU-1") {
    const resposta = await api()
        .post("/produtos")
        .set(CHAVE)
        .send({ nome: "Produto", sku, preco, estoque });

    expect(resposta.status).toBe(201);

    return resposta.body.produto as { id: number };
}

async function criarPedido(produtoId: number, quantidade = 3) {
    const resposta = await api()
        .post("/pedidos")
        .set(CHAVE)
        .send({ clienteNome: "Cliente", itens: [{ produtoId, quantidade }] });

    expect(resposta.status).toBe(201);

    return resposta.body.pedido as { id: number };
}

async function estoqueDe(produtoId: number) {
    const produto = await prisma.produto.findUniqueOrThrow({
        where: { id: produtoId }
    });

    return produto.estoque;
}

describe("cancelamento de pedido", () => {
    it("cancelamentos simultâneos devolvem o estoque uma única vez", async () => {
        const produto = await criarProduto(10);
        const pedido = await criarPedido(produto.id, 3);

        expect(await estoqueDe(produto.id)).toBe(7);

        const respostas = await Promise.all(
            Array.from({ length: 6 }, () =>
                api().post(`/pedidos/${pedido.id}/cancelar`).set(CHAVE)
            )
        );

        expect(respostas.every((r) => r.status === 200)).toBe(true);
        expect(
            respostas.filter((r) => r.body.mensagem?.startsWith("Pedido cancelado e estoque devolvido"))
        ).toHaveLength(1);
        expect(await estoqueDe(produto.id)).toBe(10);
    });

    it("cancelamentos simultâneos de pedido confirmado também devolvem uma vez", async () => {
        const produto = await criarProduto(10);
        const pedido = await criarPedido(produto.id, 4);

        await api().post(`/pedidos/${pedido.id}/confirmar`).set(CHAVE);

        await Promise.all(
            Array.from({ length: 6 }, () =>
                api().post(`/pedidos/${pedido.id}/cancelar`).set(CHAVE)
            )
        );

        expect(await estoqueDe(produto.id)).toBe(10);
        expect(financeiro.contas.get(pedido.id)?.status).toBe("CANCELADO");
    });

    it("não cancela pedido cuja conta já foi paga", async () => {
        const produto = await criarProduto(10);
        const pedido = await criarPedido(produto.id, 2);

        await api().post(`/pedidos/${pedido.id}/confirmar`).set(CHAVE);
        financeiro.contas.get(pedido.id)!.status = "PAGO";

        const resposta = await api().post(`/pedidos/${pedido.id}/cancelar`).set(CHAVE);

        expect(resposta.status).toBe(409);
        expect(await estoqueDe(produto.id)).toBe(8);

        const final = await prisma.pedido.findUniqueOrThrow({ where: { id: pedido.id } });
        expect(final.status).toBe("CONFIRMADO");
    });
});

describe("confirmar x cancelar", () => {
    it("com as duas operações ao mesmo tempo, o estado final é consistente", async () => {
        const produto = await criarProduto(1000);

        for (let rodada = 0; rodada < 10; rodada++) {
            const pedido = await criarPedido(produto.id, 1);

            const [confirmar, cancelar] = await Promise.all([
                api().post(`/pedidos/${pedido.id}/confirmar`).set(CHAVE),
                api().post(`/pedidos/${pedido.id}/cancelar`).set(CHAVE)
            ]);

            // Entrega qualquer evento que ainda esteja no outbox
            await processarOutbox();

            const final = await prisma.pedido.findUniqueOrThrow({ where: { id: pedido.id } });
            const conta = financeiro.contas.get(pedido.id);

            expect(cancelar.status).toBe(200);
            expect(final.status).toBe("CANCELADO");

            // Pedido cancelado nunca fica com conta a receber em aberto
            expect(conta === undefined || conta.status === "CANCELADO").toBe(true);

            if (confirmar.status === 200) {
                // Confirmou antes: a conta foi criada e depois cancelada
                expect(conta?.status).toBe("CANCELADO");
            } else {
                expect(confirmar.status).toBe(409);
                expect(conta).toBeUndefined();
            }
        }

        // Todo o estoque voltou: cada pedido foi devolvido exatamente uma vez
        expect(await estoqueDe(produto.id)).toBe(1000);
    });

    it("confirmar duas vezes cria uma única conta a receber", async () => {
        const produto = await criarProduto(10);
        const pedido = await criarPedido(produto.id, 1);

        const respostas = await Promise.all(
            Array.from({ length: 5 }, () =>
                api().post(`/pedidos/${pedido.id}/confirmar`).set(CHAVE)
            )
        );

        expect(respostas.every((r) => r.status === 200)).toBe(true);
        expect(await prisma.eventoOutbox.count()).toBe(1);
        expect(financeiro.contas.size).toBe(1);
    });
});

describe("outbox ERP → Financeiro", () => {
    it("com o Financeiro fora do ar, a conta é criada depois pelo relay", async () => {
        const produto = await criarProduto(10, "19.90");
        const pedido = await criarPedido(produto.id, 2);

        financeiro.fora = true;

        const confirmar = await api().post(`/pedidos/${pedido.id}/confirmar`).set(CHAVE);

        expect(confirmar.status).toBe(200);
        expect(confirmar.body.pedido.status).toBe("CONFIRMADO");
        expect(financeiro.contas.size).toBe(0);

        const evento = await prisma.eventoOutbox.findFirstOrThrow();
        expect(evento.enviadoEm).toBeNull();
        expect(evento.tentativas).toBe(1);

        // Volta do ar: o relay entrega (ignorando a espera, para o teste)
        financeiro.fora = false;
        await prisma.eventoOutbox.updateMany({ data: { proximaTentativaEm: new Date(0) } });
        await processarOutbox();

        expect(financeiro.contas.get(pedido.id)).toMatchObject({
            valor: "39.8",
            status: "PENDENTE"
        });

        const entregue = await prisma.eventoOutbox.findFirstOrThrow();
        expect(entregue.enviadoEm).not.toBeNull();
    });

    it("cancelar com evento pendente e Financeiro fora responde 503 sem alterar nada", async () => {
        const produto = await criarProduto(10);
        const pedido = await criarPedido(produto.id, 2);

        financeiro.fora = true;
        await api().post(`/pedidos/${pedido.id}/confirmar`).set(CHAVE);

        const cancelar = await api().post(`/pedidos/${pedido.id}/cancelar`).set(CHAVE);

        expect(cancelar.status).toBe(503);
        expect(await estoqueDe(produto.id)).toBe(8);
    });
});

describe("Idempotency-Key em POST /pedidos", () => {
    it("a mesma chave enviada várias vezes cria um único pedido", async () => {
        const produto = await criarProduto(10);
        const corpo = { clienteNome: "Cliente", itens: [{ produtoId: produto.id, quantidade: 2 }] };

        const respostas = await Promise.all(
            Array.from({ length: 5 }, () =>
                api()
                    .post("/pedidos")
                    .set(CHAVE)
                    .set("x-usuario-id", "1")
                    .set("Idempotency-Key", "chave-123")
                    .send(corpo)
            )
        );

        // Uma cria; as simultâneas recebem 409 (em processamento) ou a resposta guardada
        expect(respostas.every((r) => r.status === 201 || r.status === 409)).toBe(true);

        const repetida = await api()
            .post("/pedidos")
            .set(CHAVE)
            .set("x-usuario-id", "1")
            .set("Idempotency-Key", "chave-123")
            .send(corpo);

        expect(repetida.status).toBe(201);
        expect(repetida.headers["idempotent-replayed"]).toBe("true");

        const primeira = respostas.find((r) => r.status === 201)!;
        expect(repetida.body.pedido.id).toBe(primeira.body.pedido.id);

        expect(await prisma.pedido.count()).toBe(1);
        expect(await estoqueDe(produto.id)).toBe(8);
    });

    it("a mesma chave com outro corpo responde 422", async () => {
        const produto = await criarProduto(10);

        const primeira = await api()
            .post("/pedidos")
            .set(CHAVE)
            .set("Idempotency-Key", "chave-abc")
            .send({ clienteNome: "A", itens: [{ produtoId: produto.id, quantidade: 1 }] });

        const outra = await api()
            .post("/pedidos")
            .set(CHAVE)
            .set("Idempotency-Key", "chave-abc")
            .send({ clienteNome: "B", itens: [{ produtoId: produto.id, quantidade: 1 }] });

        expect(primeira.status).toBe(201);
        expect(outra.status).toBe(422);
        expect(await prisma.pedido.count()).toBe(1);
    });

    it("a chave vale por usuário", async () => {
        const produto = await criarProduto(10);
        const corpo = { clienteNome: "A", itens: [{ produtoId: produto.id, quantidade: 1 }] };

        const usuario1 = await api().post("/pedidos").set(CHAVE)
            .set("x-usuario-id", "1").set("Idempotency-Key", "mesma").send(corpo);
        const usuario2 = await api().post("/pedidos").set(CHAVE)
            .set("x-usuario-id", "2").set("Idempotency-Key", "mesma").send(corpo);

        expect(usuario1.status).toBe(201);
        expect(usuario2.status).toBe(201);
        expect(await prisma.pedido.count()).toBe(2);
    });

    it("soma o valor do pedido em decimal", async () => {
        const a = await criarProduto(10, "0.10", "SKU-A");
        const b = await criarProduto(10, "0.20", "SKU-B");

        const resposta = await api()
            .post("/pedidos")
            .set(CHAVE)
            .send({
                clienteNome: "Cliente",
                itens: [
                    { produtoId: a.id, quantidade: 1 },
                    { produtoId: b.id, quantidade: 1 }
                ]
            });

        expect(resposta.status).toBe(201);
        expect(resposta.body.pedido.valorTotal).toBe("0.3");
    });
});

describe("produtos", () => {
    it("SKU duplicado responde 409, inclusive em cadastros simultâneos", async () => {
        const respostas = await Promise.all(
            Array.from({ length: 5 }, () =>
                api()
                    .post("/produtos")
                    .set(CHAVE)
                    .send({ nome: "P", sku: "SKU-DUP", preco: 10 })
            )
        );

        expect(respostas.filter((r) => r.status === 201)).toHaveLength(1);
        expect(respostas.filter((r) => r.status === 409)).toHaveLength(4);
    });

    it("trocar o SKU para um já existente responde 409", async () => {
        await criarProduto(1, 10, "SKU-A");
        const b = await criarProduto(1, 10, "SKU-B");

        const resposta = await api().put(`/produtos/${b.id}`).set(CHAVE).send({ sku: "SKU-A" });

        expect(resposta.status).toBe(409);
    });

    it("ajustes de estoque simultâneos não se perdem", async () => {
        const produto = await criarProduto(10);

        await Promise.all(
            Array.from({ length: 10 }, () =>
                api().put(`/produtos/${produto.id}`).set(CHAVE).send({ ajusteEstoque: 1 })
            )
        );

        expect(await estoqueDe(produto.id)).toBe(20);
    });

    it("editar outro campo não sobrescreve o estoque", async () => {
        const produto = await criarProduto(10);

        await Promise.all([
            api().put(`/produtos/${produto.id}`).set(CHAVE).send({ nome: "Novo nome" }),
            criarPedido(produto.id, 4)
        ]);

        expect(await estoqueDe(produto.id)).toBe(6);
    });

    it("não aceita estoque absoluto nem ajuste que deixaria o estoque negativo", async () => {
        const produto = await criarProduto(3);

        const absoluto = await api().put(`/produtos/${produto.id}`).set(CHAVE).send({ estoque: 50 });
        const negativo = await api().put(`/produtos/${produto.id}`).set(CHAVE).send({ ajusteEstoque: -5 });

        expect(absoluto.status).toBe(400);
        expect(negativo.status).toBe(400);
        expect(await estoqueDe(produto.id)).toBe(3);
    });

    it("excluir produto inexistente responde 404 e produto com pedidos responde 409", async () => {
        const produto = await criarProduto(10);
        await criarPedido(produto.id, 1);

        const inexistente = await api().delete("/produtos/999").set(CHAVE);
        const comPedido = await api().delete(`/produtos/${produto.id}`).set(CHAVE);

        expect(inexistente.status).toBe(404);
        expect(comPedido.status).toBe(409);
    });
});

describe("integração CRM → ERP", () => {
    it("entregas repetidas da mesma oportunidade criam um único pedido", async () => {
        const respostas = await Promise.all(
            Array.from({ length: 6 }, () =>
                api()
                    .post("/integracoes/crm/oportunidades")
                    .set(CHAVE)
                    .send({ oportunidadeId: 7, clienteNome: "Cliente", valorTotal: "1500.00" })
            )
        );

        expect(respostas.every((r) => r.status === 200 || r.status === 201)).toBe(true);
        expect(await prisma.pedido.count()).toBe(1);
    });
});
