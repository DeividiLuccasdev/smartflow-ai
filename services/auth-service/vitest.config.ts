import { defineConfig } from "vitest/config";

// Testes unitários: o Prisma é substituído por um dublê em memória,
// então não é preciso banco. A DATABASE_URL só satisfaz a configuração.
export default defineConfig({
    test: {
        include: ["test/**/*.test.ts"],
        env: {
            INTERNAL_API_KEY: "chave-de-teste",
            JWT_SECRET: "segredo-de-teste",
            DATABASE_URL:
                process.env.DATABASE_URL ??
                "postgresql://teste:teste@localhost:5432/teste"
        }
    }
});
