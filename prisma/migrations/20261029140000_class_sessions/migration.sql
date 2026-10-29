-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "classSessionId" TEXT;

-- CreateTable
CREATE TABLE "class_sessions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "classGroupId" TEXT,
    "serviceId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "overBooking" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "class_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "class_sessions_companyId_startAt_idx" ON "class_sessions"("companyId", "startAt");

-- CreateIndex
CREATE INDEX "class_sessions_professionalId_startAt_idx" ON "class_sessions"("professionalId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "class_sessions_classGroupId_startAt_key" ON "class_sessions"("classGroupId", "startAt") WHERE ("classGroupId" IS NOT NULL);

-- CreateIndex
CREATE INDEX "appointments_classSessionId_idx" ON "appointments"("classSessionId");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_classSessionId_fkey" FOREIGN KEY ("classSessionId") REFERENCES "class_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_classGroupId_fkey" FOREIGN KEY ("classGroupId") REFERENCES "class_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

