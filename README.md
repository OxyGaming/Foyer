# Foyer

PWA mobile-first pour gérer la maison à deux : recettes, stock (alimentaire, hygiène, entretien…), et bientôt planning des repas et liste de courses.

**Principe de base : aucun champ métier obligatoire.** « Tartiflette » seul est une recette valide, « Lessive » seul est un produit valide. On complète plus tard.

## Stack

| Couche | Choix | Pourquoi |
|---|---|---|
| Front | Vite + React 19 + TypeScript, Tailwind 4, React Router 7 | Appli 100 % navigateur : simple à rendre utilisable hors ligne |
| Données côté client | TanStack Query, cache persisté dans IndexedDB | Recettes et stock consultables hors connexion |
| PWA | vite-plugin-pwa (Workbox) | Installable ; interface et photos déjà vues en cache |
| API | Hono sur Node, un seul processus qui sert aussi `dist/` | Léger, même infra que les autres apps du VPS |
| Base | SQLite via Prisma 7 (adapter better-sqlite3) | Même choix qu'Astreinte : zéro serveur de BDD à maintenir |
| Auth | Sessions opaques en cookie httpOnly, bcrypt, invitations par code | Deux utilisateurs, pas de dépendance à un service externe |
| Photos | `sharp` : WebP ≤ 1600 px + miniature ≤ 480 px, EXIF supprimé | Pas d'originaux énormes stockés |

## Démarrer en local

```bash
npm install
cp .env.example .env
npx prisma migrate dev     # crée data/foyer.db
npm run seed:dev           # compte de démo (identifiants dans server/scripts/seed-dev.ts)
npm run dev                # API :3004 + front :5173 (proxy /api)
```

Ouvrir http://localhost:5173. Sur le téléphone (même Wi-Fi) : `http://<IP du PC>:5173`.

Tests : `npm test` (règles de stock, analyse des ingrédients, intégration API avec isolation entre foyers).

## Premier compte en production

```bash
npm run user:create -- --email vous@exemple.fr --name Jessy --household "Foyer Achille"
```

Le mot de passe est demandé au clavier. Ensuite, dans l'appli : **Réglages → Inviter un membre**. Cela génère un code valable 7 jours ; la personne invitée crée son compte depuis l'écran « Créer mon compte » et partage aussitôt toutes les données du foyer.

## Déploiement (VPS existant)

Même modèle que les autres apps : PM2 derrière nginx, port **3004**, domaine **foyer.apps-reseau.fr**.

0. DNS : enregistrement A `foyer.apps-reseau.fr` → IP du VPS
1. `git clone https://github.com/OxyGaming/Foyer.git /var/www/Foyer`, puis `sudo mkdir -p /var/data/foyer && sudo chown ubuntu /var/data/foyer`
2. `sudo apt install sqlite3` (utilisé pour les sauvegardes)
3. Copier `deploy/nginx-foyer.conf` dans `/etc/nginx/sites-available/foyer`, l'activer (`ln -s` dans `sites-enabled`, `sudo nginx -t && sudo systemctl reload nginx`), puis `sudo certbot --nginx -d foyer.apps-reseau.fr`
4. `./deploy/deploy.sh` : sauvegarde la base, pull de `main`, `npm ci`, `prisma migrate deploy`, build, redémarrage PM2
5. Créer le premier compte : `DATABASE_URL=file:/var/data/foyer/foyer.db npm run user:create -- …`

Les photos sont dans `/var/data/foyer/uploads`. Pensez à inclure `/var/data/foyer` dans vos sauvegardes externes.

## Modèle de données

`prisma/schema.prisma`. Séparation stricte :

- **Product** : « Lait demi-écrémé » (catalogue : unité, seuils min/cible, catégorie, marque…)
- **StockItem** : « 4 L présents au garage » (une ligne par produit × emplacement ; quantité inconnue autorisée)
- **StockMovement** : chaque variation (ajustement, consommation, inventaire, déplacement, achat), pour un historique fiable
- **Purchase / Store** : achats et prix en centimes (utilisés à partir de la phase 3)

Tout est rattaché à un **Household**. Un utilisateur appartient à un foyer via **HouseholdMember**, ce qui prépare plusieurs foyers par la suite. Chaque requête API est filtrée par le foyer de la session.

Les ingrédients de recette sont reliés automatiquement à un produit du catalogue (même nom, sans tenir compte des accents ni des majuscules ; « Œufs » = « oeufs »). Le produit est créé s'il n'existe pas. C'est ce lien qui permettra de générer les courses en tenant compte du stock.

## Feuille de route

- [x] **Phase 1** : comptes et foyer partagé, recettes (photos, ingrédients, étapes, catégories, tags, favoris, portions ajustables), produits et stock multi-emplacements, catégories et emplacements hiérarchiques, alertes de stock, inventaire, recherche globale, lecture hors ligne
- [ ] **Phase 2** : planning hebdomadaire (glisser-déposer + « Déplacer vers… »), liste de courses générée depuis le planning moins le stock, articles manuels, file d'attente hors ligne persistante pour cocher en magasin
- [ ] **Phase 3** : historique des achats, prix moyen pondéré, dernier et meilleur prix, valeur du stock
- [ ] **Phase 4** : statistiques, « Que puis-je cuisiner avec mon stock ? »
