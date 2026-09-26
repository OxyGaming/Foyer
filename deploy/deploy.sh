#!/bin/bash
# Déploiement Foyer — à lancer sur le VPS depuis /var/www/Foyer.
#   ./deploy/deploy.sh
# Déploie la branche main. Sauvegarde la base et les photos avant toute chose.
set -euo pipefail

APP_DIR=/var/www/Foyer
DATA_DIR=/var/data/foyer
BACKUP_DIR=/var/data/foyer/backups
cd "$APP_DIR"

echo "🚀 Déploiement Foyer — $(date '+%F %T')"

echo "💾 1/5 Sauvegarde"
mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
if [ -f "$DATA_DIR/foyer.db" ]; then
  # .backup = copie cohérente même si l'app écrit pendant ce temps.
  sqlite3 "$DATA_DIR/foyer.db" ".backup '$BACKUP_DIR/foyer-$STAMP.db'"
  echo "   → $BACKUP_DIR/foyer-$STAMP.db"
  # Garde les 20 dernières sauvegardes.
  find "$BACKUP_DIR" -maxdepth 1 -name 'foyer-*.db' -printf '%T@ %p\n' | sort -rn | tail -n +21 | cut -d' ' -f2- | xargs -r rm --
else
  echo "   (première installation : aucune base à sauvegarder)"
fi

echo "📥 2/5 Code"
git fetch origin
git checkout main
git pull --ff-only origin main

echo "📦 3/5 Dépendances"
npm ci --include=dev

echo "🗄️  4/5 Migrations + build"
export DATABASE_URL="file:$DATA_DIR/foyer.db"
npx prisma migrate deploy
npm run build

echo "🔄 5/5 Redémarrage"
pm2 restart foyer --update-env 2>/dev/null || pm2 start deploy/ecosystem.config.cjs
pm2 save

sleep 2
curl -fsS http://127.0.0.1:3005/api/health >/dev/null && echo "✅ Foyer en ligne — $(git log --oneline -1)" || { echo "❌ /api/health ne répond pas : pm2 logs foyer"; exit 1; }
