import fs from "node:fs";
import path from "node:path";

import postgres from "postgres";

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, prepare: false });
const schemaPath = path.join(process.cwd(), "sql", "schema.sql");
const schema = fs.readFileSync(schemaPath, "utf8");

await sql.unsafe(schema);
await sql.end();
console.log("DB init done");

