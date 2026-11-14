import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    EMAIL_DEMO,
    ERRO_CONTA_DEMO,
    ERRO_DEMO_ALTERAR_USUARIOS,
    ERRO_DEMO_CRIAR_ADMIN
} from "../src/lib/usuarioDemo.js";

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
            findUnique: async ({
                where
            }: {
                where: { id?: number; email?: string };
            }) =>
                banco.usuarios.find((u) =>
                    where.id !== undefined
                        ? u.id === where.id
                        : u.email === where.email
                ) ?? null,
            create: async ({ data }: { data: Omit<UsuarioFalso, "id" | "ativo" | "criadoEm"> }) => {
                const usuario = {
                    ...data,
                    id: banco.usuarios.length + 1,
                    ativo: true,
                    criadoEm: new Date()
                };
                banco.usuarios.push(usuario);
                return usuario;
            },
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
            .set("Authorization", tokenDe(1))
            .send({ ativo: false });

        expect(resposta.status).toBe(200);
        expect(banco.usuarios[2]!.ativo).toBe(false);
    });
});

describe("conta de demonstração como solicitante", () => {
    it("não pode desativar a conta real de administrador", async () => {
        const resposta = await request(app)
            .patch("/usuarios/1/ativo")
            .set(CHAVE)
            .set("Authorization", tokenDe(2))
            .send({ ativo: false });

        expect(resposta.status).toBe(403);
        expect(resposta.body.erro).toBe(ERRO_DEMO_ALTERAR_USUARIOS);
        expect(banco.usuarios[0]!.ativo).toBe(true);
    });

    it("não pode ativar nem desativar nenhum outro usuário", async () => {
        banco.usuarios[2]!.ativo = false;

        const resposta = await request(app)
            .patch("/usuarios/3/ativo")
            .set(CHAVE)
            .set("Authorization", tokenDe(2))
            .send({ ativo: true });

        expect(resposta.status).toBe(403);
        expect(resposta.body.erro).toBe(ERRO_DEMO_ALTERAR_USUARIOS);
        expect(banco.usuarios[2]!.ativo).toBe(false);
    });

    it("não pode criar usuário ADMIN", async () => {
        const resposta = await request(app)
            .post("/usuarios")
            .set(CHAVE)
            .set("Authorization", tokenDe(2))
            .send({
                nome: "Novo Admin",
                email: "novo-admin@smartflow.com",
                senha: "Senha@123",
                perfil: "ADMIN"
            });

        expect(resposta.status).toBe(403);
        expect(resposta.body.erro).toBe(ERRO_DEMO_CRIAR_ADMIN);
        expect(banco.usuarios).toHaveLength(3);
    });

    it("pode criar usuário de outro perfil", async () => {
        const resposta = await request(app)
            .post("/usuarios")
            .set(CHAVE)
            .set("Authorization", tokenDe(2))
            .send({
                nome: "Nova Atendente",
                email: "atendente@smartflow.com",
                senha: "Senha@123",
                perfil: "ATENDENTE"
            });

        expect(resposta.status).toBe(201);
        expect(resposta.body.usuario.perfil).toBe("ATENDENTE");
    });
});

describe("administrador real", () => {
    it("continua podendo criar usuário ADMIN", async () => {
        const resposta = await request(app)
            .post("/usuarios")
            .set(CHAVE)
            .set("Authorization", tokenDe(1))
            .send({
                nome: "Outro Admin",
                email: "outro-admin@smartflow.com",
                senha: "Senha@123",
                perfil: "ADMIN"
            });

        expect(resposta.status).toBe(201);
        expect(resposta.body.usuario.perfil).toBe("ADMIN");
    });
});
