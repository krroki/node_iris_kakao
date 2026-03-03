import { NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SyncResult = {
  ok: boolean;
  roomId: string;
  roomName?: string | null;
  counts?: {
    activeMembersCount?: number | null;
    loadedMembersCount?: number | null;
    fetched?: number | null;
  };
  sheets?: {
    sheetName?: string | null;
    updates?: number | null;
    appends?: number | null;
    existing?: number | null;
  };
  hintCommand?: string | null;
  stdout?: string;
  stderr?: string;
  error?: string;
  detail?: string;
};

function getRepoRoot(): string {
  // `windows/start_web.ps1`가 `web/`에서 next를 띄우는 것이 기본이므로, cwd 기준 상위가 repo root다.
  const cwd = process.cwd();
  return path.resolve(cwd, "..");
}

function readIrisUrlFromFile(repoRoot: string): string | null {
  try {
    const p = path.join(repoRoot, "config", "windows", "iris_url.txt");
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, "utf8");
    const s = String(raw || "").trim();
    return s || null;
  } catch {
    return null;
  }
}

function parseIntMaybe(raw: string): number | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.floor(n);
}

function parseSyncOutput(stdout: string): Pick<SyncResult, "roomName" | "counts" | "sheets"> {
  const out: Pick<SyncResult, "roomName" | "counts" | "sheets"> = {};
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (line.startsWith("[room]")) {
      // [room] id=..., name=...
      const m = line.match(/name=(.+)$/);
      if (m && m[1]) out.roomName = String(m[1]).trim();
    }
    if (line.startsWith("[count]")) {
      // [count] activeMembersCount=2939 / loadedMembersCount=2965 / fetched=2965
      const m = line.match(/activeMembersCount=([^/]+)\/\s*loadedMembersCount=([^/]+)\/\s*fetched=(.+)$/);
      if (m) {
        const activeRaw = String(m[1] || "").trim();
        const loadedRaw = String(m[2] || "").trim();
        const fetchedRaw = String(m[3] || "").trim();
        const active = activeRaw.toLowerCase() === "n/a" ? null : parseIntMaybe(activeRaw);
        const loaded = parseIntMaybe(loadedRaw);
        const fetched = parseIntMaybe(fetchedRaw);
        out.counts = { activeMembersCount: active, loadedMembersCount: loaded, fetched };
      }
    }
    if (line.startsWith("[done]")) {
      // [done] spreadsheet=... sheet=members updates=7 appends=9 existing=2956 dupExistingKeys=0
      const sheet = line.match(/\bsheet=([^\s]+)\b/);
      const updates = line.match(/\bupdates=(\d+)\b/);
      const appends = line.match(/\bappends=(\d+)\b/);
      const existing = line.match(/\bexisting=(\d+)\b/);
      out.sheets = {
        sheetName: sheet?.[1] ? String(sheet[1]) : null,
        updates: updates?.[1] ? parseIntMaybe(updates[1]) : null,
        appends: appends?.[1] ? parseIntMaybe(appends[1]) : null,
        existing: existing?.[1] ? parseIntMaybe(existing[1]) : null,
      };
    }
  }

  return out;
}

async function runPython(
  exe: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return await new Promise((resolve) => {
    const child = spawn(exe, args, {
      cwd: opts.cwd,
      env: opts.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let done = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch { }
    }, Math.max(1000, opts.timeoutMs));

    child.stdout.on("data", (d) => {
      try {
        stdout += d.toString("utf8");
      } catch { }
    });
    child.stderr.on("data", (d) => {
      try {
        stderr += d.toString("utf8");
      } catch { }
    });

    child.on("close", (code) => {
      if (done) return;
      done = true;
      try { clearTimeout(timer); } catch { }
      resolve({ code, stdout, stderr, timedOut });
    });
    child.on("error", (err) => {
      if (done) return;
      done = true;
      try { clearTimeout(timer); } catch { }
      resolve({ code: 1, stdout, stderr: stderr + String(err), timedOut });
    });
  });
}

export async function POST(request: Request, ctx: { params: { roomId: string } }) {
  const roomId = String(ctx?.params?.roomId || "").trim();
  if (!roomId) {
    return NextResponse.json({ ok: false, roomId: "", error: "missing_roomId" } satisfies SyncResult, { status: 400 });
  }

  let allowIncomplete = false;
  try {
    const body: any = await request.json().catch(() => null);
    if (body && typeof body === "object" && typeof body.allowIncomplete === "boolean") {
      allowIncomplete = body.allowIncomplete;
    }
  } catch { }

  const repoRoot = getRepoRoot();
  const scriptPath = path.join(repoRoot, "scripts", "sync_openchat_members_to_sheets.py");
  if (!fs.existsSync(scriptPath)) {
    return NextResponse.json(
      { ok: false, roomId, error: "script_missing", detail: `missing: ${scriptPath}` } satisfies SyncResult,
      { status: 500 },
    );
  }

  const irisUrl =
    String(process.env.IRIS_URL || process.env.IRIS_QUERY_BASE || process.env.IRIS_BRIDGE_URL || "").trim() ||
    readIrisUrlFromFile(repoRoot) ||
    "http://127.0.0.1:5050";

  const args = [scriptPath, "--room-id", roomId];
  if (allowIncomplete) args.push("--allow-incomplete");

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    IRIS_URL: irisUrl,
  };

  const { code, stdout, stderr, timedOut } = await runPython("python", args, {
    cwd: repoRoot,
    env,
    timeoutMs: 300_000,
  });

  if (timedOut) {
    return NextResponse.json(
      {
        ok: false,
        roomId,
        error: "timeout",
        detail: "Sheets 업서트 실행이 시간 초과로 중단되었습니다.",
        stdout,
        stderr,
      } satisfies SyncResult,
      { status: 504 },
    );
  }

  if (!code) {
    const parsed = parseSyncOutput(stdout);
    return NextResponse.json(
      {
        ok: true,
        roomId,
        ...parsed,
        stdout,
        stderr,
      } satisfies SyncResult,
      { status: 200 },
    );
  }

  const errText = `${stdout}\n${stderr}`.trim();
  const isIncomplete =
    errText.includes("loadedMembersCount < activeMembersCount") ||
    errText.includes("멤버 DB가 불완전") ||
    errText.includes("open_chat_member가 비어");

  const hintCommand = isIncomplete
    ? `pwsh scripts/openchat_load_members.ps1 -RoomId ${roomId} -Scrolls 600`
    : null;

  return NextResponse.json(
    {
      ok: false,
      roomId,
      error: isIncomplete ? "incomplete_member_db" : "sync_failed",
      detail: stderr ? String(stderr).trim() : "sync failed",
      hintCommand,
      stdout,
      stderr,
    } satisfies SyncResult,
    { status: isIncomplete ? 409 : 500 },
  );
}
