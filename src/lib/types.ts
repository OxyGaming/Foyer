import type { StockStatus } from "../../shared/stock";

export type { StockStatus };

export type Member = { id: string; name: string | null; email: string; role: string };
export type Me = {
  user: { id: string; email: string; name: string | null };
  household: { id: string; name: string; mealSlots: MealPlanItem["meal"][]; weekStartDay?: number; members: Member[] };
};

export type CategoryKind = "recipe" | "product";
export type Category = {
  id: string;
  kind: CategoryKind;
  name: string;
  icon: string | null;
  color: string | null;
  parentId: string | null;
  sortOrder: number;
  photoId: string | null;
  usage: number;
};

export type Location = {
  id: string;
  name: string;
  icon: string | null;
  parentId: string | null;
  sortOrder: number;
  usage: number;
};

export type StockLine = { id: string; locationId: string | null; quantity: number | null; updatedAt: string };

export type Product = {
  id: string;
  name: string;
  photoId: string | null;
  categoryId: string | null;
  unit: string | null;
  minStock: number | null;
  targetStock: number | null;
  defaultLocationId: string | null;
  brand: string | null;
  reference: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  stock: StockLine[];
  quantity: number | null;
  status: StockStatus;
  toBuy: number | null;
  /** Résumé des prix d'achat ; null si aucun prix exploitable. */
  pricing: Pricing | null;
};

export type Movement = {
  id: string;
  type: "adjust" | "inventory" | "purchase" | "consume" | "move";
  delta: number | null;
  quantityAfter: number | null;
  note: string | null;
  createdAt: string;
  stockItem: { locationId: string | null } | null;
};

export type ProductDetail = Product & {
  movements: Movement[];
  purchases: Purchase[];
  recipes: { id: string; name: string; photoId: string | null }[];
};

export type Ingredient = {
  id?: string;
  name: string;
  productId: string | null;
  quantity: number | null;
  unit: string | null;
  note: string | null;
  /** Autres produits acceptés à la place de productId (« Pâtes » → tagliatelles, coquillettes). */
  alternatives?: string[];
};

export type RecipeSummary = {
  id: string;
  name: string;
  description: string | null;
  photoId: string | null;
  favorite: boolean;
  tags: string[];
  servings: number | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  difficulty: number | null;
  updatedAt: string;
  categoryIds: string[];
  ingredients: { id: string; name: string; productId: string | null; quantity: number | null; unit: string | null; note: string | null; alternatives: string[] }[];
  stepCount: number;
};

export type Recipe = Omit<RecipeSummary, "ingredients" | "stepCount"> & {
  notes: string | null;
  createdAt: string;
  ingredients: Ingredient[];
  steps: { id: string; text: string }[];
};

export type RecipeInput = Partial<{
  name: string;
  description: string | null;
  servings: number | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  difficulty: number | null;
  notes: string | null;
  favorite: boolean;
  tags: string[];
  photoId: string | null;
  categoryIds: string[];
  ingredients: Omit<Ingredient, "id">[];
  steps: { text: string }[];
}>;

export type ProductInput = Partial<{
  name: string;
  photoId: string | null;
  categoryId: string | null;
  unit: string | null;
  minStock: number | null;
  targetStock: number | null;
  defaultLocationId: string | null;
  brand: string | null;
  reference: string | null;
  notes: string | null;
  quantity: number | null;
  locationId: string | null;
}>;

export type SearchResult = {
  recipes: { id: string; name: string; photoId: string | null; reason: string | null }[];
  products: { id: string; name: string; photoId: string | null; brand: string | null; unit: string | null; category: string | null }[];
  categories: { id: string; name: string; kind: CategoryKind; icon: string | null }[];
  locations: { id: string; name: string; icon: string | null }[];
};

export type Invite = { id: string; code: string; expiresAt: string };

// ─── Phase 2 : planning & courses ────────────────────────────────────────────

export type MealPlanItem = {
  id: string;
  date: string;
  meal: "breakfast" | "lunch" | "snack" | "dinner";
  position: number;
  recipeId: string | null;
  title: string | null;
  servings: number | null;
  note: string | null;
  cookedAt: string | null;
};

export type ShoppingItem = {
  id: string;
  productId: string | null;
  name: string;
  quantity: number | null;
  unit: string | null;
  quantityOverride: number | null;
  neededQty: number | null;
  stockQty: number | null;
  source: "manual" | "plan" | "restock";
  recipesLabel: string | null;
  checked: boolean;
  checkedAt: string | null;
  note: string | null;
  position: number;
  createdAt: string;
};

export type ShoppingList = {
  list: { id: string; planFrom: string | null; planTo: string | null };
  items: ShoppingItem[];
};

// ─── Phase 3 : achats & prix ─────────────────────────────────────────────────

export type PricePoint = { id: string; date: string; unitCents: number; isPromo: boolean; store: string | null };
export type Pricing = { count: number; avgCents: number; last: PricePoint; best: PricePoint; history?: PricePoint[] };

export type Purchase = {
  id: string;
  date: string;
  quantity: number | null;
  unit: string | null;
  totalCents: number | null;
  isPromo: boolean;
  note: string | null;
  store: { name: string } | null;
};

export type PurchaseWithProduct = Purchase & { productId: string; product: { name: string; categoryId: string | null; photoId: string | null } };
export type Store = { id: string; name: string; usage: number };
export type InventoryCorrection = {
  id: string;
  delta: number | null;
  quantityAfter: number | null;
  createdAt: string;
  product: { id: string; name: string; unit: string | null };
  stockItem: { locationId: string | null } | null;
};
