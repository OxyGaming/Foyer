-- Familles de produits : un générique (« Pâtes ») et ses déclinaisons (spaghetti, coquillettes…).
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "photoId" TEXT,
    "categoryId" TEXT,
    "unit" TEXT,
    "minStock" REAL,
    "targetStock" REAL,
    "defaultLocationId" TEXT,
    "brand" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "parentId" TEXT,
    "preferredId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Product_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Product_preferredId_fkey" FOREIGN KEY ("preferredId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Product_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Product_defaultLocationId_fkey" FOREIGN KEY ("defaultLocationId") REFERENCES "Location" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Product" ("brand", "categoryId", "createdAt", "defaultLocationId", "householdId", "id", "minStock", "name", "notes", "photoId", "reference", "targetStock", "unit", "updatedAt") SELECT "brand", "categoryId", "createdAt", "defaultLocationId", "householdId", "id", "minStock", "name", "notes", "photoId", "reference", "targetStock", "unit", "updatedAt" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE INDEX "Product_householdId_idx" ON "Product"("householdId");
CREATE INDEX "Product_parentId_idx" ON "Product"("parentId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
