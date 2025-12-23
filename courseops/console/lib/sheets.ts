import crypto from "crypto";
import { google } from "googleapis";

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
  courseSheetId: string,
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
  const base = [courseSheetId, row.priority, row.action, row.reason, row.target, row.rooms, row.rec, row.current].join("|");
  return crypto.createHash("sha1").update(base).digest("hex");
}

function parseServiceAccount() {
  const raw = String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is required");
  const j = JSON.parse(raw);
  const clientEmail = String(j.client_email || "");
  const privateKey = String(j.private_key || "");
  if (!clientEmail || !privateKey) throw new Error("invalid GOOGLE_SERVICE_ACCOUNT_JSON");
  return { clientEmail, privateKey };
}

async function getSheets() {
  const { clientEmail, privateKey } = parseServiceAccount();
  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  return sheets;
}

export async function fetchActionsFromSheet(opts: { sheetId: string; actionsTab: string }) {
  const sheets = await getSheets();
  const range = `${opts.actionsTab}!A1:G2000`;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: opts.sheetId, range });
  const values = (res.data.values || []) as string[][];

  const lastUpdatedAt = (() => {
    const r2 = values[1]?.[0] ? String(values[1][0]) : "";
    const m = r2.match(/(\d{4}-\d{2}-\d{2}T[0-9:]+(?:\.\d+)?(?:Z|\+00:00)?)/);
    return m ? m[1] : null;
  })();

  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(values.length, 50); i++) {
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
      key: stableKey(opts.sheetId, row),
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

