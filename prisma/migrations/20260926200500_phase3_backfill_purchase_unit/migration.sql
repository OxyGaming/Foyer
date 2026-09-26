-- Les achats enregistrés avant la phase 3 n'avaient pas d'unité : ils
-- reprennent celle du produit (c'est celle dans laquelle ils ont été rangés).
UPDATE "Purchase"
SET "unit" = (SELECT "unit" FROM "Product" WHERE "Product"."id" = "Purchase"."productId")
WHERE "unit" IS NULL;
