-- CreateTable
CREATE TABLE "HubDailyBaseline" (
    "id" TEXT NOT NULL,
    "hubId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "ftdBase" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HubDailyBaseline_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HubDailyBaseline_hubId_date_idx" ON "HubDailyBaseline"("hubId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "HubDailyBaseline_hubId_date_key" ON "HubDailyBaseline"("hubId", "date");
