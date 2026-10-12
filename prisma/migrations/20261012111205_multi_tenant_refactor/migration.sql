-- CreateEnum
CREATE TYPE "HubRole" AS ENUM ('MANAGER', 'SPV', 'HUB_LEAD', 'VIEWER');

-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- AlterTable
ALTER TABLE "CleanFloorSnapshot" ADD COLUMN     "hubId" TEXT;

-- AlterTable
ALTER TABLE "UserHub" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "role" "HubRole" NOT NULL DEFAULT 'VIEWER';

-- CreateTable
CREATE TABLE "HubCredential" (
    "id" TEXT NOT NULL,
    "hubId" TEXT NOT NULL,
    "cookieEncrypted" TEXT NOT NULL,
    "status" "CredentialStatus" NOT NULL DEFAULT 'ACTIVE',
    "apiIds" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "lastPingAt" TIMESTAMP(3),
    "lastErrorMsg" TEXT,
    "capturedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HubCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PairingCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hubId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PairingCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "hubId" TEXT,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HubCredential_hubId_status_idx" ON "HubCredential"("hubId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PairingCode_code_key" ON "PairingCode"("code");

-- CreateIndex
CREATE INDEX "PairingCode_code_idx" ON "PairingCode"("code");

-- CreateIndex
CREATE INDEX "PairingCode_expiresAt_idx" ON "PairingCode"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_hubId_createdAt_idx" ON "AuditLog"("hubId", "createdAt");

-- CreateIndex
CREATE INDEX "CleanFloorSnapshot_hubId_date_idx" ON "CleanFloorSnapshot"("hubId", "date");

-- CreateIndex
CREATE INDEX "Hub_hmsHubId_idx" ON "Hub"("hmsHubId");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "UserHub_userId_idx" ON "UserHub"("userId");

-- CreateIndex
CREATE INDEX "UserHub_hubId_idx" ON "UserHub"("hubId");

-- AddForeignKey
ALTER TABLE "HubCredential" ADD CONSTRAINT "HubCredential_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PairingCode" ADD CONSTRAINT "PairingCode_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleanFloorSnapshot" ADD CONSTRAINT "CleanFloorSnapshot_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE;
