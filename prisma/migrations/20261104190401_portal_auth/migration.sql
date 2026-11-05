-- CreateTable
CREATE TABLE "portal_verifications" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_sessions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "peopleId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portal_verifications_companyId_phone_createdAt_idx" ON "portal_verifications"("companyId", "phone", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "portal_sessions_tokenHash_key" ON "portal_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "portal_sessions_peopleId_idx" ON "portal_sessions"("peopleId");

-- AddForeignKey
ALTER TABLE "portal_verifications" ADD CONSTRAINT "portal_verifications_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_peopleId_fkey" FOREIGN KEY ("peopleId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
