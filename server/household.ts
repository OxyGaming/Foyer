import type { Tx } from "./db";

const PRODUCT_CATEGORIES: [string, string][] = [
  ["Alimentaire", "🥫"],
  ["Frais", "🥛"],
  ["Surgelés", "🧊"],
  ["Boissons", "🧃"],
  ["Hygiène", "🧴"],
  ["Entretien", "🧽"],
  ["Autres", "📦"],
];
const RECIPE_CATEGORIES: [string, string][] = [
  ["Entrée", "🥗"],
  ["Plat", "🍲"],
  ["Dessert", "🍰"],
  ["Petit-déjeuner", "🥐"],
  ["Apéritif", "🫒"],
];
const LOCATIONS: [string, string][] = [
  ["Cuisine", "🍳"],
  ["Réfrigérateur", "🧊"],
  ["Congélateur", "❄️"],
  ["Salle de bain", "🛁"],
  ["Garage", "🚗"],
];

/** Crée un foyer, son premier membre et des référentiels de départ (modifiables). */
export async function createHousehold(tx: Tx, name: string, ownerId: string) {
  const household = await tx.household.create({ data: { name } });
  await tx.householdMember.create({ data: { householdId: household.id, userId: ownerId, role: "owner" } });
  await tx.category.createMany({
    data: [
      ...PRODUCT_CATEGORIES.map(([n, icon], i) => ({ householdId: household.id, kind: "product", name: n, icon, sortOrder: i })),
      ...RECIPE_CATEGORIES.map(([n, icon], i) => ({ householdId: household.id, kind: "recipe", name: n, icon, sortOrder: i })),
    ],
  });
  await tx.location.createMany({
    data: LOCATIONS.map(([n, icon], i) => ({ householdId: household.id, name: n, icon, sortOrder: i })),
  });
  return household;
}
