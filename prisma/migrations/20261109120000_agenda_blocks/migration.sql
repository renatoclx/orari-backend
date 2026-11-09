-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'AGENDA_BLOCK_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'AGENDA_BLOCK_REMOVED';

-- CreateTable
CREATE TABLE "agenda_blocks" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agenda_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agenda_blocks_companyId_startAt_idx" ON "agenda_blocks"("companyId", "startAt");

-- AddForeignKey
ALTER TABLE "agenda_blocks" ADD CONSTRAINT "agenda_blocks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_blocks" ADD CONSTRAINT "agenda_blocks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
