import crypto from "crypto";

export type ActionItem = {
  key: string;
  priority: "지금" | "오늘" | "확인" | "정리";
  action: string;
  reason: string;
  target: string;
  rooms: string;
  recommendedNickname: string;
  currentNicknames: string;
};

function stableKey(
  courseId: string,
  row: {
    priority: string;
    action: string;
    reason: string;
    target: string;
    rooms: string;
    rec: string;
    current: string;
  },
) {
  const base = [courseId, row.priority, row.action, row.reason, row.target, row.rooms, row.rec, row.current].join("|");
  return crypto.createHash("sha1").update(base).digest("hex");
}

function normalizeRows(values: unknown): string[][] {
  if (!Array.isArray(values)) return [];
  return values
    .map((r) => (Array.isArray(r) ? r.map((x) => String(x ?? "").trim()) : []))
    .filter((r) => Array.isArray(r));
}

export function parseActionsFromValues(opts: { courseId: string; values: unknown }) {
  const values = normalizeRows(opts.values);

  const lastUpdatedAt = (() => {
    const isoRe = /(\d{4}-\d{2}-\d{2}T[0-9:]+(?:\.\d+)?(?:Z|\+00:00)?)/;
    for (let i = 0; i < Math.min(values.length, 30); i++) {
      const row = values[i] || [];
      const joined = row.join(" ");
      const m = joined.match(isoRe);
      if (m) return m[1];
    }
    return null;
  })();

  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(values.length, 80); i++) {
    const row = values[i] || [];
    if (row[0] === "우선순위" && row[1] === "해야 할 일") {
      headerRowIndex = i;
      break;
    }
  }
  if (headerRowIndex < 0) {
    return { lastUpdatedAt, items: [] as ActionItem[] };
  }

  const out: ActionItem[] = [];
  for (let i = headerRowIndex + 1; i < values.length; i++) {
    const r = values[i] || [];
    const priority = String(r[0] || "").trim();
    const action = String(r[1] || "").trim();
    if (!priority || !action) continue;
    const row = {
      priority,
      action,
      reason: String(r[2] || "").trim(),
      target: String(r[3] || "").trim(),
      rooms: String(r[4] || "").trim(),
      rec: String(r[5] || "").trim(),
      current: String(r[6] || "").trim(),
    };
    const p = (["지금", "오늘", "확인", "정리"] as const).includes(priority as any) ? (priority as any) : "정리";
    out.push({
      key: stableKey(opts.courseId, row),
      priority: p,
      action: row.action,
      reason: row.reason,
      target: row.target,
      rooms: row.rooms,
      recommendedNickname: row.rec,
      currentNicknames: row.current,
    });
  }

  return { lastUpdatedAt, items: out };
}

