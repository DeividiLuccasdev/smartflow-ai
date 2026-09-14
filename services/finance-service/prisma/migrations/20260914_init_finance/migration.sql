-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "StatusContaReceber" AS ENUM ('PENDENTE', 'PAGO', 'CANCELADO');

-- CreateTable
CREATE TABLE "ContaReceber" (
    "id" SERIAL NOT NULL,
    "pedidoId" INTEGER NOT NULL,
    "clienteNome" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "status" "StatusContaReceber" NOT NULL DEFAULT 'PENDENTE',
    "origem" TEXT NOT NULL DEFAULT 'ERP',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContaReceber_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContaReceber_pedidoId_key" ON "ContaReceber"("pedidoId");
