-- CreateEnum
CREATE TYPE "Role" AS ENUM ('MANAGER', 'SPV', 'HUB_LEAD');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "hmsToken" TEXT,
    "leaderHmsToken" TEXT,
    "hmsTokenUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cluster" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cluster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hub" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT '',
    "clusterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Hub_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserHub" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hubId" TEXT NOT NULL,

    CONSTRAINT "UserHub_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HourlyMetric" (
    "id" TEXT NOT NULL,
    "hubId" TEXT NOT NULL,
    "hourTimestamp" TIMESTAMP(3) NOT NULL,
    "inbound" INTEGER NOT NULL DEFAULT 0,
    "outbound" INTEGER NOT NULL DEFAULT 0,
    "delivered" INTEGER NOT NULL DEFAULT 0,
    "pending" INTEGER NOT NULL DEFAULT 0,
    "slaBreach" INTEGER NOT NULL DEFAULT 0,
    "activeCouriers" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HourlyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CleanFloorSnapshot" (
    "id" TEXT NOT NULL,
    "facility" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "numerator" INTEGER NOT NULL,
    "denominator" INTEGER NOT NULL,
    "delivered" INTEGER NOT NULL,
    "ongoing" INTEGER NOT NULL,
    "ftd" INTEGER NOT NULL,
    "others" INTEGER NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CleanFloorSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Cluster_name_key" ON "Cluster"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Hub_name_key" ON "Hub"("name");

-- CreateIndex
CREATE UNIQUE INDEX "UserHub_userId_hubId_key" ON "UserHub"("userId", "hubId");

-- CreateIndex
CREATE INDEX "HourlyMetric_hubId_hourTimestamp_idx" ON "HourlyMetric"("hubId", "hourTimestamp");

-- CreateIndex
CREATE UNIQUE INDEX "HourlyMetric_hubId_hourTimestamp_key" ON "HourlyMetric"("hubId", "hourTimestamp");

-- CreateIndex
CREATE UNIQUE INDEX "CleanFloorSnapshot_facility_date_key" ON "CleanFloorSnapshot"("facility", "date");

-- AddForeignKey
ALTER TABLE "Hub" ADD CONSTRAINT "Hub_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "Cluster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserHub" ADD CONSTRAINT "UserHub_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserHub" ADD CONSTRAINT "UserHub_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HourlyMetric" ADD CONSTRAINT "HourlyMetric_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE CASCADE ON UPDATE CASCADE;
