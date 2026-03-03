import postgres from "postgres";

declare global {
  // eslint-disable-next-line no-var
  var __courseopsSql: postgres.Sql | undefined;
}

export function getSql(): postgres.Sql {
  if (global.__courseopsSql) return global.__courseopsSql;

  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  global.__courseopsSql = sql;
  return sql;
}
