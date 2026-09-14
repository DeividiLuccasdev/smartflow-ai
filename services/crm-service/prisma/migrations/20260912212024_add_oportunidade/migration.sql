-- CreateEnum
CREATE TYPE "StatusOportunidade" AS ENUM ('ABERTA', 'PROPOSTA', 'NEGOCIACAO', 'GANHA', 'PERDIDA');

-- CreateTable
CREATE TABLE "Oportunidade" (
    "id" SERIAL NOT NULL,
    "titulo" TEXT NOT NULL,
    "cliente" TEXT,
    "valor" DECIMAL(12,2) NOT NULL,
    "status" "StatusOportunidade" NOT NULL DEFAULT 'ABERTA',
    "responsavel" TEXT,
    "observacoes" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Oportunidade_pkey" PRIMARY KEY ("id")
);
