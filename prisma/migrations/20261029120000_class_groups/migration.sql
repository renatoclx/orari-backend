-- AlterTable
ALTER TABLE "services" ADD COLUMN     "allowsClasses" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "class_groups" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT,
    "normalizedName" TEXT,
    "serviceId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "class_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_group_days" (
    "id" TEXT NOT NULL,
    "classGroupId" TEXT NOT NULL,
    "weekDay" "WeekDay" NOT NULL,
    "startTime" TIME(0) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_group_days_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "class_groups_companyId_createdAt_idx" ON "class_groups"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "class_groups_professionalId_idx" ON "class_groups"("professionalId");

-- CreateIndex
CREATE INDEX "class_groups_serviceId_idx" ON "class_groups"("serviceId");

-- CreateIndex
CREATE INDEX "class_groups_normalizedName_idx" ON "class_groups" USING GIN ("normalizedName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "class_group_days_classGroupId_idx" ON "class_group_days"("classGroupId");

-- AddForeignKey
ALTER TABLE "class_groups" ADD CONSTRAINT "class_groups_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_groups" ADD CONSTRAINT "class_groups_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_groups" ADD CONSTRAINT "class_groups_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_group_days" ADD CONSTRAINT "class_group_days_classGroupId_fkey" FOREIGN KEY ("classGroupId") REFERENCES "class_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

