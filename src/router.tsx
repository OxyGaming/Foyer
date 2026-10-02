import { type ComponentType, lazy, Suspense } from "react";
import { Navigate, Outlet, createBrowserRouter, useLocation, useRouteError } from "react-router";
import { Layout } from "./components/Layout";
import { PageLoader } from "./components/ui";
import { ApiError } from "./lib/api";
import { useMe } from "./lib/queries";
import { HomePage } from "./pages/Home";
import { LoginPage, RegisterPage } from "./pages/Login";
import { RecipesPage } from "./pages/Recipes";
import { StockPage } from "./pages/Stock";

// Pages chargées à la demande : l'accueil s'affiche plus vite. Le service worker
// met quand même tous les morceaux en cache, l'appli reste utilisable hors ligne.
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const BulkEditPage = page(() => import("./pages/BulkEdit"), "BulkEditPage");
const CookablePage = page(() => import("./pages/Cookable"), "CookablePage");
const DuplicatesPage = page(() => import("./pages/Duplicates"), "DuplicatesPage");
const IngredientLinksPage = page(() => import("./pages/IngredientLinks"), "IngredientLinksPage");
const InvoiceImportPage = page(() => import("./pages/InvoiceImport"), "InvoiceImportPage");
const InventoryPage = page(() => import("./pages/Inventory"), "InventoryPage");
const SpendingPage = page(() => import("./pages/Spending"), "SpendingPage");
const StatsPage = page(() => import("./pages/Stats"), "StatsPage");
const StockValuePage = page(() => import("./pages/StockValue"), "StockValuePage");
const PlanningPage = page(() => import("./pages/Planning"), "PlanningPage");
const PlanningPrintPage = page(() => import("./pages/PlanningPrint"), "PlanningPrintPage");
const ProductDetailPage = page(() => import("./pages/ProductDetail"), "ProductDetailPage");
const ProductEditPage = page(() => import("./pages/ProductEdit"), "ProductEditPage");
const RecipeBulkEditPage = page(() => import("./pages/RecipeBulkEdit"), "RecipeBulkEditPage");
const RecipeDetailPage = page(() => import("./pages/RecipeDetail"), "RecipeDetailPage");
const RecipeEditPage = page(() => import("./pages/RecipeEdit"), "RecipeEditPage");
const RecipeImportPage = page(() => import("./pages/RecipeImport"), "RecipeImportPage");
const RestockPage = page(() => import("./pages/Restock"), "RestockPage");
const SearchPage = page(() => import("./pages/Search"), "SearchPage");
const ShoppingPage = page(() => import("./pages/Shopping"), "ShoppingPage");
const SettingsPage = page(() => import("./pages/Settings"), "SettingsPage");
const CategoriesPage = page(() => import("./pages/Settings"), "CategoriesPage");
const LocationsPage = page(() => import("./pages/Settings"), "LocationsPage");

function RequireAuth() {
  const me = useMe();
  const location = useLocation();
  if (me.data) return <Outlet />;
  if (me.error instanceof ApiError && me.error.status === 401) {
    return <Navigate to="/connexion" replace state={{ from: location.pathname }} />;
  }
  // Première ouverture sans réseau (rien en cache) : on le dit plutôt que de tourner indéfiniment.
  if (me.error || me.fetchStatus === "paused") {
    return (
      <div className="p-8 text-center text-ink-2">
        <p className="text-4xl">📡</p>
        <p className="mt-2 font-semibold text-ink">Impossible de joindre le serveur</p>
        <p className="mt-1">Vérifiez la connexion puis réessayez.</p>
        <button className="btn-primary mt-4" onClick={() => me.refetch()}>
          Réessayer
        </button>
      </div>
    );
  }
  return <PageLoader />;
}

function RouteError() {
  const error = useRouteError();
  console.error(error);
  return (
    <div className="p-8 text-center text-ink-2">
      <p className="text-4xl">😕</p>
      <p className="mt-2 font-semibold text-ink">Oups, un problème d'affichage</p>
      <p className="mt-1 text-sm">{error instanceof Error ? error.message : "Erreur inattendue"}</p>
      <a href="/" className="btn-primary mt-4">
        Retour à l'accueil
      </a>
    </div>
  );
}

export const router = createBrowserRouter([
  { path: "/connexion", element: <LoginPage /> },
  { path: "/inscription", element: <RegisterPage /> },
  {
    element: <RequireAuth />,
    errorElement: <RouteError />,
    children: [
      // Hors de la mise en page de l'appli : pas de barre de navigation sur la feuille imprimée.
      {
        path: "/planning/imprimer",
        element: (
          <Suspense fallback={<PageLoader />}>
            <PlanningPrintPage />
          </Suspense>
        ),
      },
      // Pleine largeur (vue tableur réservée au PC).
      {
        path: "/stock/tableur",
        element: (
          <Suspense fallback={<PageLoader />}>
            <BulkEditPage />
          </Suspense>
        ),
      },
      // Pleine largeur aussi : tableau sur PC, fiches à faire défiler sur mobile.
      {
        path: "/recettes/tableur",
        element: (
          <Suspense fallback={<PageLoader />}>
            <RecipeBulkEditPage />
          </Suspense>
        ),
      },
      {
        path: "/recettes/ingredients",
        element: (
          <Suspense fallback={<PageLoader />}>
            <IngredientLinksPage />
          </Suspense>
        ),
      },
      {
        element: <Layout />,
        children: [
          { path: "/", element: <HomePage /> },
          { path: "/recettes", element: <RecipesPage /> },
          { path: "/recettes/nouvelle", element: <RecipeEditPage /> },
          { path: "/recettes/avec-mon-stock", element: <CookablePage /> },
          { path: "/recettes/importer", element: <RecipeImportPage /> },
          { path: "/recettes/:id", element: <RecipeDetailPage /> },
          { path: "/recettes/:id/modifier", element: <RecipeEditPage /> },
          { path: "/planning", element: <PlanningPage /> },
          { path: "/courses", element: <ShoppingPage /> },
          { path: "/stock", element: <StockPage /> },
          { path: "/stock/alertes", element: <RestockPage /> },
          { path: "/stock/valeur", element: <StockValuePage /> },
          { path: "/stock/inventaire", element: <InventoryPage /> },
          { path: "/stock/doublons", element: <DuplicatesPage /> },
          { path: "/achats", element: <SpendingPage /> },
          { path: "/achats/importer", element: <InvoiceImportPage /> },
          { path: "/statistiques", element: <StatsPage /> },
          { path: "/produits/nouveau", element: <ProductEditPage /> },
          { path: "/produits/:id", element: <ProductDetailPage /> },
          { path: "/produits/:id/modifier", element: <ProductEditPage /> },
          { path: "/recherche", element: <SearchPage /> },
          { path: "/reglages", element: <SettingsPage /> },
          { path: "/reglages/categories", element: <CategoriesPage /> },
          { path: "/reglages/emplacements", element: <LocationsPage /> },
          { path: "*", element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
]);
