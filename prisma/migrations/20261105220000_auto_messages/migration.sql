-- CreateEnum
CREATE TYPE "AutoMessageKind" AS ENUM ('REMINDER', 'APPOINTMENT_CREATED', 'APPOINTMENT_RESCHEDULED', 'APPOINTMENT_CANCELLED', 'BIRTHDAY', 'MISS_YOU');

-- CreateTable
CREATE TABLE "auto_messages" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "AutoMessageKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "body" VARCHAR(500) NOT NULL,
    "reminderOffsets" INTEGER[],
    "missYouDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "auto_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_message_logs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "AutoMessageKind" NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auto_message_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auto_messages_companyId_kind_key" ON "auto_messages"("companyId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "auto_message_logs_dedupKey_key" ON "auto_message_logs"("dedupKey");

-- CreateIndex
CREATE INDEX "auto_message_logs_companyId_createdAt_idx" ON "auto_message_logs"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "auto_messages" ADD CONSTRAINT "auto_messages_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_message_logs" ADD CONSTRAINT "auto_message_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

