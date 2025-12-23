import { promises as fs } from "fs";
import path from "path";
import { APP_ROOT } from "../utils/paths";

type GenerateOpts = {
  prompt: string;
  inputImageBase64?: string | null;
  sessionId?: string | null;
};

const DEFAULT_LOCK_PATH = path.join(APP_ROOT, "data", "locks", "gemini_web.lock");

type PersistentCtx = {
  key: string;
  userDataDir: string;
  headless: boolean;
  channel: string | null;
  ctx: any;
  createdAt: number;
  lastUsedAt: number;
};

const CTX_POOL = new Map<string, PersistentCtx>();

function sleep(ms: number): Promise<void> {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, n));
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errCode: string,
  onTimeout?: () => void,
): Promise<T> {
  const ms = Number(timeoutMs);
  if (!Number.isFinite(ms) || ms <= 0) return promise;

  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      try { onTimeout?.(); } catch {}
      reject(new Error(errCode));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function safeString(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return String(v ?? "").trim();
}

function isPidAlive(pidRaw: unknown): boolean {
  const pid = Number(pidRaw);
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function loadPlaywright(): any {
  try {
    // NOTE: node-iris-app는 monorepo 루트의 playwright를 parent node_modules에서 해석할 수 있다.
    // (node-iris-app에 의존성으로 고정하지 않고도 운영 환경에서 동작하도록 require를 사용한다)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("playwright");
  } catch (e) {
    throw new Error(`playwright_not_installed: ${String(e)}`);
  }
}

function resolveLockPath(sessionIdRaw?: string | null): string {
  const sid = safeString(sessionIdRaw);
  // Backward compatible default session (single-profile 운영) 유지
  if (!sid || sid === "1") return DEFAULT_LOCK_PATH;
  return path.join(APP_ROOT, "data", "locks", `gemini_web_${sid}.lock`);
}

async function acquireLock(lockPath: string): Promise<() => Promise<void>> {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await fs.writeFile(lockPath, String(process.pid), { encoding: "utf8", flag: "wx" });
      break;
    } catch (e: any) {
      const code = String(e?.code || "");
      if (code !== "EEXIST") throw e;

      // Stale lock recovery: if the owner PID is not alive, delete and retry.
      let oldPid: number | null = null;
      try {
        const raw = await fs.readFile(lockPath, "utf8");
        const n = Number.parseInt(String(raw || "").trim(), 10);
        oldPid = Number.isFinite(n) && n > 0 ? n : null;
      } catch {
        oldPid = null;
      }

      if (oldPid && isPidAlive(oldPid)) {
        // Self-stale recovery: the lock file may remain on Windows if unlink fails transiently.
        // Since image-worker is single-instance and slot-gated, a lock owned by the same PID is safe to reclaim.
        if (oldPid === process.pid) {
          try { await fs.unlink(lockPath); } catch {}
          await new Promise((r) => setTimeout(r, 60));
          continue;
        }
        throw new Error("gemini_web_lock_busy");
      }

      try { await fs.unlink(lockPath); } catch {}
      await new Promise((r) => setTimeout(r, 50));

      if (attempt === 2) throw new Error("gemini_web_lock_busy");
    }
  }
  return async () => {
    for (let i = 0; i < 6; i += 1) {
      try {
        await fs.unlink(lockPath);
        return;
      } catch (e: any) {
        const code = String(e?.code || "");
        if (code === "ENOENT") return;
        await new Promise((r) => setTimeout(r, 60));
      }
    }
  };
}

function envBool(name: string, defaultValue: boolean): boolean {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return defaultValue;
  if (["1", "true", "yes", "y", "on"].includes(raw)) return true;
  if (["0", "false", "no", "n", "off"].includes(raw)) return false;
  return defaultValue;
}

