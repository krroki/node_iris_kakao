export type SheetLikeTable = { header: string[]; rows: string[][] };

function normalizeRows(values: unknown): string[][] {
  if (!Array.isArray(values)) return [];
  return values.map((r) => (Array.isArray(r) ? r.map((x) => String(x ?? "").trim()) : []));
}

export function asTable(values: unknown): SheetLikeTable {
  const rows = normalizeRows(values);
  if (rows.length === 0) return { header: [], rows: [] };
  const header = (rows[0] || []).map((x) => String(x ?? "").trim());
  return { header, rows: rows.slice(1) };
}

export function getSnapshotTables(payload: any) {
  const p = payload && typeof payload === "object" ? payload : {};
  const tables = p.tables && typeof p.tables === "object" ? p.tables : {};
  return {
    rulesRaw: tables.rulesRaw,
    auditView: tables.auditView,
    openchatRaw: tables.openchatRaw,
    ssotRaw: tables.ssotRaw,
    actions: tables.actions,
  };
}

