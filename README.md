# Foyer

PWA mobile-first pour gérer la maison à deux : recettes, planning des repas, liste de courses et stock (alimentaire, hygiène, entretien…).

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
npm run dev                # API :3005 + front :5173 (proxy /api)
```

Ouvrir http://localhost:5173. Sur le téléphone (même Wi-Fi) : `http://<IP du PC>:5173`.

Tests : `npm test` (règles de stock, analyse des ingrédients, intégration API avec isolation entre foyers).

## Premier compte en production

```bash
npm run user:create -- --email vous@exemple.fr --name Jessy --household "Foyer Achille"
```

Le mot de passe est demandé au clavier. Ensuite, dans l'appli : **Réglages → Inviter un membre**. Cela génère un code valable 7 jours ; la personne invitée crée son compte depuis l'écran « Créer mon compte » et partage aussitôt toutes les données du foyer.

## Déploiement (VPS existant)

Même modèle que les autres apps : PM2 derrière nginx, port **3005** (3000-3004 et 3011 déjà pris : astreinte, pointrh, simulateur, pointrh-zd, veille, docker), domaine **foyer.apps-reseau.fr**.

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
- **Purchase / Store** : achats (date, quantité dans l'unité du produit au moment de l'achat, prix total en centimes, magasin, promo, commentaire). Le prix unitaire est toujours calculé, jamais stocké.
- **MealPlanItem** : un repas planifié (date AAAA-MM-JJ sans fuseau, repas, ordre, recette ou libellé libre, portions, « cuisiné »). Pas de conteneur « semaine » : la date suffit, et déplacer un repas d'une semaine à l'autre reste un simple changement de date.
- **ShoppingList / ShoppingListItem** : une liste active par foyer ; les articles viennent du planning (`plan`), des seuils de stock (`restock`) ou de la saisie (`manual`)

Tout est rattaché à un **Household**. Un utilisateur appartient à un foyer via **HouseholdMember**, ce qui prépare plusieurs foyers par la suite. Chaque requête API est filtrée par le foyer de la session.

Les ingrédients de recette sont reliés automatiquement à un produit du catalogue (même nom, sans tenir compte des accents ni des majuscules ; « Œufs » = « oeufs »). Le produit est créé s'il n'existe pas. C'est ce lien qui permet de générer les courses en tenant compte du stock.

### Import de recettes

**Recettes → icône presse-papiers** (`/recettes/importer`).

- **Excel (recommandé)** : bouton « Modèle » → classeur à deux onglets, *Recettes* (une ligne par recette : portions, temps, tags, description, étapes une par ligne, notes) et *Ingrédients* (Recette | Ingrédient | Quantité | Unité | Note). Les colonnes sont reconnues par leur en-tête, dans n'importe quel ordre ; une cellule Recette vide reprend la ligne du dessus ; « 5-6 » donne 6 (note « 5 à 6 »). Lecture/écriture avec `read-excel-file` / `write-excel-file`, chargées à la demande. Code : `src/lib/excelImport.ts` (lecture, testée avec un aller-retour de fichier réel) et `src/lib/excelTemplate.ts` (modèle).
- **Texte collé** : `src/lib/recipeImport.ts` reconnaît titres (☐/☑ en début de ligne, `# Titre`, ou ligne suivie d'une liste), ingrédients en puces (y compris `* ☐ 1 oignon`) et étapes.

Rien n'est enregistré avant l'aperçu : les doublons (mêmes mots dans n'importe quel ordre, dans le fichier ou déjà enregistrés) sont décochés d'office. L'import (`POST /api/recipes/import`) se fait en une seule transaction ; le rapprochement avec le catalogue tolère le pluriel simple (« Tomates » = « tomate »).

### Courses générées depuis le planning

`shared/needs.ts` (testé) : pour la période choisie, les besoins de toutes les recettes non cuisinées sont additionnés par produit (portions prévues comprises), convertis dans l'unité du stock (g↔kg, ml↔cl↔L), puis le stock est déduit. Carbonara (3 œufs) + Crêpes (3 œufs) avec 4 œufs en stock → **Œufs — 2**. Stock suffisant → « Stock suffisant ✓ ». Les quantités corrigées à la main et les articles cochés sont conservés lors des recalculs. Les unités incomparables (« c. à soupe » face à un stock en « paquet ») ne sont jamais converties au hasard.

### Prix et valeur du stock

`shared/prices.ts` (testé) : coût moyen **pondéré par les quantités** (6 × 0,99 + 6 × 1,09 + 6 × 1,05 → 1,04 €/unité), dernier prix, meilleur prix, historique. Les achats sont ramenés à l'unité actuelle du produit (500 g → 0,5 kg) ; les unités incomparables et les achats sans prix sont ignorés : **sans prix exploitable, rien n'est affiché**. La valeur du stock = quantité × coût moyen, uniquement pour les produits qui ont un prix (les autres sont listés comme « non comptés »). Les prix au gramme / millilitre s'affichent au kilo / litre.

### Que puis-je cuisiner ?

`shared/cookable.ts` (testé) : pour chaque recette, chaque ingrédient chiffré relié au stock est disponible, insuffisant (« encore 2 ») ou manquant, avec conversion d'unités et portions prévues. Les basiques (sans quantité, ou « 1 pincée ») ne bloquent jamais une recette : ils sont seulement signalés « à vérifier ». Un produit présent sans quantité connue est considéré comme disponible.

### Hors connexion

- Lecture : cache TanStack Query persisté dans IndexedDB (20 jours ; au-delà de ~24,8 jours `setTimeout` déborde).
- Courses, planning (ajouter, déplacer, retirer un repas) et boutons +/− du stock fonctionnent sans réseau, **même si l'appli est fermée puis rouverte** ; les actions sont rejouées dans l'ordre au retour. Un serveur injoignable avec réseau actif (Wi-Fi du magasin) est traité comme hors ligne.
- Les actions qui relisent planning et stock (recalcul, rangement des achats) attendent le réseau.

## Feuille de route

- [x] **Phase 1** : comptes et foyer partagé, recettes (photos, ingrédients, étapes, catégories, tags, favoris, portions ajustables), produits et stock multi-emplacements, catégories et emplacements hiérarchiques, alertes de stock, inventaire, recherche globale, lecture hors ligne
- [x] **Phase 2** : planning hebdomadaire (glisser-déposer tactile + « Déplacer vers… » / « Dupliquer vers… »), repas affichés configurables, liste de courses générée depuis le planning moins le stock, articles manuels et produits sous le seuil, rangement des achats dans le stock (achat + prix), « C'est cuisiné » qui déduit les ingrédients, cases à cocher hors ligne persistantes
- [x] **Phase 3** : saisie et correction des achats (prix total ou unitaire, magasin, promo), prix moyen pondéré, dernier et meilleur prix, courbe des prix, valeur du stock (totale, par catégorie, par emplacement), page Dépenses (par semaine/mois, catégorie, magasin), magasin au rangement des courses, inventaire par emplacement avec historique des corrections
- [x] **Phase 4** : « Que puis-je cuisiner avec mon stock ? » (recettes classées, manquants ajoutés aux courses en un geste, aussi sur chaque fiche), suggestions au moment de planifier (réalisables avec le stock, favoris oubliés), statistiques (repas planifiés/cuisinés, recettes les plus faites, produits les plus achetés), planning et +/− du stock utilisables hors ligne, pages chargées à la demande