function envInt(name: string, defaultValue: number, min: number, max: number): number {
  const raw = safeString(process.env[name]);
  if (!raw) return defaultValue;
  const n = Number(raw);
  if (!Number.isFinite(n)) return defaultValue;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function resolveUserDataDir(sessionIdRaw?: string | null): string {
  const sid = safeString(sessionIdRaw);
  const p = safeString(process.env.GEMINI_WEB_USER_DATA_DIR);
  // Backward compatible: 기존 단일 프로필(.env/기본값) 그대로 사용
  if (!sid || sid === "1") {
    if (p) return path.resolve(p);
    return path.join(APP_ROOT, "data", "gemini_web_profile");
  }
  // 멀티 세션: 기본 경로 기준으로 suffix를 붙여 분리한다.
  if (p) return `${path.resolve(p)}_${sid}`;
  return path.join(APP_ROOT, "data", `gemini_web_profile_${sid}`);
}

function computeCtxKey(sessionIdRaw: string | null | undefined, headless: boolean, channelRaw: string | null): string {
  const sid = safeString(sessionIdRaw) || "1";
  const ch = safeString(channelRaw);
  return `${sid}|${headless ? "1" : "0"}|${ch || "-"}`;
}

async function closeCtxBestEffort(ctx: any): Promise<void> {
  try { await ctx?.close?.(); } catch {}
}

async function getOrCreatePersistentCtx(opts: {
  sessionId?: string | null;
  userDataDir: string;
  headless: boolean;
  channel: string | null;
}): Promise<PersistentCtx> {
  const reuse = envBool("GEMINI_WEB_REUSE_CONTEXT", true);
  const key = computeCtxKey(opts.sessionId ?? null, opts.headless, opts.channel);
  const now = Date.now();

  if (reuse) {
    const existing = CTX_POOL.get(key);
    if (existing) {
      try {
        // best-effort health check
        if (existing.ctx?.isClosed?.()) throw new Error("ctx_closed");
        const browser = existing.ctx?.browser?.();
        if (browser?.isConnected?.() === false) throw new Error("browser_disconnected");
        await existing.ctx.pages?.();
        existing.lastUsedAt = now;
        return existing;
      } catch {
        CTX_POOL.delete(key);
        await closeCtxBestEffort(existing.ctx);
      }
    }
  } else {
    const existing = CTX_POOL.get(key);
    if (existing) {
      CTX_POOL.delete(key);
      await closeCtxBestEffort(existing.ctx);
    }
  }

  const pw = loadPlaywright();
  const chromium = pw.chromium;

  const ctx = await chromium.launchPersistentContext(opts.userDataDir, {
    headless: opts.headless,
    channel: opts.channel || undefined,
    viewport: { width: 1280, height: 900 },
  });

  const created: PersistentCtx = {
    key,
    userDataDir: opts.userDataDir,
    headless: opts.headless,
    channel: opts.channel,
    ctx,
    createdAt: now,
    lastUsedAt: now,
  };
  if (reuse) CTX_POOL.set(key, created);
  return created;
}

function resolveGeminiUrl(): string {
  const u = safeString(process.env.GEMINI_WEB_URL);
  return u || "https://gemini.google.com/app";
}

function resolveSendKey(): string {
  const k = safeString(process.env.GEMINI_WEB_SEND_KEY);
  // Gemini 입력창이 줄바꿈을 허용하는 경우 Enter가 "전송"이 아닐 수 있으므로 필요 시 운영자가 변경한다.
  return k || "Enter";
}

function resolvePromptSelector(): string[] {
  const raw = safeString(process.env.GEMINI_WEB_PROMPT_SELECTORS);
  const fromEnv = raw
    ? raw.split(",").map((x) => x.trim()).filter(Boolean)
    : [];
  return fromEnv.length > 0
    ? fromEnv
    : [
        // best-effort defaults (UI 변경에 취약하므로 env로 오버라이드 권장)
        "div[role='textbox'][contenteditable='true']",
        "div[role='textbox']",
        "[contenteditable='true']",
        "textarea",
      ];
}

function resolveFileInputSelector(): string[] {
  const raw = safeString(process.env.GEMINI_WEB_FILE_INPUT_SELECTORS);
  const fromEnv = raw
    ? raw.split(",").map((x) => x.trim()).filter(Boolean)
    : [];
  return fromEnv.length > 0 ? fromEnv : ["input[type='file']", "input[accept*='image']"];
}

function resolveDebugDir(prefix: string): string | null {
  const enabled = envBool("GEMINI_WEB_DEBUG", false);
  if (!enabled) return null;
  const tmpDir = path.join(APP_ROOT, "data", "tmp");
  const name = `${prefix}_${process.pid}_${Date.now()}`;
  return path.join(tmpDir, name);
}

async function saveDebugSnapshot(page: any, dir: string | null, label: string): Promise<void> {
  if (!dir) return;
  try { await fs.mkdir(dir, { recursive: true }); } catch {}
  const safeLabel = String(label || "snap").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "snap";
  const base = path.join(dir, safeLabel);
  try {
    const html = await page.content().catch(() => "");
    if (html) await fs.writeFile(`${base}.html`, html, "utf8");
  } catch {}
  try {
    const url = safeString(page.url?.() || "");
    if (url) await fs.writeFile(`${base}.url.txt`, url, "utf8");
  } catch {}
  try {
    await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {});
  } catch {}
}

