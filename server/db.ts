import fs from "node:fs";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "./generated/prisma/client";
import { env } from "./env";

fs.mkdirSync(path.dirname(env.dbPath), { recursive: true });

export const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: env.dbPath }) });

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
