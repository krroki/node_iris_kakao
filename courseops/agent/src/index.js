import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const consoleBase = String(process.env.COURSEOPS_CONSOLE_BASE_URL || "").replace(/\/$/, "");
const agentToken = String(process.env.COURSEOPS_AGENT_TOKEN || "");
const agentName = String(process.env.COURSEOPS_AGENT_NAME || "courseops-agent");
const pollSec = Math.max(1, Number(process.env.COURSEOPS_POLL_SEC || "2"));
const repoRoot = String(process.env.COURSEOPS_REPO_ROOT || "C:\\dev\\12.kakao");

if (!consoleBase) throw new Error("COURSEOPS_CONSOLE_BASE_URL is required");
if (!agentToken) throw new Error("COURSEOPS_AGENT_TOKEN is required");

const statePath = path.join(repoRoot, "node-iris-app", "data", "course_membership_audit_worker_state.json");
const agentStatusPath = path.join(repoRoot, "node-iris-app", "data", "courseops_agent_status.json");
const agentStartedTs = new Date().toISOString();
let lastHeartbeatMs = 0;

function writeAgentStatus(extra = {}) {
  const now = new Date().toISOString();
  const j = {
    pid: process.pid,
    agentName,
    consoleBase,
    startedTs: agentStartedTs,
    heartbeatTs: now,
    ...extra,
  };
  try {
    writeJsonAtomic(agentStatusPath, j);
  } catch {}
}

function heartbeat(extra = {}) {
  const nowMs = Date.now();
  if (nowMs - lastHeartbeatMs < 1500) return;
  lastHeartbeatMs = nowMs;
  writeAgentStatus(extra);
}