async function waitForEnter(prompt: string): Promise<void> {
  if (!process.stdin || !process.stdin.isTTY) throw new Error("stdin_not_tty");
  process.stdout.write(prompt);
  await new Promise<void>((resolve) => {
    const onData = () => {
      try { process.stdin.off("data", onData as any); } catch {}
      resolve();
    };
    process.stdin.on("data", onData as any);
    try { process.stdin.resume(); } catch {}
  });
}

function looksLikeLoginRequired(url: string): boolean {
  const u = String(url || "").toLowerCase();
  return u.includes("accounts.google.com") || u.includes("/signin") || u.includes("service=gemini");
}

async function fileFromBase64(base64: string): Promise<string> {
  const s = safeString(base64);
  if (!s) throw new Error("empty_base64");
  const tmpDir = path.join(APP_ROOT, "data", "tmp");
  await fs.mkdir(tmpDir, { recursive: true });
  const fp = path.join(tmpDir, `gemini_input_${process.pid}_${Date.now()}.png`);
  await fs.writeFile(fp, Buffer.from(s, "base64"));
  return fp;
}

async function bestEffortLocateAndFill(page: any, selectors: string[], text: string): Promise<any> {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).last();
      await loc.waitFor({ state: "attached", timeout: 12_000 });
      try { await loc.scrollIntoViewIfNeeded({ timeout: 1500 }); } catch {}
      // Some contenteditables require click before fill
      try { await loc.click({ timeout: 1500 }); } catch {}
      try { await loc.fill(text, { timeout: 8000 }); } catch {
        // contenteditable fallback
        await loc.evaluate((el: any, value: string) => {
          try {
            el.focus();
            if ("value" in el) el.value = value;
            else el.textContent = value;
          } catch {}
        }, text);
        // ensure text typed (some editors ignore programmatic set)
        try { await loc.type(text, { delay: 0 }); } catch {}
      }
      return loc;
    } catch {
      // try next selector
    }
  }
  throw new Error("prompt_input_not_found");
}

async function bestEffortAttachFile(page: any, selectors: string[], filePath: string): Promise<void> {
  const trySetInputFiles = async (timeoutMs: number): Promise<boolean> => {
    const targets: any[] = [];
    try {
      const frames = page.frames?.();
      if (Array.isArray(frames) && frames.length > 0) targets.push(...frames);
    } catch {}
    if (targets.length === 0) targets.push(page);

    for (const target of targets) {
      for (const sel of selectors) {
        try {
          const list = target.locator(sel);
          const count = Math.min(await list.count(), 6);
          for (let i = 0; i < count; i++) {
            const loc = list.nth(i);
            await loc.waitFor({ state: "attached", timeout: timeoutMs });
            await loc.setInputFiles(filePath, { timeout: timeoutMs });
            return true;
          }
        } catch {
          // try next selector/target
        }
      }
    }
    return false;
  };

  // 1) Prefer direct input[type=file] if available (works even if hidden).
  if (await trySetInputFiles(10_000)) return;

  // 2) Gemini UI often uses a "파일 추가" (+) icon button that opens an upload menu.
  const chooserTimeout = envInt("GEMINI_WEB_FILECHOOSER_TIMEOUT_MS", 15_000, 1_000, 60_000);

  const tryWithFileChooserClick = async (clicker: () => Promise<void>): Promise<boolean> => {
    try {
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: chooserTimeout }),
        clicker(),
      ]);
      if (!chooser) return false;
      await chooser.setFiles(filePath);

      // Best-effort: allow UI to attach/preview the image before we send a prompt.
      await page.waitForTimeout(400).catch(() => {});
      return true;
    } catch {
      return false;
    }
  };

  const buttonCandidates: any[] = [];
  // Most stable class observed in Gemini UI HTML snapshots.
  try { buttonCandidates.push(page.locator("button.upload-card-button").first()); } catch {}
  try { buttonCandidates.push(page.locator("button[mat-icon-button].upload-card-button").first()); } catch {}
  // Accessible name (KR/EN) fallbacks.
  try { buttonCandidates.push(page.getByRole("button", { name: /파일\s*(추가|첨부)|add\s*file|upload/i }).first()); } catch {}
  try { buttonCandidates.push(page.getByRole("button", { name: /파일/i }).first()); } catch {}

  for (const btn of buttonCandidates) {
    // If the (+) directly triggers a file chooser, this will work.
    try {
      if (await tryWithFileChooserClick(async () => {
        await btn.waitFor({ state: "visible", timeout: chooserTimeout });
        try { await btn.scrollIntoViewIfNeeded({ timeout: 1500 }); } catch {}
        await btn.click({ timeout: chooserTimeout });
      })) {
        return;
      }
    } catch {
      // continue
    }
  }

  // 3) If (+) opens a menu, click "파일 업로드" inside the overlay.
  const plus = page.locator("button.upload-card-button").first();
  try {
    await plus.click({ timeout: chooserTimeout }).catch(() => {});
    await page.waitForTimeout(250).catch(() => {});
  } catch {}

  const overlay = page.locator("[data-test-id='upload-file-card-container']").first();
  try { await overlay.waitFor({ state: "visible", timeout: Math.min(chooserTimeout, 8000) }); } catch {}

  const uploadMenuCandidates: any[] = [];
  try { uploadMenuCandidates.push(page.locator("button[data-test-id='local-images-files-uploader-button']").first()); } catch {}
  try { uploadMenuCandidates.push(page.getByRole("button", { name: /파일\s*업로드|upload/i }).first()); } catch {}
  try { uploadMenuCandidates.push(overlay.locator("button.mat-mdc-list-item:has-text(\"파일 업로드\")").first()); } catch {}

  for (const btn of uploadMenuCandidates) {
    if (await tryWithFileChooserClick(async () => {
      await btn.waitFor({ state: "visible", timeout: chooserTimeout });
      try { await btn.scrollIntoViewIfNeeded({ timeout: 1500 }); } catch {}
      await btn.click({ timeout: chooserTimeout });
    })) {
      return;
    }
  }

  // 4) Some menus hide the actual trigger behind an aria-hidden element. Try it as a last resort.
  try {
    const hiddenTrigger = overlay.locator("button.hidden-local-file-image-selector-button").first();
    if (await tryWithFileChooserClick(async () => {
      await hiddenTrigger.waitFor({ state: "attached", timeout: chooserTimeout });
      await hiddenTrigger.click({ force: true, timeout: chooserTimeout });
    })) {
      return;
    }
  } catch {}

  // 5) Some UIs insert the file input after opening the upload menu; retry once.
  if (await trySetInputFiles(5_000)) return;

  throw new Error("file_input_not_found");
}

