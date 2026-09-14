/*
  Warnings:

  - A unique constraint covering the columns `[oportunidadeId]` on the table `Pedido` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Pedido" ADD COLUMN     "oportunidadeId" INTEGER,
ADD COLUMN     "origem" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Pedido_oportunidadeId_key" ON "Pedido"("oportunidadeId");
