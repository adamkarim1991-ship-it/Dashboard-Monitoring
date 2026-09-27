-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Hub" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT '',
    "clusterId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Hub_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "Cluster" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Hub" ("clusterId", "createdAt", "id", "name") SELECT "clusterId", "createdAt", "id", "name" FROM "Hub";
DROP TABLE "Hub";
ALTER TABLE "new_Hub" RENAME TO "Hub";
CREATE UNIQUE INDEX "Hub_name_key" ON "Hub"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