async function bestEffortEnsureFastModeForImages(page: any): Promise<void> {
  const forceFast = envBool("GEMINI_WEB_FORCE_FAST_MODE", true);
  if (!forceFast) return;

  const fastRe = /빠른\s*모드|fast\s*mode|flash/i;

  const tryClick = async (loc: any, timeoutMs: number): Promise<boolean> => {
    try {
      await loc.waitFor({ state: "visible", timeout: timeoutMs });
      await loc.click({ timeout: timeoutMs });
      return true;
    } catch {
      return false;
    }
  };

  const openCandidates: any[] = [];
  try { openCandidates.push(page.locator("button:has-text(\"Pro\")").first()); } catch {}
  try { openCandidates.push(page.locator("button:has-text(\"빠른 모드\")").first()); } catch {}
  try { openCandidates.push(page.locator("button:has-text(\"사고 모드\")").first()); } catch {}
  try { openCandidates.push(page.getByRole("button", { name: /Pro|빠른\s*모드|사고\s*모드|fast\s*mode|flash/i }).first()); } catch {}

  const optionCandidates: any[] = [];
  try { optionCandidates.push(page.getByText(fastRe).first()); } catch {}
  try { optionCandidates.push(page.getByRole("menuitem", { name: fastRe }).first()); } catch {}
  try { optionCandidates.push(page.getByRole("option", { name: fastRe }).first()); } catch {}
  try { optionCandidates.push(page.getByRole("button", { name: fastRe }).first()); } catch {}

  for (const opener of openCandidates) {
    if (!(await tryClick(opener, 2500))) continue;
    await page.waitForTimeout(200).catch(() => {});

    for (const opt of optionCandidates) {
      if (await tryClick(opt, 2500)) {
        await page.waitForTimeout(350).catch(() => {});
        return;
      }
    }

    try { await page.keyboard.press("Escape").catch(() => {}); } catch {}
    await page.waitForTimeout(150).catch(() => {});
  }
}

