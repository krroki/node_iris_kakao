/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

// NOTE: this script reads the already-built TS output.
// Run: cd node-iris-app && npm run build
const {
  isKakaoDefaultNickname,
  resolveKakaoDefaultNicknameRegexesFromRuntime,
} = require("../dist/utils/welcomeTemplatePolicy.js");

function safeString(v) {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return String(v ?? "").trim();
}

function normalizeName(raw) {
  return String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasHangul(v) {
  try {
    return /\p{Script=Hangul}/u.test(String(v || ""));
  } catch {
    return /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(String(v || ""));
  }
}

function decodeNicknameFromDb(raw) {
  const s = safeString(raw);
  if (!s) return "";
  if (hasHangul(s)) return s;
  try {
    const decoded = Buffer.from(s, "latin1").toString("utf8").trim();
    if (decoded && hasHangul(decoded)) return decoded;
  } catch {
    // ignore
  }
  return s;
}

async function readRuntime() {
  const p = path.join(__dirname, "..", "config", "runtime.json");
  try {
    const raw = fs.readFileSync(p, "utf8");
    const j = JSON.parse(raw || "{}");
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}

async function irisQuery(query, bind, timeoutMs = 20000) {
  const base = (process.env.IRIS_QUERY_BASE || process.env.IRIS_URL || "http://127.0.0.1:5050").replace(
    /\/+$/,
    "",
  );
  const url = `${base}/query`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, bind }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String(j?.message || j?.detail || `HTTP ${res.status}`));
    return Array.isArray(j?.data) ? j.data : [];
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

async function irisGetConfig(timeoutMs = 8000) {
  const base = (process.env.IRIS_QUERY_BASE || process.env.IRIS_URL || "http://127.0.0.1:5050").replace(/\/+$/, "");
  const url = `${base}/config`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", signal: ctrl.signal });
    clearTimeout(t);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String(j?.message || j?.detail || `HTTP ${res.status}`));
    return j && typeof j === "object" ? j : {};
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

async function irisDecrypt({ botId, enc, b64Ciphertext, timeoutMs = 8000 }) {
  const base = (process.env.IRIS_QUERY_BASE || process.env.IRIS_URL || "http://127.0.0.1:5050").replace(/\/+$/, "");
  const url = `${base}/decrypt`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: botId, enc, b64_ciphertext: b64Ciphertext }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String(j?.message || j?.detail || `HTTP ${res.status}`));
    const plain = safeString(j?.plain_text);
    if (!plain) throw new Error(String(j?.message || "decrypt returned empty plain_text"));
    return plain;
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

function looksLikeBase64Ciphertext(s) {
  const v = safeString(s);
  if (!v) return false;
  if (v.length < 8) return false;
  if (v.length % 4 !== 0) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(v)) return false;
  try {
    const buf = Buffer.from(v, "base64");
    // Kakao ciphertext is typically AES-block-aligned.
    if (!buf || buf.length < 16) return false;
    if (buf.length % 16 !== 0) return false;
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const roomId = safeString(process.env.ROOM_ID);
  if (!roomId) throw new Error("ROOM_ID missing");

  const root = path.join(__dirname, "..");
  const outDir = path.join(root, "data", "reports", "default_nickname_candidates");
  fs.mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "").replace("Z", "Z");
  const outFile = safeString(process.env.OUT_FILE) || path.join(outDir, `${roomId}_${ts}.json`);

  const uiParticipantsCount = (() => {
    const v = Number(process.env.UI_PARTICIPANTS_COUNT);
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : null;
  })();
  const loadedDistinct = (() => {
    const v = Number(process.env.LOADED_DISTINCT);
    return Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
  })();

  const runtime = await readRuntime();
  const regexes = resolveKakaoDefaultNicknameRegexesFromRuntime(runtime);

  const cfg = await irisGetConfig(8000);
  const botId = (() => {
    const v = Number(cfg?.bot_id ?? cfg?.botId);
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : null;
  })();
  if (!botId) throw new Error("IRIS /config bot_id missing");

  const activeRow = (await irisQuery("select active_members_count as cnt from chat_rooms where id=?", [roomId], 12000))[0] || {};
  const activeMembersCount = (() => {
    const v = Number(activeRow.cnt ?? activeRow.active_members_count);
    return Number.isFinite(v) && v >= 0 ? v : null;
  })();

  const userToNick = new Map();
  let totalRowsSeen = 0;
  const limit = 600;
  let offset = 0;
  for (;;) {
    const rows = await irisQuery(
      "select user_id, nickname, enc from db2.open_chat_member where involved_chat_id=? order by _id desc limit ? offset ?",
      [roomId, limit, offset],
      30000,
    );
    if (!rows.length) break;
    for (const row of rows) {
      const uid = safeString(row?.user_id);
      if (!uid) continue;
      totalRowsSeen += 1;
      if (userToNick.has(uid)) continue;
      const enc = Number(row?.enc);
      const nickRaw = safeString(row?.nickname);
      let nick0 = nickRaw;
      if (looksLikeBase64Ciphertext(nickRaw)) {
        // Decrypt Kakao encrypted nickname using Iris bot_id as key context.
        const plain = await irisDecrypt({
          botId,
          enc: Number.isFinite(enc) ? Math.floor(enc) : 31,
          b64Ciphertext: nickRaw,
        });
        nick0 = plain;
      }
      const nick = normalizeName(decodeNicknameFromDb(nick0)) || uid;
      userToNick.set(uid, nick);
    }
    offset += rows.length;
    if (rows.length < limit) break;
    if (offset > 250000) break;
    if (offset % 600 === 0) {
      console.log(`[progress] loaded=${offset} distinctUsers=${userToNick.size}`);
    }
  }

  const nickTo = new Map();
  let totalDefaultUsers = 0;
  for (const [uid, nick0] of userToNick.entries()) {
    const nick = normalizeName(nick0) || uid;
    if (!isKakaoDefaultNickname(nick, regexes)) continue;
    totalDefaultUsers += 1;
    let rec = nickTo.get(nick);
    if (!rec) {
      rec = { nickname: nick, count: 0, userIdsSample: [] };
      nickTo.set(nick, rec);
    }
    rec.count += 1;
    if (rec.userIdsSample.length < 50) rec.userIdsSample.push(uid);
  }

  const list = Array.from(nickTo.values()).sort(
    (a, b) => b.count - a.count || String(a.nickname).localeCompare(String(b.nickname), "ko"),
  );

  const out = {
    ts: new Date().toISOString(),
    roomId,
    irisBotId: botId,
    activeMembersCount,
    uiParticipantsCount,
    loadedDistinct,
    totalRowsSeen,
    distinctUsersSeen: userToNick.size,
    totalDefaultUsers,
    uniqueDefaultNicknames: list.length,
    nicknames: list,
    note:
      "nickname은 (대부분) 암호화되어 있어 IRIS /decrypt로 복호화한 뒤 기본닉 판별합니다. nickname은 중복될 수 있어 user_id 기준으로 dedup 및 sample(user_id 최대 50개)를 포함합니다.",
  };

  fs.writeFileSync(outFile, JSON.stringify(out, null, 2), "utf8");
  console.log(outFile);
}

main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
