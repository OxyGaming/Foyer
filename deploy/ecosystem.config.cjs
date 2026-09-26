// PM2 — Foyer (même VPS ; 3000-3004 et 3011 déjà pris par astreinte, pointrh, simulateur, pointrh-zd, veille, docker).
//   pm2 start deploy/ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [
    {
      name: "foyer",
      cwd: "/var/www/Foyer",
      script: "server/index.ts",
      interpreter: "node",
      node_args: "--import tsx",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3005,
        DATABASE_URL: "file:/var/data/foyer/foyer.db",
        UPLOAD_DIR: "/var/data/foyer/uploads",
      },
      max_memory_restart: "400M",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
