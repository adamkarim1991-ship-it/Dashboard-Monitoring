-- Key each immutable morning snapshot by facility and operational date.
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_CleanFloorSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "facility" TEXT NOT NULL,
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

INSERT INTO "new_CleanFloorSnapshot" ("id", "facility", "date", "value", "numerator", "denominator", "delivered", "ongoing", "ftd", "others", "capturedAt")
SELECT "id", '460450593288', "date", "value", "numerator", "denominator", "delivered", "ongoing", "ftd", "others", "capturedAt"
FROM "CleanFloorSnapshot";

DROP TABLE "CleanFloorSnapshot";
ALTER TABLE "new_CleanFloorSnapshot" RENAME TO "CleanFloorSnapshot";
CREATE UNIQUE INDEX "CleanFloorSnapshot_facility_date_key" ON "CleanFloorSnapshot"("facility", "date");

PRAGMA foreign_keys=ON;
