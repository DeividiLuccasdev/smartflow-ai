import { defineConfig } from "vitest/config";

// Testes de integração contra um PostgreSQL real (DATABASE_URL).
// Os arquivos rodam em sequência porque compartilham o mesmo banco.
export default defineConfig({
    test: {
        include: ["test/**/*.test.ts"],
        fileParallelism: false,
        testTimeout: 30_000,
        hookTimeout: 30_000,
        env: {
            INTERNAL_API_KEY: "chave-de-teste",
            ESPERA_ENTRE_TENTATIVAS_MS: "10"
        }
    }
});