function resolveAuditConfigPath() {
  const raw = String(process.env.COURSE_MEMBERSHIP_AUDIT_CONFIG || "").trim();
  if (!raw) return path.join(repoRoot, "data", "course_membership_audit.json");
  return path.isAbsolute(raw) ? raw : path.join(repoRoot, raw);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readText(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function readJson(p) {
  try {
    const s = fs.readFileSync(p, "utf8");
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function writeJsonAtomic(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, p);
}

function readJsonStrict(p) {
  const s = readText(p).trim();
  if (!s) return {};
  let j = null;
  try {
    j = JSON.parse(s);
  } catch {
    throw new Error("설정 파일(JSON) 파싱에 실패했어요.");
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) {
    throw new Error("설정 파일(JSON) 형식이 올바르지 않아요.");
  }
  return j;
}

function parseClubId(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    const qp = String(u.searchParams.get("clubid") || u.searchParams.get("clubId") || "").trim();
    if (/^\d+$/.test(qp)) return qp;
    const m2 = u.pathname.match(/\/ca-fe\/cafes\/(\d+)(?:\/|$)/i);
    if (m2) return String(m2[1] || "").trim();
    const m3 = u.pathname.match(/\/cafes\/(\d+)(?:\/|$)/i);
    if (m3) return String(m3[1] || "").trim();
  } catch {}
  const m1 = s.match(/[?&]clubid=(\d+)/i);
  if (m1) return String(m1[1] || "").trim();
  const m4 = s.match(/\/ca-fe\/cafes\/(\d+)(?:\/|$)/i);
  if (m4) return String(m4[1] || "").trim();
  const m5 = s.match(/\/cafes\/(\d+)(?:\/|$)/i);
  if (m5) return String(m5[1] || "").trim();
  if (/^\d+$/.test(s)) return s;
  return "";
}

function upsertLocalCourseConfig(course) {
  const p = resolveAuditConfigPath();
  const courseKey = String(course?.courseKey || course?.course_key || "").trim();
  if (!courseKey) return { ok: false, error: "강의 정보를 찾지 못했어요." };

  let cfg;
  try {
    cfg = readJsonStrict(p);
  } catch (e) {
    return { ok: false, error: String(e?.message || "로컬 설정 파일을 읽지 못했어요.") };
  }
  if (!cfg || typeof cfg !== "object") cfg = {};
  const courses = typeof cfg.courses === "object" && cfg.courses ? cfg.courses : {};

  const prev = typeof courses[courseKey] === "object" && courses[courseKey] ? courses[courseKey] : {};
  const next = { ...prev };

  const archived = Boolean(course?.archived ?? course?.archived_at ?? false);
  next.enabled = !archived;

  const clubId =
    String(prev.clubId || prev.club_id || "").trim() ||
    String(prev?.cafe?.clubId || prev?.cafe?.club_id || "").trim() ||
    parseClubId(course?.clubId || course?.club_id || course?.cafeUrl || course?.cafe_url || "");
  if (clubId) next.clubId = clubId;

  const rooms = typeof next.rooms === "object" && next.rooms ? { ...next.rooms } : {};
  const chatRoomId = String(course?.openchatChatRoomId || course?.openchat_chat_room_id || "").trim();
  const noticeRoomId = String(course?.openchatNoticeRoomId || course?.openchat_notice_room_id || "").trim();
  const premiumEnabled = course?.premiumEnabled ?? course?.premium_enabled ?? true;
  const premiumRoomId = String(course?.openchatPremiumRoomId || course?.openchat_premium_room_id || "").trim();
  const vipEnabled = Boolean(course?.vipEnabled ?? course?.vip_enabled ?? false);
  const vipRoomId = String(course?.openchatVipRoomId || course?.openchat_vip_room_id || "").trim();

  if (chatRoomId) rooms.chat = chatRoomId;
  if (noticeRoomId) rooms.notice = noticeRoomId;
  rooms.premium = premiumEnabled ? premiumRoomId : "";
  // NOTE: 현 워커(v2 audit)는 vip 룸을 사용하지 않지만, 설정을 미리 보관한다.
  if (vipEnabled) rooms.vip = vipRoomId;
  if (Object.keys(rooms).length > 0) next.rooms = rooms;

  const cafeUrl = String(course?.cafeUrl || course?.cafe_url || "").trim();
  if (cafeUrl) next.cafeUrl = cafeUrl;

  const paymentSheetId = String(course?.paymentSheetId || course?.payment_sheet_id || "").trim();
  const paymentSheetName = String(course?.paymentSheetName || course?.payment_sheet_name || "").trim();
  const paymentHeaderRowRaw = course?.paymentHeaderRow ?? course?.payment_header_row ?? null;
  const paymentHeaderRow = Math.max(1, Number(paymentHeaderRowRaw || 19) || 19);
  const paymentGradeCol = String(course?.paymentGradeCol || course?.payment_grade_col || "").trim() || "카페 등급";
  const paymentNicknameCol = String(course?.paymentNicknameCol || course?.payment_nickname_col || "").trim() || "닉네임";
  const paymentNameCol = String(course?.paymentNameCol || course?.payment_name_col || "").trim() || "성함";
  const paymentIdCol = String(course?.paymentIdCol || course?.payment_id_col || "").trim() || "아이디";
  const paymentKindCol = String(course?.paymentKindCol || course?.payment_kind_col || "").trim() || "구분";
  const paymentExcludeKindsRaw = String(course?.paymentExcludeKinds || course?.payment_exclude_kinds || "").trim() || "환불";
  const paymentExcludeKinds = paymentExcludeKindsRaw
    .split(/[,\n\r]+/g)
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, 20);

  if (paymentSheetId) {
    next.paymentSsot = {
      spreadsheetId: paymentSheetId,
      sheetName: paymentSheetName || "종합",
      headerRow: paymentHeaderRow,
      gradeCol: paymentGradeCol,
      nicknameCol: paymentNicknameCol,
      nameCol: paymentNameCol,
      idCol: paymentIdCol,
      kindCol: paymentKindCol,
      excludeKinds: paymentExcludeKinds.length > 0 ? paymentExcludeKinds : ["환불"],
    };
  } else {
    delete next.paymentSsot;
  }

  courses[courseKey] = next;
  cfg.courses = courses;
  if (!cfg.version) cfg.version = 1;
  writeJsonAtomic(p, cfg);

  const okClubId = Boolean(String(next.clubId || "").trim());
  return { ok: true, path: p, courseKey, clubId: okClubId ? String(next.clubId || "") : "" };
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-courseops-agent-token": agentToken },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json: j };
}

function safeFilename(s) {
  const bad = /[<>:"/\\|?*]/g;
  const out = String(s || "").trim().replace(bad, "_");
  return out || "course";
}

function readJsonFileStrict(p) {
  const s = readText(p).trim();
  if (!s) throw new Error("스냅샷 파일이 비어 있어요.");
  try {
    return JSON.parse(s);
  } catch {
    throw new Error("스냅샷 파일(JSON) 파싱에 실패했어요.");
  }
}

function runPowershell(scriptPath, args = []) {
  return new Promise((resolve) => {
    const psArgs = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args];
    const child = spawn("powershell.exe", psArgs, { cwd: repoRoot, windowsHide: true });
    child.on("exit", (code) => resolve({ code: code ?? 0 }));
  });
}

async function ensureWorkerRunning() {
  const script = path.join(repoRoot, "windows", "start_course_membership_audit_worker.ps1");
  await runPowershell(script, []);
}

function readIrisBase() {
  const envUrl = String(process.env.IRIS_URL || process.env.IRIS_QUERY_BASE || process.env.IRIS_BRIDGE_URL || "").trim();
  if (envUrl) return envUrl.replace(/\/$/, "");
  const p = path.join(repoRoot, "config", "windows", "iris_url.txt");
  const s = readText(p).trim();
  return (s || "http://127.0.0.1:5050").replace(/\/$/, "");
}

async function irisQuery(query, bind, timeoutMs = 20000) {
  const irisBase = readIrisBase();
  const url = `${irisBase}/query`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Math.max(1000, timeoutMs));
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, bind }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`IRIS /query 실패(HTTP ${res.status})`);
    const j = await res.json().catch(() => ({}));
    const data = Array.isArray(j?.data) ? j.data : [];
    return data.filter((x) => x && typeof x === "object");
  } finally {
    clearTimeout(t);
  }
}

