-- CreateEnum
CREATE TYPE "StatusLead" AS ENUM ('NOVO', 'CONTATO', 'QUALIFICADO', 'PERDIDO', 'CONVERTIDO');

-- CreateTable
CREATE TABLE "Lead" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT,
    "telefone" TEXT,
    "empresa" TEXT,
    "origem" TEXT,
    "status" "StatusLead" NOT NULL DEFAULT 'NOVO',
    "observacoes" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);
