import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: {
    host: true,
    // Transmet l'hôte d'origine (vérification CSRF), comme nginx en production.
    proxy: { "/api": { target: "http://localhost:3005", changeOrigin: false, xfwd: true } },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Foyer — recettes, stock & courses",
        short_name: "Foyer",
        description: "Recettes, planning, courses et stock du foyer",
        lang: "fr",
        start_url: "/",
        scope: "/",
        display: "standalone",
        // Rotation libre : le planning se lit en grille quand le téléphone est tourné.
        orientation: "any",
        background_color: "#f7f4ef",
        theme_color: "#f7f4ef",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        runtimeCaching: [
          {
            // Photos immuables : disponibles hors connexion une fois vues.
            urlPattern: ({ url }) => url.pathname.startsWith("/api/photos/"),
            handler: "CacheFirst",
            options: {
              cacheName: "photos",
              expiration: { maxEntries: 800, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
});
