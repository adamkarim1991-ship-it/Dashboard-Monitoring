/*
  Warnings:

  - A unique constraint covering the columns `[hmsHubId]` on the table `Hub` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `hmsHubId` to the `Hub` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Hub" ADD COLUMN     "hmsHubId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Hub_hmsHubId_key" ON "Hub"("hmsHubId");
