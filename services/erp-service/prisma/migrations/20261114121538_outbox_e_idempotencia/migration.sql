-- CreateEnum
CREATE TYPE "StatusChaveIdempotencia" AS ENUM ('EM_ANDAMENTO', 'CONCLUIDA');

-- CreateTable
CREATE TABLE "EventoOutbox" (
    "id" SERIAL NOT NULL,
    "agregado" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "servico" TEXT NOT NULL,
    "caminho" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "proximaTentativaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bloqueadoAte" TIMESTAMP(3),
    "enviadoEm" TIMESTAMP(3),
    "falhouEm" TIMESTAMP(3),
    "ultimoErro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChaveIdempotencia" (
    "id" SERIAL NOT NULL,
    "usuario" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "status" "StatusChaveIdempotencia" NOT NULL DEFAULT 'EM_ANDAMENTO',
    "codigoResposta" INTEGER,
    "corpoResposta" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChaveIdempotencia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventoOutbox_enviadoEm_falhouEm_proximaTentativaEm_idx" ON "EventoOutbox"("enviadoEm", "falhouEm", "proximaTentativaEm");

-- CreateIndex
CREATE INDEX "EventoOutbox_agregado_idx" ON "EventoOutbox"("agregado");

-- CreateIndex
CREATE UNIQUE INDEX "ChaveIdempotencia_usuario_chave_key" ON "ChaveIdempotencia"("usuario", "chave");