const KOREAN_RE = /[가-힣ㄱ-ㅎㅏ-ㅣ]/;

function decodeNickname(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (KOREAN_RE.test(s)) return s;
  try {
    const decoded = Buffer.from(s, "latin1").toString("utf8").trim();
    if (decoded && KOREAN_RE.test(decoded)) return decoded;
  } catch {}
  try {
    if (s.length >= 16 && s.length % 4 === 0 && /^[A-Za-z0-9+/=]+$/.test(s)) {
      const decoded = Buffer.from(s, "base64").toString("utf8").trim();
      if (decoded && KOREAN_RE.test(decoded)) return decoded;
    }
  } catch {}
  return s;
}

function extractCafeNickFromOpenchatNickname(nick) {
  const s = String(nick || "").trim();
  if (!s) return "";
  const m1 = s.match(/[（(]([^（）()\n\r]{1,100})[）)]\s*$/);
  if (m1 && m1[1]) return String(m1[1]).trim();
  const m2 = s.match(/[/／]\s*([^/／\s]{1,100})\s*$/);
  if (m2 && m2[1]) return String(m2[1]).trim();
  return "";
}

function normalizeCafeNick(s) {
  return String(s || "").replace(/\s+/gu, "").trim();
}

async function fetchOpenchatMembers(roomId) {
  const rid = String(roomId || "").trim();
  if (!rid) return [];

  const rows = await irisQuery("select link_id from chat_rooms where id=?", [rid], 10000);
  const linkIdRaw = rows?.[0]?.link_id;
  const linkId = linkIdRaw === 0 || linkIdRaw ? String(linkIdRaw).trim() : "";
  if (!linkId) return [];

  const out = new Map();
  let offset = 0;
  const pageSize = 500;
  while (true) {
    const chunk = await irisQuery(
      "select user_id, nickname, enc from db2.open_chat_member where link_id=? order by nickname limit ? offset ?",
      [Number(linkId), pageSize, offset],
      30000,
    );
    if (!chunk || chunk.length === 0) break;
    for (const row of chunk) {
      const uid = String(row.user_id || "").trim();
      if (!uid) continue;
      const nick = decodeNickname(row.nickname);
      if (!out.has(uid)) out.set(uid, { userId: uid, nickname: nick });
      else if (nick && !out.get(uid).nickname) out.get(uid).nickname = nick;
    }
    if (chunk.length < pageSize) break;
    offset += pageSize;
  }

  return Array.from(out.values());
}