async function bestEffortSelectImageTool(page: any): Promise<void> {
  const nameRe = /이미지\s*(만들기|생성하기|생성)|create\s*image|image\s*generation|generate\s*image/i;

  const tryClick = async (loc: any, timeoutMs: number): Promise<boolean> => {
    try {
      await loc.waitFor({ state: "visible", timeout: timeoutMs });
      await loc.click({ timeout: timeoutMs });
      return true;
    } catch {
      return false;
    }
  };

  // Gemini usually opens the last conversation. Prefer starting a fresh chat.
  try {
    await page.keyboard.press("Control+Shift+O").catch(() => {});
    await page.waitForTimeout(350).catch(() => {});
  } catch {}

  const clickImageTool = async (): Promise<boolean> => {
    const candidates: any[] = [];
    try { candidates.push(page.getByRole("button", { name: nameRe }).first()); } catch {}
    try { candidates.push(page.getByRole("link", { name: nameRe }).first()); } catch {}

    for (const loc of candidates) {
      if (await tryClick(loc, 8000)) return true;
    }
    return false;
  };

  // 1) Home quick action "이미지 만들기/생성하기"
  if (await clickImageTool()) {
    await page.waitForTimeout(400).catch(() => {});
    return;
  }

  // 2) Tools button near prompt: open then click "이미지 만들기/생성하기"
  const toolsCandidates: any[] = [];
  try { toolsCandidates.push(page.getByRole("button", { name: /^도구$/i }).first()); } catch {}
  try { toolsCandidates.push(page.getByRole("button", { name: /^tools$/i }).first()); } catch {}

  for (const tools of toolsCandidates) {
    if (!(await tryClick(tools, 8000))) continue;
    await page.waitForTimeout(300).catch(() => {});

    // Inside the tools menu/panel, "이미지 만들기/생성하기" might appear as menuitem/button.
    const menuCandidates: any[] = [];
    try { menuCandidates.push(page.getByRole("menuitem", { name: nameRe }).first()); } catch {}
    try { menuCandidates.push(page.getByRole("button", { name: nameRe }).first()); } catch {}
    try { menuCandidates.push(page.getByRole("link", { name: nameRe }).first()); } catch {}

    for (const loc of menuCandidates) {
      if (await tryClick(loc, 8000)) {
        await page.waitForTimeout(400).catch(() => {});
        return;
      }
    }
  }
}

async function collectCandidateImageSrcs(page: any, timeoutMs: number): Promise<string[]> {
  try {
    return await withTimeout(
      page.evaluate(() => {
        const doc: any = (globalThis as any).document;
        const root: any =
          doc?.querySelector?.("chat-window") ||
          doc?.querySelector?.("main.chat-app") ||
          doc;
        const imgs = Array.from(root?.querySelectorAll?.("img") || []);
        const out: string[] = [];
        for (const img of imgs) {
          const anyImg: any = img as any;
          const src = anyImg?.currentSrc || anyImg?.src || "";
          if (!src) continue;
          // Skip obvious UI assets (we only want generated/attached images)
          if (/^data:image\/svg\+xml/i.test(src)) continue;
          if (src.includes("www.gstatic.com/lamda/images/")) continue;
          if (src.endsWith(".svg")) continue;
          // Filter: ignore tiny icons/logos as best-effort
          const w = anyImg?.naturalWidth || 0;
          const h = anyImg?.naturalHeight || 0;
          if (w && h && (w < 200 || h < 200)) continue;
          out.push(src);
        }
        // keep order + dedupe
        const seen = new Set<string>();
        return out.filter((s) => (seen.has(s) ? false : (seen.add(s), true)));
      }),
      timeoutMs,
      "gemini_web_eval_timeout",
      () => {
        try { void page?.close?.().catch(() => {}); } catch {}
      },
    );
  } catch (e) {
    const msg = String((e as any)?.message || e || "");
    if (msg.includes("gemini_web_eval_timeout")) throw e;
    return [];
  }
}

