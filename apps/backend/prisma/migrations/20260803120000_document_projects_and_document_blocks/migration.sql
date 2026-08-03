-- Projetos de documento: tradução em texto corrido a partir da camada de
-- texto do PDF (ou do OCR, quando o PDF é escaneado).

-- CreateEnum
CREATE TYPE "ProjectKind" AS ENUM ('IMAGE', 'DOCUMENT');

-- Projetos existentes são todos do fluxo de imagem.
ALTER TABLE "Project" ADD COLUMN "kind" "ProjectKind" NOT NULL DEFAULT 'IMAGE';

-- CreateTable
CREATE TABLE "DocumentBlock" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceFileId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "sourceText" TEXT NOT NULL,
    "translatedText" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'text-layer',

    CONSTRAINT "DocumentBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentBlock_projectId_order_idx" ON "DocumentBlock"("projectId", "order");

-- CreateIndex
CREATE INDEX "DocumentBlock_sourceFileId_idx" ON "DocumentBlock"("sourceFileId");

-- AddForeignKey
ALTER TABLE "DocumentBlock" ADD CONSTRAINT "DocumentBlock_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentBlock" ADD CONSTRAINT "DocumentBlock_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "SourceFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
