import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { api } from "./app";
import { env } from "./env";
import { cleanupOrphanPhotos } from "./photos";

const app = new Hono();
app.route("/api", api);

// En production, le même processus sert l'application web compilée (dist/).
if (fs.existsSync(env.distDir)) {
  const rel = path.relative(process.cwd(), env.distDir);
  app.use(
    "*",
    serveStatic({
      root: rel,
      onFound: (p, c) => {
        // Le service worker et index.html doivent toujours être revalidés ;
        // les assets fingerprintés peuvent être mis en cache indéfiniment.
        if (p.endsWith("sw.js") || p.endsWith(".html") || p.endsWith(".webmanifest")) c.header("Cache-Control", "no-cache");
        else if (p.includes(`${path.sep}assets${path.sep}`) || p.includes("/assets/")) c.header("Cache-Control", "public, max-age=31536000, immutable");
      },
    }),
  );
  // Repli SPA : toute autre URL renvoie index.html (routage côté client).
  const indexHtml = fs.readFileSync(path.join(env.distDir, "index.html"), "utf8");
  app.get("*", (c) => {
    if (c.req.path.startsWith("/api/")) return c.json({ error: "Route inconnue" }, 404);
    c.header("Cache-Control", "no-cache");
    return c.html(indexHtml);
  });
}

serve({ fetch: app.fetch, port: env.port, hostname: env.isProd ? "127.0.0.1" : "0.0.0.0" }, (info) => {
  console.log(`[foyer] API prête sur http://localhost:${info.port}`);
});

// Ménage des photos orphelines au démarrage puis toutes les 6 h.
const cleanup = () => cleanupOrphanPhotos().then((n) => n && console.log(`[foyer] ${n} photo(s) orpheline(s) supprimée(s)`)).catch(console.error);
setTimeout(cleanup, 10_000);
setInterval(cleanup, 6 * 60 * 60 * 1000);
