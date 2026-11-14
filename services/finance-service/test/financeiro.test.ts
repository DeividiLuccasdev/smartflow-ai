import type { Server } from "node:http";

import request from "supertest";
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it
} from "vitest";

import { app } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";

const CHAVE = { "x-internal-key": "chave-de-teste" };

let servidor: Server;

beforeAll(() => {
    servidor = app.listen(0);
});

afterAll(async () => {
    servidor.close();
    await prisma.$disconnect();
});

beforeEach(async () => {
    await prisma.$executeRawUnsafe(
        'TRUNCATE "ContaReceber" RESTART IDENTITY CASCADE'
    );
});

const api = () => request(servidor);

async function criarConta(pedidoId: number, valor: string | number = "100.00") {
    const resposta = await api()
        .post("/integracoes/erp/pedidos")
        .set(CHAVE)
        .send({ pedidoId, clienteNome: "Cliente Teste", valor });

    expect(resposta.status).toBe(201);

    return resposta.body.conta as { id: number };
}

describe("pagar x cancelar", () => {
    it("com as duas operações ao mesmo tempo, exatamente uma vence", async () => {
        for (let rodada = 1; rodada <= 10; rodada++) {
            const conta = await criarConta(rodada);

            const [pagar, cancelar] = await Promise.all([
                api().post(`/contas-receber/${conta.id}/pagar`).set(CHAVE),
                api().post(`/contas-receber/${conta.id}/cancelar`).set(CHAVE)
            ]);

            const final = await prisma.contaReceber.findUniqueOrThrow({
                where: { id: conta.id }
            });

            const sucessos = [pagar, cancelar].filter((r) => r.status === 200);
            const conflitos = [pagar, cancelar].filter((r) => r.status === 409);

            expect(sucessos).toHaveLength(1);
            expect(conflitos).toHaveLength(1);

            if (pagar.status === 200) {
                expect(final.status).toBe("PAGO");
            } else {
                expect(final.status).toBe("CANCELADO");
            }
        }
    });

    it("pagar contra o cancelamento vindo do ERP também é atômico", async () => {
        for (let rodada = 1; rodada <= 10; rodada++) {
            const conta = await criarConta(rodada);

            const [pagar, cancelarPedido] = await Promise.all([
                api().post(`/contas-receber/${conta.id}/pagar`).set(CHAVE),
                api()
                    .post(`/integracoes/erp/pedidos/${rodada}/cancelar`)
                    .set(CHAVE)
            ]);

            const final = await prisma.contaReceber.findUniqueOrThrow({
                where: { id: conta.id }
            });

            if (final.status === "PAGO") {
                expect(pagar.status).toBe(200);
                expect(cancelarPedido.status).toBe(409);
            } else {
                expect(final.status).toBe("CANCELADO");
                expect(pagar.status).toBe(409);
                expect(cancelarPedido.status).toBe(200);
            }
        }
    });

    it("pagar duas vezes é idempotente", async () => {
        const conta = await criarConta(1);

        const respostas = await Promise.all(
            Array.from({ length: 5 }, () =>
                api().post(`/contas-receber/${conta.id}/pagar`).set(CHAVE)
            )
        );

        expect(respostas.every((r) => r.status === 200)).toBe(true);
        expect(
            respostas.filter((r) => r.body.mensagem === "Conta marcada como paga com sucesso.")
        ).toHaveLength(1);
    });

    it("conta inexistente responde 404", async () => {
        const resposta = await api().post("/contas-receber/999/pagar").set(CHAVE);

        expect(resposta.status).toBe(404);
    });
});

describe("integração com o ERP", () => {
    it("entregas repetidas e simultâneas do mesmo pedido criam uma única conta", async () => {
        const respostas = await Promise.all(
            Array.from({ length: 8 }, () =>
                api()
                    .post("/integracoes/erp/pedidos")
                    .set(CHAVE)
                    .send({ pedidoId: 42, clienteNome: "Cliente", valor: "10.50" })
            )
        );

        expect(respostas.every((r) => r.status === 200 || r.status === 201)).toBe(true);
        expect(respostas.filter((r) => r.status === 201)).toHaveLength(1);
        expect(await prisma.contaReceber.count()).toBe(1);
    });
});

describe("resumo financeiro", () => {
    it("soma os valores em decimal, sem erro de ponto flutuante", async () => {
        await criarConta(1, "0.10");
        await criarConta(2, "0.20");
        const paga = await criarConta(3, "1000.05");

        await api().post(`/contas-receber/${paga.id}/pagar`).set(CHAVE);

        const resumo = await api().get("/financeiro/resumo").set(CHAVE);

        expect(resumo.status).toBe(200);
        expect(resumo.body).toEqual({
            totalContas: 3,
            pendentes: 2,
            pagas: 1,
            canceladas: 0,
            valorPendente: 0.3,
            valorRecebido: 1000.05
        });
    });
});
