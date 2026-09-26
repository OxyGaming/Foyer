import "dotenv/config";
import path from "node:path";

const root = process.cwd();

function resolveFromRoot(p: string) {
  return path.isAbsolute(p) ? p : path.join(root, p);
}

export const env = {
  isProd: process.env.NODE_ENV === "production",
  port: Number(process.env.PORT ?? 3005),
  dbPath: resolveFromRoot((process.env.DATABASE_URL ?? "file:./data/foyer.db").replace(/^file:/, "")),
  uploadDir: resolveFromRoot(process.env.UPLOAD_DIR ?? "./data/uploads"),
  distDir: path.join(root, "dist"),
};