function triggerCourseRunOnce(courseKey) {
  const now = Date.now();
  const j = readJson(statePath);
  const courses = typeof j.courses === "object" && j.courses ? j.courses : {};
  const cs = typeof courses[courseKey] === "object" && courses[courseKey] ? courses[courseKey] : {};
  cs.nextRunMs = now;
  cs.nextRunTs = new Date(now).toISOString();
  courses[courseKey] = cs;
  j.courses = courses;
  writeJsonAtomic(statePath, j);
  return now;
}

function pickCourseKey(job) {
  const courseKey = job?.course?.courseKey || job?.course?.course_key || job?.courseKey;
  return String(courseKey || "").trim();
}

function getCourseState(courseKey) {
  const j = readJson(statePath);
  const cs = j?.courses?.[courseKey];
  return typeof cs === "object" && cs ? cs : null;
}

async function report(jobId, payload) {
  await postJson(`${consoleBase}/api/agent/report`, { jobId, ...payload });
}

async function runSyncFull(job) {
  const courseKey = pickCourseKey(job);
  if (!courseKey) {
    await report(job.id, { status: "FAILED", resultMessage: "강의를 찾지 못했어요." });
    return;
  }

  try {
    const r = upsertLocalCourseConfig(job.course || job?.payload?.course || {});
    if (!r.ok) {
      await report(job.id, { status: "FAILED", resultMessage: String(r.error || "설정에 실패했어요.") });
      return;
    }
    if (!r.clubId) {
      await report(job.id, {
        status: "FAILED",
        resultMessage: "카페 clubId가 필요해요. 설정에서 clubId를 입력해 주세요.",
        events: [{ level: "ERROR", message: "코스 설정에 clubId가 없어요. (카페 URL에 clubid=가 포함된 주소면 clubId 입력을 생략할 수 있어요.)" }],
      });
      return;
    }
  } catch (e) {
    await report(job.id, { status: "FAILED", resultMessage: "로컬 설정을 업데이트하지 못했어요." });
    return;
  }

  await ensureWorkerRunning();

  const startedAt = triggerCourseRunOnce(courseKey);
  await report(job.id, {
    status: "RUNNING",
    progressPct: 1,
    progressMessage: "동기화를 시작했어요.",
    events: [{ level: "INFO", message: `${courseKey} 동기화를 시작했어요.` }],
  });

  const deadline = Date.now() + 25 * 60 * 1000;
  let lastMsg = "";

  while (Date.now() < deadline) {
    const cs = getCourseState(courseKey);
    const progress = cs?.progress || {};
    const msg = String(progress?.message || "").trim();
    const pct = typeof progress?.pct === "number" ? progress.pct : null;

    if (msg && msg !== lastMsg) {
      lastMsg = msg;
      await report(job.id, {
        status: "RUNNING",
        progressPct: pct,
        progressMessage: msg,
        events: [{ level: "INFO", message: msg }],
      });
    } else {
      await report(job.id, { status: "RUNNING", progressPct: pct, progressMessage: msg || null, events: [] });
    }

    const lastRunMs = Number(cs?.lastRunMs || 0);
    const lastResult = String(cs?.lastResult || "").trim();
    if (lastRunMs && lastRunMs >= startedAt && (lastResult === "OK" || lastResult === "ERROR")) {
      if (lastResult === "OK") {
        // 스냅샷 업로드까지 성공해야 웹 콘솔에 결과가 반영된다.
        try {
          await report(job.id, {
            status: "RUNNING",
            progressPct: 99,
            progressMessage: "웹 콘솔로 결과를 전송하는 중...",
            events: [{ level: "INFO", message: "웹 콘솔로 결과를 전송하는 중..." }],
          });

          const courseId = String(job?.course?.id || job?.courseId || "").trim();
          if (!courseId) throw new Error("courseId를 찾지 못했어요.");

          const snapshotPath =
            String(cs?.lastSnapshotPath || "").trim() ||
            path.join(repoRoot, "node-iris-app", "data", "courseops_snapshots", `${safeFilename(courseKey)}.json`);
          const payload = readJsonFileStrict(snapshotPath);
          const fetchedAt = String(payload?.fetchedAt || cs?.lastSnapshotFetchedAt || cs?.lastOkTs || "").trim() || null;

          const up = await postJson(`${consoleBase}/api/agent/snapshot`, { courseId, fetchedAt, payload });
          if (!up.ok) throw new Error(`스냅샷 업로드에 실패했어요(HTTP ${up.status}).`);

          await report(job.id, {
            status: "DONE",
            progressPct: 100,
            progressMessage: "완료됐어요.",
            resultMessage: "완료됐어요.",
            events: [{ level: "INFO", message: "완료됐어요." }],
          });
        } catch (e) {
          const msg = String(e?.message || "스냅샷 업로드에 실패했어요.");
          await report(job.id, {
            status: "FAILED",
            progressPct: 100,
            progressMessage: msg,
            resultMessage: msg,
            events: [{ level: "ERROR", message: msg }],
          });
        }
      } else {
        const errUser = String(cs?.lastErrorUser || cs?.lastError || "").trim() || "실패했어요.";
        await report(job.id, {
          status: "FAILED",
          progressPct: 100,
          progressMessage: errUser,
          resultMessage: errUser,
          events: [{ level: "ERROR", message: errUser }],
        });
      }
      return;
    }

    await sleep(2500);
  }

  await report(job.id, {
    status: "FAILED",
    progressPct: 100,
    progressMessage: "시간이 오래 걸려서 중단됐어요.",
    resultMessage: "시간이 오래 걸려서 중단됐어요.",
    events: [{ level: "ERROR", message: "시간이 오래 걸려서 중단됐어요." }],
  });
}

