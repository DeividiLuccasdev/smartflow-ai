import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Aplica as migrações pendentes do banco do Auth com o CLI do Prisma
// (o mesmo "prisma migrate deploy" do script "migrate"). Lança erro se a
// migração falhar, o que interrompe a inicialização do serviço.
export function aplicarMigracoes() {
    const require = createRequire(import.meta.url);
    const pacotePrisma = require.resolve("prisma/package.json");
    const cli = path.join(path.dirname(pacotePrisma), "build", "index.js");

    // src/lib ou dist/lib -> raiz do serviço, onde fica o prisma.config.ts.
    const raizServico = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        ".."
    );

    execFileSync(process.execPath, [cli, "migrate", "deploy"], {
        cwd: raizServico,
        stdio: "inherit"
    });
}