async function srcToBase64(page: any, src: string, timeoutMs: number): Promise<string | null> {
  const s = safeString(src);
  if (!s) return null;
  if (s.startsWith("data:") && s.includes(",")) {
    const b64 = s.split(",", 2)[1]?.trim() || "";
    return b64 || null;
  }

  // blob: URLs can't be fetched by the request API; try in-page conversion.
  if (s.startsWith("blob:")) {
    // 1) Try fetch(blob) + FileReader
    try {
      const b64: string = await page.evaluate(
        async (url: string, timeout: number) => {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), timeout);
          try {
            const res = await fetch(url, { signal: ctrl.signal } as any);
            if (!res.ok) return "";
            const blob = await res.blob();
            return await new Promise<string>((resolve) => {
              const FileReaderCtor: any = (globalThis as any).FileReader;
              if (!FileReaderCtor) return resolve("");
              const reader = new FileReaderCtor();
              reader.onloadend = () => {
                try {
                  const r = String(reader.result || "");
                  if (!r.includes(",")) return resolve("");
                  resolve(r.split(",", 2)[1] || "");
                } catch {
                  resolve("");
                }
              };
              reader.readAsDataURL(blob);
            });
          } catch {
            return "";
          } finally {
            clearTimeout(t);
          }
        },
        s,
        Math.max(1000, Math.min(timeoutMs, 30_000)),
      );
      const out = safeString(b64);
      if (out) return out;
    } catch {
      // fall through
    }

    // 2) Canvas fallback (works for same-origin blob images)
    try {
      const b64: string = await page.evaluate(
        async (url: string, timeout: number) => {
          const doc: any = (globalThis as any).document;
          const img = Array.from(doc?.querySelectorAll?.("img") || []).find((el: any) => {
            const cur = el?.currentSrc || el?.src || "";
            return cur === url;
          }) as any;
          if (!img) return "";

          const waitLoaded = async () => {
            if (img.complete && img.naturalWidth) return;
            await new Promise<void>((resolve) => {
              let done = false;
              const finish = () => {
                if (done) return;
                done = true;
                try { img.removeEventListener?.("load", finish); } catch {}
                resolve();
              };
              try { img.addEventListener?.("load", finish, { once: true }); } catch {}
              setTimeout(finish, timeout);
            });
          };
          await waitLoaded();

          const w = img.naturalWidth || img.width || 0;
          const h = img.naturalHeight || img.height || 0;
          if (!w || !h) return "";

          try {
            const canvas = doc.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d");
            if (!ctx) return "";
            ctx.drawImage(img, 0, 0);
            const data = canvas.toDataURL("image/png");
            if (!data.includes(",")) return "";
            return data.split(",", 2)[1] || "";
          } catch {
            return "";
          }
        },
        s,
        Math.max(1000, Math.min(timeoutMs, 5000)),
      );
      const out = safeString(b64);
      return out ? out : null;
    } catch {
      return null;
    }
  }

  // Prefer Playwright request API to bypass browser CORS.
  try {
    const req = page?.request;
    if (req && typeof req.get === "function") {
      const headers: Record<string, string> = {};
      try { headers.referer = safeString(page.url?.() || ""); } catch {}
      try {
        const ua: string = await page.evaluate(() => String((globalThis as any).navigator?.userAgent || ""));
        if (ua) headers["user-agent"] = ua;
      } catch {}

      const res = await req.get(s, {
        timeout: Math.max(1000, Math.min(timeoutMs, 60_000)),
        headers,
      });
      if (res && typeof res.ok === "function" && res.ok()) {
        const rh = (typeof res.headers === "function" ? res.headers() : {}) as Record<string, string>;
        const ct = safeString(rh?.["content-type"] || rh?.["Content-Type"] || "");
        if (!ct || ct.toLowerCase().includes("image/")) {
          const body = await res.body();
          if (body && body.length > 0) {
            return Buffer.from(body).toString("base64");
          }
        }
      }
    }
  } catch {
    // fall through
  }

  try {
    // Use page context fetch so auth cookies/session apply
    const b64: string = await page.evaluate(
      async (url: string, timeout: number) => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeout);
        try {
          const res = await fetch(url, { signal: ctrl.signal, credentials: "include" as any });
          if (!res.ok) return "";
          const blob = await res.blob();
          return await new Promise<string>((resolve) => {
            const FileReaderCtor: any = (globalThis as any).FileReader;
            if (!FileReaderCtor) return resolve("");
            const reader = new FileReaderCtor();
            reader.onloadend = () => {
              try {
                const r = String(reader.result || "");
                if (!r.includes(",")) return resolve("");
                resolve(r.split(",", 2)[1] || "");
              } catch {
                resolve("");
              }
            };
            reader.readAsDataURL(blob);
          });
        } catch {
          return "";
        } finally {
          clearTimeout(t);
        }
      },
      s,
      Math.max(1000, Math.min(timeoutMs, 60_000)),
    );
    const out = safeString(b64);
    return out ? out : null;
  } catch {
    return null;
  }
}

