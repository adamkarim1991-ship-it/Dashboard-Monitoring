-- AlterTable
ALTER TABLE "Hub" ADD COLUMN     "hmsRefreshToken" TEXT,
ADD COLUMN     "hmsToken" TEXT,
ADD COLUMN     "hmsTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "hmsTokenUpdatedAt" TIMESTAMP(3);
