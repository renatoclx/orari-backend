-- CreateTable
CREATE TABLE "commission_advances" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_advances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commission_advances_companyId_professionalId_idx" ON "commission_advances"("companyId", "professionalId");

-- AddForeignKey
ALTER TABLE "commission_advances" ADD CONSTRAINT "commission_advances_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_advances" ADD CONSTRAINT "commission_advances_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_advances" ADD CONSTRAINT "commission_advances_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
