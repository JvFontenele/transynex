-- Papéis de usuário como enum + backfill de dono nos projetos existentes.

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'EDITOR', 'VIEWER');

-- Converte a coluna texto para o enum: 'admin' legado vira ADMIN,
-- qualquer outro valor vira EDITOR.
ALTER TABLE "User"
  ALTER COLUMN "role" DROP DEFAULT,
  ALTER COLUMN "role" TYPE "Role" USING (
    CASE WHEN lower("role") = 'admin' THEN 'ADMIN'::"Role" ELSE 'EDITOR'::"Role" END
  ),
  ALTER COLUMN "role" SET DEFAULT 'EDITOR';

-- Backfill: projetos sem dono passam para o admin mais antigo (se existir).
UPDATE "Project"
SET "ownerId" = (
  SELECT "id" FROM "User" WHERE "role" = 'ADMIN' ORDER BY "createdAt" ASC LIMIT 1
)
WHERE "ownerId" IS NULL
  AND EXISTS (SELECT 1 FROM "User" WHERE "role" = 'ADMIN');
