import bcrypt from "bcryptjs";
import { describe, expect, it, vi } from "vitest";

import {
    deveCriarUsuarioDemo,
    ehContaDemo,
    EMAIL_DEMO,
    garantirUsuarioDemo,
    NOME_DEMO,
    PERFIL_DEMO,
    SENHA_DEMO
} from "../src/lib/usuarioDemo.js";

describe("ehContaDemo", () => {
    it("reconhece o e-mail da demo, sem diferenciar maiúsculas e espaços", () => {
        expect(ehContaDemo(EMAIL_DEMO)).toBe(true);
        expect(ehContaDemo("  Demo@Example.COM ")).toBe(true);
    });

    it("não protege outras contas", () => {
        expect(ehContaDemo("admin@smartflow.com")).toBe(false);
        expect(ehContaDemo("demo@example.com.br")).toBe(false);
        expect(ehContaDemo("")).toBe(false);
        expect(ehContaDemo(undefined)).toBe(false);
        expect(ehContaDemo(null)).toBe(false);
    });
});

describe("deveCriarUsuarioDemo", () => {
    it("cria no Render (RENDER definida automaticamente)", () => {
        expect(deveCriarUsuarioDemo({ RENDER: "true" })).toBe(true);
    });

    it("cria quando CRIAR_USUARIO_DEMO=true", () => {
        expect(deveCriarUsuarioDemo({ CRIAR_USUARIO_DEMO: "true" })).toBe(true);
    });

    it("não cria em bancos locais ou de teste", () => {
        expect(deveCriarUsuarioDemo({})).toBe(false);
        expect(deveCriarUsuarioDemo({ CRIAR_USUARIO_DEMO: "false" })).toBe(false);
        expect(deveCriarUsuarioDemo({ RENDER: "" })).toBe(false);
    });
});

describe("garantirUsuarioDemo", () => {
    function criarPrismaFalso() {
        const upsert = vi.fn(async (args: { create: { email: string } }) => ({
            id: 1,
            email: args.create.email,
            perfil: PERFIL_DEMO,
            ativo: true
        }));

        return {
            upsert,
            prisma: { usuario: { upsert } } as unknown as Parameters<
                typeof garantirUsuarioDemo
            >[0]
        };
    }

    it("faz upsert pelo e-mail, ativo, com o perfil da demo", async () => {
        const { prisma, upsert } = criarPrismaFalso();

        await garantirUsuarioDemo(prisma);

        expect(upsert).toHaveBeenCalledTimes(1);

        const args = upsert.mock.calls[0]![0] as unknown as {
            where: { email: string };
            create: Record<string, unknown>;
            update: Record<string, unknown>;
        };

        expect(args.where).toEqual({ email: EMAIL_DEMO });
        expect(args.create).toMatchObject({
            nome: NOME_DEMO,
            email: EMAIL_DEMO,
            perfil: PERFIL_DEMO,
            ativo: true
        });

        // Conta existente: reativa, restaura o perfil e redefine a senha.
        expect(args.update).toMatchObject({
            perfil: PERFIL_DEMO,
            ativo: true
        });
        expect(args.update.senhaHash).toEqual(expect.any(String));
    });

    it("grava um hash bcrypt válido da senha da demo", async () => {
        const { prisma, upsert } = criarPrismaFalso();

        await garantirUsuarioDemo(prisma);

        const args = upsert.mock.calls[0]![0] as unknown as {
            create: { senhaHash: string };
            update: { senhaHash: string };
        };

        expect(args.create.senhaHash).not.toBe(SENHA_DEMO);
        expect(await bcrypt.compare(SENHA_DEMO, args.create.senhaHash)).toBe(true);
        expect(await bcrypt.compare(SENHA_DEMO, args.update.senhaHash)).toBe(true);
    });

    it("é idempotente: rodar de novo só repete o upsert", async () => {
        const { prisma, upsert } = criarPrismaFalso();

        await garantirUsuarioDemo(prisma);
        await garantirUsuarioDemo(prisma);

        expect(upsert).toHaveBeenCalledTimes(2);
    });
});
