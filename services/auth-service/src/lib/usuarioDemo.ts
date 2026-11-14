import type { PrismaClient } from "../generated/prisma/client.js";
import { gerarHashSenha } from "./senha.js";

// Conta pública de demonstração, exibida no README para recrutadores.
export const EMAIL_DEMO = "demo@example.com";
export const SENHA_DEMO = "Demo@2026";
export const NOME_DEMO = "Usuário Demo";

// ADMIN é o único perfil que vê CRM, ERP, Financeiro e IA ao mesmo tempo.
// Por isso a conta é protegida contra alterações (ver ehContaDemo).
export const PERFIL_DEMO = "ADMIN";

export const ERRO_CONTA_DEMO =
    "A conta de demonstração não pode ser alterada ou desativada.";

export const ERRO_DEMO_ALTERAR_USUARIOS =
    "A conta de demonstração não pode ativar ou desativar usuários.";

export const ERRO_DEMO_CRIAR_ADMIN =
    "A conta de demonstração não pode criar usuários administradores.";

// Ponto único de proteção da conta demo: qualquer rota que altere,
// desative ou remova um usuário deve consultar este helper.
export function ehContaDemo(email: string | null | undefined) {
    return (
        typeof email === "string" &&
        email.trim().toLowerCase() === EMAIL_DEMO
    );
}

// A demo só é criada no deploy (o Render define RENDER automaticamente)
// ou quando pedida explicitamente, para não poluir bancos locais e de teste.
export function deveCriarUsuarioDemo(
    env: NodeJS.ProcessEnv = process.env
) {
    return Boolean(env.RENDER) || env.CRIAR_USUARIO_DEMO === "true";
}

type ClienteUsuario = Pick<PrismaClient, "usuario">;

// Idempotente e segura contra corrida (upsert pela chave única do e-mail).
// Se a conta já existe, reativa, restaura o perfil e redefine a senha,
// então uma demo alterada por visitantes se recupera a cada deploy.
export async function garantirUsuarioDemo(prisma: ClienteUsuario) {
    const senhaHash = await gerarHashSenha(SENHA_DEMO);

    return prisma.usuario.upsert({
        where: { email: EMAIL_DEMO },
        create: {
            nome: NOME_DEMO,
            email: EMAIL_DEMO,
            senhaHash,
            perfil: PERFIL_DEMO,
            ativo: true
        },
        update: {
            nome: NOME_DEMO,
            senhaHash,
            perfil: PERFIL_DEMO,
            ativo: true
        },
        select: {
            id: true,
            email: true,
            perfil: true,
            ativo: true
        }
    });
}
