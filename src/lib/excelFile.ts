import { parseRecipeSheets } from "./excelImport";

// Bibliothèques Excel chargées à la demande : elles ne pèsent pas sur le reste de l'appli.

export async function readRecipeWorkbook(file: File, existingNames: string[]) {
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  return parseRecipeSheets(await readXlsxFile(file), existingNames);
}

export async function downloadRecipeTemplate() {
  const [{ default: writeXlsxFile }, { recipeWorkbook }] = await Promise.all([import("write-excel-file/browser"), import("./excelTemplate")]);
  await writeXlsxFile(recipeWorkbook()).toFile("modele-recettes-foyer.xlsx");
}
