-- CreateTable
CREATE TABLE "CleanFloorSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "numerator" INTEGER NOT NULL,
    "denominator" INTEGER NOT NULL,
    "delivered" INTEGER NOT NULL,
    "ongoing" INTEGER NOT NULL,
    "ftd" INTEGER NOT NULL,
    "others" INTEGER NOT NULL,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "CleanFloorSnapshot_date_key" ON "CleanFloorSnapshot"("date");
