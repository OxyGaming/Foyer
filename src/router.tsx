import { Navigate, Outlet, createBrowserRouter, useLocation, useRouteError } from "react-router";
import { Layout } from "./components/Layout";
import { PageLoader } from "./components/ui";
import { ApiError } from "./lib/api";
import { useMe } from "./lib/queries";
import { HomePage } from "./pages/Home";
import { LoginPage, RegisterPage } from "./pages/Login";
import { PlanningPage } from "./pages/Planning";
import { ProductDetailPage } from "./pages/ProductDetail";
import { ProductEditPage } from "./pages/ProductEdit";
import { RecipeDetailPage } from "./pages/RecipeDetail";
import { RecipeEditPage } from "./pages/RecipeEdit";
import { RecipesPage } from "./pages/Recipes";
import { RestockPage } from "./pages/Restock";
import { SearchPage } from "./pages/Search";
import { ShoppingPage } from "./pages/Shopping";
import { CategoriesPage, LocationsPage, SettingsPage } from "./pages/Settings";
import { StockPage } from "./pages/Stock";

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
      {
        element: <Layout />,
        children: [
          { path: "/", element: <HomePage /> },
          { path: "/recettes", element: <RecipesPage /> },
          { path: "/recettes/nouvelle", element: <RecipeEditPage /> },
          { path: "/recettes/:id", element: <RecipeDetailPage /> },
          { path: "/recettes/:id/modifier", element: <RecipeEditPage /> },
          { path: "/planning", element: <PlanningPage /> },
          { path: "/courses", element: <ShoppingPage /> },
          { path: "/stock", element: <StockPage /> },
          { path: "/stock/alertes", element: <RestockPage /> },
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
