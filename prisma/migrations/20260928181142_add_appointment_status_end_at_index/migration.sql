-- CreateIndex
CREATE INDEX "appointments_status_endAt_idx" ON "appointments"("status", "endAt");
