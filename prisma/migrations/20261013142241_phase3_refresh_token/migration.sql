-- AlterTable
ALTER TABLE "User" ADD COLUMN     "hmsRefreshToken" TEXT,
ADD COLUMN     "hmsRefreshTokenUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "hmsTokenExpiresAt" TIMESTAMP(3),
ALTER COLUMN "role" DROP NOT NULL;