function parseRoomLabels(s) {
  const t = String(s || "")
    .split(/[,，\n\r]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
  return Array.from(new Set(t));
}

function roomTypeFromLabel(label) {
  const s = String(label || "").trim();
  if (s === "사담방") return "chat";
  if (s === "공지방") return "notice";
  if (s === "프리미엄방") return "premium";
  return "";
}

function readOpenchatLoadOpts() {
  const fallback = { serial: "", scrolls: 200, scrollPauseMs: 400, timeoutSec: 300 };
  try {
    const cfg = readJsonStrict(resolveAuditConfigPath());
    const w = cfg?.worker && typeof cfg.worker === "object" ? cfg.worker : {};
    const o = w?.openchatAutoLoad && typeof w.openchatAutoLoad === "object" ? w.openchatAutoLoad : {};
    const serial = String(o.serial || o.adbSerial || o.adb_serial || "").trim();
    const scrolls = Math.max(50, Math.min(3000, Number(o.scrolls || 200)));
    const scrollPauseMs = Math.max(150, Math.min(2000, Number(o.scrollPauseMs || 400)));
    const timeoutSec = Math.max(60, Math.min(1800, Number(o.timeoutSec || 300)));
    return { serial, scrolls, scrollPauseMs, timeoutSec };
  } catch {
    return fallback;
  }
}

async function refreshRoomMembers(roomId, label, jobId) {
  const script = path.join(repoRoot, "scripts", "openchat_load_members.ps1");
  if (!fs.existsSync(script)) return { ok: false, code: 404 };

  const opts = readOpenchatLoadOpts();
  await report(jobId, {
    status: "RUNNING",
    progressMessage: `${label} 멤버를 새로 불러오는 중...`,
    events: [{ level: "INFO", message: `${label} 멤버 DB 갱신을 시작했어요.` }],
  });

  const args = [
    "-RoomId",
    String(roomId),
    "-Scrolls",
    String(opts.scrolls),
    "-ScrollPauseMs",
    String(opts.scrollPauseMs),
    "-IrisQueryBase",
    readIrisBase(),
  ];
  if (opts.serial) args.push("-Serial", opts.serial);
  const r = await runPowershell(script, args);
  const ok = r.code === 0;
  await report(jobId, {
    status: "RUNNING",
    progressMessage: ok ? `${label} 멤버 갱신 완료` : `${label} 멤버 갱신이 미완료예요`,
    events: [{ level: ok ? "INFO" : "WARN", message: ok ? `${label} 멤버 DB 갱신이 끝났어요.` : `${label} 멤버 DB 갱신이 미완료예요. (데이터 미완전으로 처리될 수 있어요.)` }],
  });
  return { ok, code: r.code };
}

async function runReverifyPending(job) {
  const courseKey = pickCourseKey(job);
  const items = Array.isArray(job?.payload?.items) ? job.payload.items : [];
  if (!courseKey || items.length === 0) {
    await report(job.id, {
      status: "DONE",
      progressPct: 100,
      progressMessage: "확인할 항목이 없어요.",
      resultMessage: "확인할 항목이 없어요.",
      events: [{ level: "INFO", message: "확인할 항목이 없어요." }],
      actionUpdates: [],
    });
    return;
  }

  try {
    upsertLocalCourseConfig(job.course || job?.payload?.course || {});
  } catch {}

  const cs = getCourseState(courseKey);
  let lastRooms = cs?.lastRooms || cs?.last_rooms || null;
  if (!lastRooms || typeof lastRooms !== "object") {
    lastRooms = {};
    await report(job.id, {
      status: "RUNNING",
      progressPct: 1,
      progressMessage: "방 정보가 없어 코스 설정의 roomId로 재검증해요.",
      events: [{ level: "WARN", message: "최근 동기화 정보가 없어서 코스 설정(roomId) 기준으로 재검증을 진행해요." }],
    });
  }

  const updates = [];
  const memberCache = new Map();

  const course = job?.course || null;
  const courseRooms = {
    chat: String(course?.openchatChatRoomId || course?.openchat_chat_room_id || "").trim(),
    notice: String(course?.openchatNoticeRoomId || course?.openchat_notice_room_id || "").trim(),
    premium: Boolean(course?.premiumEnabled ?? course?.premium_enabled ?? true)
      ? String(course?.openchatPremiumRoomId || course?.openchat_premium_room_id || "").trim()
      : "",
  };

  const neededRoomTypes = new Set();
  for (const it of items) {
    const labels = parseRoomLabels(String(it.rooms || ""));
    for (const l of labels) {
      const rt = roomTypeFromLabel(l);
      if (rt) neededRoomTypes.add(rt);
    }
  }

  // 1) 빠른 재검증은 '필요한 방'만 멤버 DB를 먼저 갱신한다.
  const roomRefresh = new Map();
  for (const rt of Array.from(neededRoomTypes)) {
    const info = (lastRooms && typeof lastRooms === "object" ? lastRooms?.[rt] : null) || null;
    const roomId = String(info?.roomId || courseRooms?.[rt] || "").trim();
    if (!roomId) {
      roomRefresh.set(rt, { ok: false, code: 400, roomId: "" });
      continue;
    }
    const label = rt === "chat" ? "사담방" : rt === "notice" ? "공지방" : "프리미엄방";
    const rr = await refreshRoomMembers(roomId, label, job.id);
    roomRefresh.set(rt, { ...rr, roomId });
  }

  const total = items.length;
  let processed = 0;

  for (const it of items) {
    processed += 1;
    const actionKey = String(it.actionKey || "").trim();
    const action = String(it.action || "").trim();
    const target = String(it.target || "").trim();
    const roomsText = String(it.rooms || "").trim();

    const pct = Math.floor((processed / Math.max(1, total)) * 100);
    await report(job.id, {
      status: "RUNNING",
      progressPct: pct,
      progressMessage: `확인 중 ${processed}/${total}`,
      events: [],
    });

    if (!actionKey || !target) continue;

    const expect =
      action === "프리미엄방 정리"
        ? "absent"
        : action === "톡방 입장 안내" || action === "카페 가입 확인 후 톡방 입장 안내"
          ? "present"
          : null;
    if (!expect) continue;

    const labels = parseRoomLabels(roomsText);
    const roomTypes = labels.map(roomTypeFromLabel).filter(Boolean);
    if (roomTypes.length === 0) continue;

    let unknown = false;
    const roomIds = [];
    for (const rt of roomTypes) {
      const rr = roomRefresh.get(rt) || null;
      const roomId = String(rr?.roomId || "").trim();
      const incomplete = rr && rr.ok === false;
      if (!roomId || incomplete) {
        unknown = true;
        break;
      }
      roomIds.push(roomId);
    }
    if (unknown) {
      updates.push({ actionKey, status: "확인 불가(데이터 미완전)" });
      continue;
    }

    const targetKey = normalizeCafeNick(target);
    let ok = true;
    for (const roomId of roomIds) {
      if (!memberCache.has(roomId)) {
        const members = await fetchOpenchatMembers(roomId);
        memberCache.set(roomId, members);
      }
      const members = memberCache.get(roomId) || [];
      const present = members.some((m) => normalizeCafeNick(extractCafeNickFromOpenchatNickname(m.nickname)) === targetKey);
      if (expect === "present" && !present) ok = false;
      if (expect === "absent" && present) ok = false;
    }

    updates.push({ actionKey, status: ok ? "완료(검증됨)" : "미해결(재확인)" });
  }

  await report(job.id, {
    status: "DONE",
    progressPct: 100,
    progressMessage: "확인이 끝났어요.",
    resultMessage: "확인이 끝났어요.",
    events: [{ level: "INFO", message: "확인이 끝났어요." }],
    actionUpdates: updates,
  });
}

async function handleJob(job) {
  if (!job) return;
  heartbeat({ lastJobId: String(job.id || ""), lastJobKind: String(job.kind || "") });
  if (job.kind === "SYNC_FULL") {
    await runSyncFull(job);
    return;
  }
  if (job.kind === "REVERIFY_PENDING") {
    await runReverifyPending(job);
    return;
  }
  await report(job.id, { status: "FAILED", resultMessage: "지원하지 않는 작업이에요." });
}

async function main() {
  writeAgentStatus({ state: "STARTING" });
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      heartbeat({ state: "POLLING" });
      const r = await postJson(`${consoleBase}/api/agent/poll`, { agentName, version: "0.1" });
      if (r.ok && r.json?.job) {
        heartbeat({ state: "WORKING" });
        await handleJob(r.json.job);
      } else {
        await sleep(pollSec * 1000);
      }
    } catch {
      heartbeat({ state: "ERROR" });
      await sleep(Math.max(2, pollSec) * 1000);
    }
  }
}

main();