export async function initGeminiWebSessionInteractive(sessionId?: string | null): Promise<void> {
  const lockPath = resolveLockPath(sessionId);
  const release = await acquireLock(lockPath);
  try {
    const pw = loadPlaywright();
    const chromium = pw.chromium;

    const userDataDir = resolveUserDataDir(sessionId);
    await fs.mkdir(userDataDir, { recursive: true });

    const url = resolveGeminiUrl();
    const channel = safeString(process.env.GEMINI_WEB_CHANNEL); // e.g. "chrome"
    const holdMs = envInt("GEMINI_WEB_INIT_HOLD_MS", 20 * 60_000, 30_000, 6 * 60 * 60_000);

    const ctx = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      channel: channel || undefined,
      viewport: { width: 1280, height: 900 },
    });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });

    const curUrl = safeString(page.url());
    if (looksLikeLoginRequired(curUrl)) {
      console.log("[gemini-web] 브라우저에서 Google 로그인까지 완료해 주세요.");
    } else {
      console.log("[gemini-web] 이미 로그인된 것으로 보입니다. 필요하면 계정/권한을 확인해 주세요.");
    }

    if (process.stdin && process.stdin.isTTY) {
      console.log("[gemini-web] 로그인 확인이 끝나면 Enter를 누르세요.");
      await waitForEnter("> ");
    } else {
      console.log("[gemini-web] (stdin 비대화형) 로그인 완료 후 브라우저 창을 닫으면 세션 저장 후 자동 종료됩니다.");
      await Promise.race([
        new Promise<void>((resolve) => {
          try {
            page.on("close", () => resolve());
          } catch {
            resolve();
          }
        }),
        new Promise<void>((resolve) => setTimeout(resolve, holdMs)),
      ]);
    }
    await ctx.close();
  } finally {
    await release();
  }
}

