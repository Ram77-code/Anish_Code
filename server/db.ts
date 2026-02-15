
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";



const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

let parsedDatabaseUrl: URL;
try {
  parsedDatabaseUrl = new URL(databaseUrl);
} catch {
  throw new Error("DATABASE_URL is not a valid URL.");
}

const invalidHostnames = new Set(["host", "base", "localhost"]);
if (
  invalidHostnames.has(parsedDatabaseUrl.hostname.toLowerCase()) ||
  /user|password|dbname/i.test(databaseUrl)
) {
  throw new Error(
    "DATABASE_URL appears to be a placeholder/invalid value. In Render, set DATABASE_URL from a Render PostgreSQL instance connection string.",
  );
}

export const pool = new Pool({ connectionString: databaseUrl });
export const db = drizzle(pool, { schema });

//  "dev": "NODE_ENV=development tsx server/index.ts",
