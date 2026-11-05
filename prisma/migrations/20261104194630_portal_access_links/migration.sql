-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PORTAL_ACCESS_LINK_CREATED';

-- CreateTable
CREATE TABLE "portal_access_links" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "peopleId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_access_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "portal_access_links_tokenHash_key" ON "portal_access_links"("tokenHash");

-- CreateIndex
CREATE INDEX "portal_access_links_peopleId_idx" ON "portal_access_links"("peopleId");

-- AddForeignKey
ALTER TABLE "portal_access_links" ADD CONSTRAINT "portal_access_links_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_access_links" ADD CONSTRAINT "portal_access_links_peopleId_fkey" FOREIGN KEY ("peopleId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
