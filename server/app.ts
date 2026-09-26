import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { HttpError } from "./http";
import { authRoutes, householdRoutes } from "./routes/auth";
import { photoRoutes, searchRoutes } from "./routes/misc";
import { planRoutes } from "./routes/plan";
import { productRoutes, stockRoutes } from "./routes/products";
import { inventoryRoutes, purchaseRoutes } from "./routes/purchases";
import { recipeRoutes } from "./routes/recipes";
import { categoryRoutes, locationRoutes } from "./routes/refs";
import { shoppingRoutes } from "./routes/shopping";

export const api = new Hono()
  // Refuse les requêtes d'écriture venant d'une autre origine (cookie SameSite=Lax en complément).
  // On compare l'hôte (et non l'origine complète) car derrière nginx / le proxy Vite
  // le serveur voit http://127.0.0.1 alors que le navigateur envoie https://domaine.
  .use(
    csrf({
      origin: (origin, c) => {
        try {
          return new URL(origin).host === (c.req.header("x-forwarded-host") ?? c.req.header("host"));
        } catch {
          return false;
        }
      },
    }),
  )
  .use(bodyLimit({ maxSize: 16 * 1024 * 1024, onError: (c) => c.json({ error: "Requête trop volumineuse" }, 413) }))
  .route("/auth", authRoutes)
  .route("/household", householdRoutes)
  .route("/categories", categoryRoutes)
  .route("/locations", locationRoutes)
  .route("/products", productRoutes)
  .route("/stock", stockRoutes)
  .route("/recipes", recipeRoutes)
  .route("/photos", photoRoutes)
  .route("/search", searchRoutes)
  .route("/plan", planRoutes)
  .route("/shopping", shoppingRoutes)
  .route("/purchases", purchaseRoutes)
  .route("/inventory", inventoryRoutes)
  .get("/health", (c) => c.json({ ok: true }))
  .notFound((c) => c.json({ error: "Route inconnue" }, 404))
  .onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    if (err instanceof HTTPException) return c.json({ error: err.message || "Requête refusée" }, err.status);
    console.error(err);
    return c.json({ error: "Erreur serveur" }, 500);
  });