export async function generateGeminiWebImage(opts: GenerateOpts): Promise<string[]> {
  const prompt = safeString(opts?.prompt);
  if (!prompt) throw new Error("prompt_required");

  const lockPath = resolveLockPath(opts?.sessionId);
  const release = await acquireLock(lockPath);
  try {
    const userDataDir = resolveUserDataDir(opts?.sessionId);
    await fs.mkdir(userDataDir, { recursive: true });

    const headless = envBool("GEMINI_WEB_HEADLESS", true);
    const channel = safeString(process.env.GEMINI_WEB_CHANNEL); // e.g. "chrome"
    const navTimeout = envInt("GEMINI_WEB_NAV_TIMEOUT_MS", 60_000, 5_000, 300_000);
    const jobTimeout = envInt("GEMINI_WEB_JOB_TIMEOUT_MS", 150_000, 10_000, 600_000);
    const overallTimeout = envInt(
      "GEMINI_WEB_OVERALL_TIMEOUT_MS",
      Math.min(navTimeout + jobTimeout + 90_000, 15 * 60_000),
      30_000,
      60 * 60_000,
    );
    const maxImages = envInt("GEMINI_WEB_MAX_IMAGES", 1, 1, 6);
    const evalTimeout = envInt("GEMINI_WEB_EVAL_TIMEOUT_MS", 10_000, 1_000, 60_000);

    const reuse = envBool("GEMINI_WEB_REUSE_CONTEXT", true);
    const persistent = await getOrCreatePersistentCtx({
      sessionId: opts?.sessionId ?? null,
      userDataDir,
      headless,
      channel: channel || null,
    });
    const ctx = persistent.ctx;

    let inputTmp: string | null = null;
    const sid = safeString(opts?.sessionId);
    const debugPrefix = sid ? `gemini_web_s${sid}` : "gemini_web";
    const debugDir = resolveDebugDir(debugPrefix);
    let page: any | null = null;
    let overallTimedOut = false;
    let overallTimer: NodeJS.Timeout | null = null;
    try {
      page = await ctx.newPage();
      try { page.setDefaultNavigationTimeout?.(navTimeout); } catch {}

      // Hard stop for pathological hangs (e.g. page.evaluate stuck on an unresponsive page).
      overallTimer = setTimeout(() => {
        overallTimedOut = true;
        try { void page?.close?.().catch(() => {}); } catch {}
      }, overallTimeout);

      const url = resolveGeminiUrl();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: navTimeout });
      await saveDebugSnapshot(page, debugDir, "01_after_goto");

      const curUrl = safeString(page.url());
      if (looksLikeLoginRequired(curUrl)) {
        throw new Error("gemini_web_login_required");
      }

      // Best-effort: dismiss cookie banners/popups
      try {
        await page.keyboard.press("Escape").catch(() => {});
      } catch {}

      // Ensure we are in a model that supports image generation (e.g. "빠른 모드").
      await bestEffortEnsureFastModeForImages(page);
      await saveDebugSnapshot(page, debugDir, "01b_after_model");

      // Ensure image tool is selected (otherwise Gemini might return text-only).
      await bestEffortSelectImageTool(page);
      await saveDebugSnapshot(page, debugDir, "02_after_select_tool");

      if (opts.inputImageBase64) {
        inputTmp = await fileFromBase64(opts.inputImageBase64);
        const selectors = resolveFileInputSelector();
        await bestEffortAttachFile(page, selectors, inputTmp);
        await saveDebugSnapshot(page, debugDir, "03_after_attach");
      }

      // Prepare "before" snapshot of image srcs so we can detect newly generated images.
      // NOTE: After attaching a file, the preview thumbnail may load asynchronously; wait a bit so it doesn't
      // get mis-detected as a "generated image".
      let before = new Set<string>(await collectCandidateImageSrcs(page, evalTimeout));
      if (opts.inputImageBase64) {
        const attachWaitMs = envInt("GEMINI_WEB_ATTACH_PREVIEW_WAIT_MS", 2_500, 0, 60_000);
        const deadline2 = Date.now() + attachWaitMs;
        while (Date.now() < deadline2) {
          const now = await collectCandidateImageSrcs(page, evalTimeout);
          const added = now.filter((s) => !before.has(s));
          if (added.length > 0) {
            before = new Set<string>(now);
            break;
          }
          await sleep(350);
        }
      }

      const promptSelectors = resolvePromptSelector();
      const input = await bestEffortLocateAndFill(page, promptSelectors, prompt);

      const sendKey = resolveSendKey();
      try {
        await input.press(sendKey, { timeout: 5000 });
      } catch {
        // fall back: try Enter
        await input.press("Enter", { timeout: 5000 }).catch(() => {});
      }
      await saveDebugSnapshot(page, debugDir, "04_after_send");

      const deadline = Date.now() + jobTimeout;
      const out: string[] = [];
      let lastCandidates: string[] = [];
      while (Date.now() < deadline && out.length < maxImages) {
        const now = await collectCandidateImageSrcs(page, evalTimeout);
        const candidates = now.filter((s) => !before.has(s));
        lastCandidates = candidates;

        // Prefer likely image outputs first.
        const likely = candidates.filter((s) => {
          const v = String(s || "");
          return (
            v.startsWith("blob:") ||
            v.startsWith("data:image/") ||
            /lh3\.googleusercontent\.com\/gg(-dl)?\//.test(v)
          );
        });
        const pick = likely.length > 0 ? likely : candidates;

        for (const src of pick) {
          if (out.length >= maxImages) break;
          const b64 = await srcToBase64(page, src, 25_000);
          if (!b64) continue;
          out.push(b64);
        }

        if (out.length > 0) break;
        await sleep(1000);
      }

      if (out.length === 0) {
        if (lastCandidates.length === 0) {
          await saveDebugSnapshot(page, debugDir, "90_no_image_found");
          throw new Error("gemini_web_no_image_found");
        }
        await saveDebugSnapshot(page, debugDir, "91_image_download_failed");
        throw new Error("gemini_web_image_download_failed");
      }
      await saveDebugSnapshot(page, debugDir, "99_success");
      return out;
    } catch (e) {
      if (overallTimedOut) {
        e = new Error("gemini_web_overall_timeout");
      }
      try {
        if (page) await saveDebugSnapshot(page, debugDir, "98_error");
        else {
          const pages = await ctx.pages?.().catch(() => []);
          if (pages && pages[0]) await saveDebugSnapshot(pages[0], debugDir, "98_error");
        }
      } catch {}
      // If we reuse persistent contexts, close and drop it on certain "catastrophic" failures.
      if (reuse) {
        const msg = String((e as any)?.message || e || "");
        const shouldDrop =
          msg.includes("Target closed") ||
          msg.includes("Browser closed") ||
          msg.includes("has been closed") ||
          msg.includes("Navigation failed") ||
          msg.includes("file_input_not_found") ||
          msg.includes("prompt_input_not_found") ||
          msg.includes("gemini_web_overall_timeout") ||
          msg.includes("gemini_web_eval_timeout");
        if (shouldDrop) {
          try { CTX_POOL.delete(persistent.key); } catch {}
          await closeCtxBestEffort(ctx);
        }
      }
      throw e;
    } finally {
      try { if (page) await page.close(); } catch {}
      if (overallTimer) clearTimeout(overallTimer);
      if (!reuse) {
        await closeCtxBestEffort(ctx);
      }
      if (inputTmp) {
        try { await fs.unlink(inputTmp); } catch {}
      }
    }
  } finally {
    await release();
  }
}
