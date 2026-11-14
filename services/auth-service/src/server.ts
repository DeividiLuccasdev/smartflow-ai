import { app } from "./app.js";
import { prisma } from "./config/prisma.js";
import { aplicarMigracoes } from "./lib/migracoes.js";
import {
    deveCriarUsuarioDemo,
    EMAIL_DEMO,
    garantirUsuarioDemo
} from "./lib/usuarioDemo.js";

const PORT = process.env.PORT || 3001;

async function iniciar() {
    // No deploy (Render) ou com CRIAR_USUARIO_DEMO=true: aplica as migrações
    // e garante a conta de demonstração antes de aceitar requisições.
    if (deveCriarUsuarioDemo()) {
        aplicarMigracoes();

        await garantirUsuarioDemo(prisma);

        console.log(`Usuário de demonstração garantido: ${EMAIL_DEMO}`);
    }

    app.listen(PORT, () => {
        console.log(`Auth Service rodando na porta ${PORT}`);
    });
}

iniciar().catch((erro: unknown) => {
    console.error("Falha ao iniciar o Auth Service:", erro);
    process.exit(1);
});
