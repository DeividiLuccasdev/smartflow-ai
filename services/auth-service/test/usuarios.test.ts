import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EMAIL_DEMO, ERRO_CONTA_DEMO } from "../src/lib/usuarioDemo.js";

type UsuarioFalso = {
    id: number;
    nome: string;
    email: string;
    perfil: string;
    ativo: boolean;
    criadoEm: Date;
};

// Banco em memória no lugar do Prisma: só as operações usadas nas rotas.
const banco = vi.hoisted(() => ({
    usuarios: [] as UsuarioFalso[]
}));

vi.mock("../src/config/prisma.js", () => ({
    prisma: {
        usuario: {
            findUnique: async ({ where }: { where: { id: number } }) =>
                banco.usuarios.find((u) => u.id === where.id) ?? null,
            update: async ({
                where,
                data
            }: {
                where: { id: number };
                data: Partial<UsuarioFalso>;
            }) => {
                const usuario = banco.usuarios.find((u) => u.id === where.id)!;
                Object.assign(usuario, data);
                return usuario;
            }
        }
    }
}));

const { app } = await import("../src/app.js");

const CHAVE = { "x-internal-key": "chave-de-teste" };

function tokenDe(usuarioId: number) {
    return `Bearer ${jwt.sign({ usuarioId }, "segredo-de-teste")}`;
}

beforeEach(() => {
    banco.usuarios = [
        {
            id: 1,
            nome: "Admin",
            email: "admin@smartflow.com",
            perfil: "ADMIN",
            ativo: true,
            criadoEm: new Date()
        },
        {
            id: 2,
            nome: "Usuário Demo",
            email: EMAIL_DEMO,
            perfil: "ADMIN",
            ativo: true,
            criadoEm: new Date()
        },
        {
            id: 3,
            nome: "Vendedor",
            email: "vendedor@smartflow.com",
            perfil: "VENDEDOR",
            ativo: true,
            criadoEm: new Date()
        }
    ];
});

describe("PATCH /usuarios/:id/ativo", () => {
    it("recusa com 403 desativar a conta de demonstração", async () => {
        const resposta = await request(app)
            .patch("/usuarios/2/ativo")
            .set(CHAVE)
            .set("Authorization", tokenDe(1))
            .send({ ativo: false });

        expect(resposta.status).toBe(403);
        expect(resposta.body.erro).toBe(ERRO_CONTA_DEMO);
        expect(banco.usuarios[1]!.ativo).toBe(true);
    });

    it("continua permitindo desativar outras contas", async () => {
        const resposta = await request(app)
            .patch("/usuarios/3/ativo")
            .set(CHAVE)
            .set("Authorization", tokenDe(2))
            .send({ ativo: false });

        expect(resposta.status).toBe(200);
        expect(banco.usuarios[2]!.ativo).toBe(false);
    });
});
