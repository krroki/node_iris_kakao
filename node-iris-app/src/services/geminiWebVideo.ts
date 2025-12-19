import { promises as fs } from "fs";
import path from "path";

import { APP_ROOT } from "../utils/paths";

type GenerateOpts = {
  prompt: string;
  inputImageBase64?: string | null;
  sessionId?: string | null;
};

const DEFAULT_LOCK_PATH = path.join(APP_ROOT, "data", "locks", "gemini_web_video.lock");

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
      try {
        onTimeout?.();
      } catch {}
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
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("playwright");
  } catch (e) {
    throw new Error(`playwright_not_installed: ${String(e)}`);
  }
}

function resolveLockPath(sessionIdRaw?: string | null): string {
  const sid = safeString(sessionIdRaw);
  if (!sid || sid === "1") return DEFAULT_LOCK_PATH;
  return path.join(APP_ROOT, "data", "locks", `gemini_web_video_${sid}.lock`);
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

      let oldPid: number | null = null;
      try {
        const raw = await fs.readFile(lockPath, "utf8");
        const n = Number.parseInt(String(raw || "").trim(), 10);
        oldPid = Number.isFinite(n) && n > 0 ? n : null;
      } catch {
        oldPid = null;
      }

      if (oldPid && isPidAlive(oldPid)) {
        if (oldPid === process.pid) {
          try {
            await fs.unlink(lockPath);
          } catch {}
          await new Promise((r) => setTimeout(r, 60));
          continue;
        }
        throw new Error("gemini_web_video_lock_busy");
      }

      try {
        await fs.unlink(lockPath);
      } catch {}
      await new Promise((r) => setTimeout(r, 50));

      if (attempt === 2) throw new Error("gemini_web_video_lock_busy");
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
  const p = safeString(process.env.GEMINI_WEB_VIDEO_USER_DATA_DIR);
  if (!sid || sid === "1") {
    if (p) return path.resolve(p);
    return path.join(APP_ROOT, "data", "gemini_web_video_profile");
  }
  if (p) return `${path.resolve(p)}_${sid}`;
  return path.join(APP_ROOT, "data", `gemini_web_video_profile_${sid}`);
}

function computeCtxKey(sessionIdRaw: string | null | undefined, headless: boolean, channelRaw: string | null): string {
  const sid = safeString(sessionIdRaw) || "1";
  const ch = safeString(channelRaw);
  return `${sid}|${headless ? "1" : "0"}|${ch || "-"}`;
}

async function closeCtxBestEffort(ctx: any): Promise<void> {
  try {
    await ctx?.close?.();
  } catch {}
}

async function getOrCreatePersistentCtx(opts: {
  sessionId?: string | null;
  userDataDir: string;
  headless: boolean;
  channel: string | null;
}): Promise<PersistentCtx> {
  const reuse = envBool("GEMINI_WEB_VIDEO_REUSE_CONTEXT", true);
  const key = computeCtxKey(opts.sessionId ?? null, opts.headless, opts.channel);
  const now = Date.now();

  if (reuse) {
    const existing = CTX_POOL.get(key);
    if (existing) {
      try {
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
    acceptDownloads: true,
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
  const u = safeString(process.env.GEMINI_WEB_VIDEO_URL) || safeString(process.env.GEMINI_WEB_URL);
  return u || "https://gemini.google.com/app";
}

function resolveSendKey(): string {
  const k = safeString(process.env.GEMINI_WEB_VIDEO_SEND_KEY) || safeString(process.env.GEMINI_WEB_SEND_KEY);
  return k || "Enter";
}

function resolvePromptSelector(): string[] {
  const raw = safeString(process.env.GEMINI_WEB_VIDEO_PROMPT_SELECTORS) || safeString(process.env.GEMINI_WEB_PROMPT_SELECTORS);
  const fromEnv = raw ? raw.split(",").map((x) => x.trim()).filter(Boolean) : [];
  return fromEnv.length > 0
    ? fromEnv
    : ["div[role='textbox'][contenteditable='true']", "div[role='textbox']", "[contenteditable='true']", "textarea"];
}

function resolveFileInputSelector(): string[] {
  const raw = safeString(process.env.GEMINI_WEB_VIDEO_FILE_INPUT_SELECTORS) || safeString(process.env.GEMINI_WEB_FILE_INPUT_SELECTORS);
  const fromEnv = raw ? raw.split(",").map((x) => x.trim()).filter(Boolean) : [];
  return fromEnv.length > 0 ? fromEnv : ["input[type='file']", "input[accept*='image']"];
}

function resolveDebugDir(prefix: string): string | null {
  const enabled = envBool("GEMINI_WEB_VIDEO_DEBUG", envBool("GEMINI_WEB_DEBUG", false));
  if (!enabled) return null;
  const tmpDir = path.join(APP_ROOT, "data", "tmp");
  const name = `${prefix}_${process.pid}_${Date.now()}`;
  return path.join(tmpDir, name);
}

async function saveDebugSnapshot(page: any, dir: string | null, label: string): Promise<void> {
  if (!dir) return;
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {}
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
      try {
        process.stdin.off("data", onData as any);
      } catch {}
      resolve();
    };
    process.stdin.on("data", onData as any);
    try {
      process.stdin.resume();
    } catch {}
  });
}

function looksLikeLoginRequired(url: string): boolean {
  const u = String(url || "").toLowerCase();
  return u.includes("accounts.google.com") || u.includes("/signin") || u.includes("service=gemini");
}

function guessImageExtFromBase64(b64: string): string {
  const s = safeString(b64).replace(/^data:[^,]+,/, "");
  if (!s) return "png";
  if (s.startsWith("/9j/")) return "jpg";
  if (s.startsWith("iVBORw0KGgo")) return "png";
  if (s.startsWith("R0lGOD")) return "gif";
  if (s.startsWith("UklGR")) return "webp";
  return "png";
}

async function fileFromBase64(base64: string): Promise<string> {
  const s0 = safeString(base64);
  if (!s0) throw new Error("empty_base64");
  const s = s0.replace(/^data:[^,]+,/, "");
  if (!s) throw new Error("empty_base64");

  const ext = guessImageExtFromBase64(s);
  const tmpDir = path.join(APP_ROOT, "data", "tmp");
  await fs.mkdir(tmpDir, { recursive: true });
  const fp = path.join(tmpDir, `gemini_video_input_${process.pid}_${Date.now()}.${ext}`);
  await fs.writeFile(fp, Buffer.from(s, "base64"));
  return fp;
}

async function bestEffortAttachFile(page: any, selectors: string[], filePath: string): Promise<void> {
  const trySetInputFiles = async (timeoutMs: number): Promise<boolean> => {
    for (const sel of selectors) {
      try {
        const loc = page.locator(sel).first();
        await loc.waitFor({ state: "attached", timeout: timeoutMs });
        await loc.setInputFiles(filePath, { timeout: timeoutMs });
        return true;
      } catch {
        // try next
      }
    }
    return false;
  };

  // 1) Prefer direct input[type=file] if available (works even if hidden).
  if (await trySetInputFiles(10_000)) return;

  // 2) Gemini UI often uses a "파일 추가"(+) icon button that opens an upload menu.
  const chooserTimeout = (() => {
    const perTool = envInt("GEMINI_WEB_VIDEO_FILECHOOSER_TIMEOUT_MS", 0, 0, 60_000);
    if (perTool > 0) return perTool;
    return envInt("GEMINI_WEB_FILECHOOSER_TIMEOUT_MS", 15_000, 1_000, 60_000);
  })();

  const tryWithFileChooserClick = async (clicker: () => Promise<void>): Promise<boolean> => {
    try {
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: chooserTimeout }),
        clicker(),
      ]);
      if (!chooser) return false;
      await chooser.setFiles(filePath);
      await page.waitForTimeout(400).catch(() => {});
      return true;
    } catch {
      return false;
    }
  };

  const buttonCandidates: any[] = [];
  try { buttonCandidates.push(page.locator("button.upload-card-button").first()); } catch {}
  try { buttonCandidates.push(page.locator("button[mat-icon-button].upload-card-button").first()); } catch {}
  try { buttonCandidates.push(page.getByRole("button", { name: /파일\s*(추가|첨부)|add\s*file|upload/i }).first()); } catch {}
  try { buttonCandidates.push(page.getByRole("button", { name: /파일|file/i }).first()); } catch {}

  for (const btn of buttonCandidates) {
    if (await tryWithFileChooserClick(async () => {
      await btn.waitFor({ state: "visible", timeout: chooserTimeout });
      try { await btn.scrollIntoViewIfNeeded({ timeout: 1500 }); } catch {}
      await btn.click({ timeout: chooserTimeout });
    })) {
      return;
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

async function bestEffortLocateAndFill(page: any, selectors: string[], text: string): Promise<any> {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).last();
      await loc.waitFor({ state: "attached", timeout: 12_000 });
      try {
        await loc.scrollIntoViewIfNeeded({ timeout: 1500 });
      } catch {}
      try {
        await loc.click({ timeout: 1500 });
      } catch {}
      try {
        await loc.fill(text, { timeout: 8000 });
      } catch {
        await loc.evaluate((el: any, value: string) => {
          try {
            el.focus();
            if ("value" in el) el.value = value;
            else el.textContent = value;
          } catch {}
        }, text);
        try {
          await loc.type(text, { delay: 0 });
        } catch {}
      }
      return loc;
    } catch {
      // try next selector
    }
  }
  throw new Error("prompt_input_not_found");
}

async function bestEffortSelectVideoTool(page: any): Promise<void> {
  const nameRe =
    /동영상\s*만들기|동영상\s*생성|video\s*creation|create\s*video|make\s*video|veo/i;

  const tryClick = async (loc: any, timeoutMs: number): Promise<boolean> => {
    try {
      await loc.waitFor({ state: "visible", timeout: timeoutMs });
      await loc.click({ timeout: timeoutMs });
      return true;
    } catch {
      return false;
    }
  };

  // Prefer starting a fresh chat.
  try {
    await page.keyboard.press("Control+Shift+O").catch(() => {});
    await page.waitForTimeout(350).catch(() => {});
  } catch {}

  const clickVideoTool = async (): Promise<boolean> => {
    const candidates: any[] = [];
    try {
      candidates.push(page.getByRole("button", { name: nameRe }).first());
    } catch {}
    try {
      candidates.push(page.getByRole("link", { name: nameRe }).first());
    } catch {}
    for (const loc of candidates) {
      if (await tryClick(loc, 8000)) return true;
    }
    return false;
  };

  // 1) Home quick action
  if (await clickVideoTool()) {
    await page.waitForTimeout(400).catch(() => {});
    return;
  }

  // 2) Tools menu near prompt
  const toolsCandidates: any[] = [];
  try {
    toolsCandidates.push(page.getByRole("button", { name: /^도구$/i }).first());
  } catch {}
  try {
    toolsCandidates.push(page.getByRole("button", { name: /^tools$/i }).first());
  } catch {}

  for (const tools of toolsCandidates) {
    if (!(await tryClick(tools, 8000))) continue;
    await page.waitForTimeout(300).catch(() => {});

    const menuCandidates: any[] = [];
    try {
      menuCandidates.push(page.getByRole("menuitem", { name: nameRe }).first());
    } catch {}
    try {
      menuCandidates.push(page.getByRole("button", { name: nameRe }).first());
    } catch {}
    try {
      menuCandidates.push(page.getByRole("link", { name: nameRe }).first());
    } catch {}

    for (const loc of menuCandidates) {
      if (await tryClick(loc, 8000)) {
        await page.waitForTimeout(400).catch(() => {});
        return;
      }
    }

    try {
      await page.keyboard.press("Escape").catch(() => {});
    } catch {}
    await page.waitForTimeout(150).catch(() => {});
  }
}

function isLikelyVideoUrl(url: string): boolean {
  const u = safeString(url);
  if (!u) return false;
  if (u.startsWith("blob:")) return false;
  if (!/^https?:\/\//i.test(u)) return false;
  const lower = u.toLowerCase();
  if (lower.includes(".mp4")) return true;
  if (lower.includes("mime=video")) return true;
  if (lower.includes("video")) return true;
  return false;
}

async function collectCandidateVideoUrls(page: any, timeoutMs: number): Promise<string[]> {
  try {
    return await withTimeout(
      page.evaluate(() => {
        const doc: any = (globalThis as any).document;
        const root: any = doc?.querySelector?.("chat-window") || doc?.querySelector?.("main.chat-app") || doc;

        const out: string[] = [];

        const vids = Array.from(root?.querySelectorAll?.("video") || []);
        for (const v of vids) {
          const anyV: any = v as any;
          const src = anyV?.currentSrc || anyV?.src || "";
          if (src) out.push(String(src));
          const sources = Array.from((v as any)?.querySelectorAll?.("source") || []);
          for (const s of sources) {
            const anyS: any = s as any;
            const ss = anyS?.src || "";
            if (ss) out.push(String(ss));
          }
        }

        // Some UIs expose downloadable links via <a>.
        const links = Array.from(root?.querySelectorAll?.("a[href]") || []);
        for (const a of links) {
          const anyA: any = a as any;
          const href = anyA?.href || "";
          if (!href) continue;
          if (!/^https?:\/\//i.test(href)) continue;
          if (href.toLowerCase().includes(".mp4") || href.toLowerCase().includes("mime=video")) out.push(String(href));
        }

        const seen = new Set<string>();
        return out.filter((s) => (seen.has(s) ? false : (seen.add(s), true)));
      }),
      timeoutMs,
      "gemini_web_video_eval_timeout",
      () => {
        try {
          void page?.close?.().catch(() => {});
        } catch {}
      },
    );
  } catch (e) {
    const msg = String((e as any)?.message || e || "");
    if (msg.includes("gemini_web_video_eval_timeout")) throw e;
    return [];
  }
}

function pickBestUrl(urls: string[]): string | null {
  const uniq: string[] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    const s = safeString(u);
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    uniq.push(s);
  }
  const likely = uniq.filter(isLikelyVideoUrl);
  if (likely.length > 0) return likely[likely.length - 1] || null;
  return uniq.length > 0 ? uniq[uniq.length - 1] || null : null;
}

export async function initGeminiWebVideoSessionInteractive(sessionId?: string | null): Promise<void> {
  const lockPath = resolveLockPath(sessionId);
  const release = await acquireLock(lockPath);
  try {
    const pw = loadPlaywright();
    const chromium = pw.chromium;

    const userDataDir = resolveUserDataDir(sessionId);
    await fs.mkdir(userDataDir, { recursive: true });

    const url = resolveGeminiUrl();
    const channel = safeString(process.env.GEMINI_WEB_VIDEO_CHANNEL) || safeString(process.env.GEMINI_WEB_CHANNEL);
    const holdMs = envInt("GEMINI_WEB_VIDEO_INIT_HOLD_MS", 20 * 60_000, 30_000, 6 * 60 * 60_000);

    const ctx = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      channel: channel || undefined,
      viewport: { width: 1280, height: 900 },
      acceptDownloads: true,
    });

    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });

    const curUrl = safeString(page.url());
    if (looksLikeLoginRequired(curUrl)) {
      console.log("[gemini-web-video] 브라우저에서 Google 로그인을 완료해 주세요.");
    } else {
      console.log("[gemini-web-video] 이미 로그인된 것으로 보입니다. 필요하면 권한을 확인해 주세요.");
    }

    if (process.stdin && process.stdin.isTTY) {
      console.log("[gemini-web-video] 로그인 확인이 끝나면 Enter를 눌러주세요.");
      await waitForEnter("> ");
    } else {
      console.log("[gemini-web-video] (stdin 비-대화형) 브라우저 창을 닫거나, 시간이 지나면 자동 종료합니다.");
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

export async function generateGeminiWebVideo(opts: GenerateOpts): Promise<string[]> {
  const prompt = safeString(opts?.prompt);
  if (!prompt) throw new Error("prompt_required");

  const lockPath = resolveLockPath(opts?.sessionId);
  const release = await acquireLock(lockPath);
  try {
    const userDataDir = resolveUserDataDir(opts?.sessionId);
    await fs.mkdir(userDataDir, { recursive: true });

    const headless = envBool("GEMINI_WEB_VIDEO_HEADLESS", envBool("GEMINI_WEB_HEADLESS", true));
    const channel = safeString(process.env.GEMINI_WEB_VIDEO_CHANNEL) || safeString(process.env.GEMINI_WEB_CHANNEL);
    const navTimeout = envInt("GEMINI_WEB_VIDEO_NAV_TIMEOUT_MS", 60_000, 5_000, 300_000);
    const jobTimeout = envInt("GEMINI_WEB_VIDEO_JOB_TIMEOUT_MS", 8 * 60_000, 20_000, 30 * 60_000);
    const overallTimeout = envInt(
      "GEMINI_WEB_VIDEO_OVERALL_TIMEOUT_MS",
      Math.min(navTimeout + jobTimeout + 120_000, 30 * 60_000),
      30_000,
      60 * 60_000,
    );
    const evalTimeout = envInt("GEMINI_WEB_VIDEO_EVAL_TIMEOUT_MS", 10_000, 1_000, 60_000);
    const maxResults = envInt("GEMINI_WEB_VIDEO_MAX_RESULTS", 1, 1, 3);

    const reuse = envBool("GEMINI_WEB_VIDEO_REUSE_CONTEXT", true);
    const persistent = await getOrCreatePersistentCtx({
      sessionId: opts?.sessionId ?? null,
      userDataDir,
      headless,
      channel: channel || null,
    });
    const ctx = persistent.ctx;

    let inputTmp: string | null = null;
    const sid = safeString(opts?.sessionId);
    const debugPrefix = sid ? `gemini_web_video_s${sid}` : "gemini_web_video";
    const debugDir = resolveDebugDir(debugPrefix);

    let page: any | null = null;
    let overallTimedOut = false;
    let overallTimer: NodeJS.Timeout | null = null;
    const captured: string[] = [];
    let responseHandler: ((res: any) => void) | null = null;
    try {
      page = await ctx.newPage();
      try {
        page.setDefaultNavigationTimeout?.(navTimeout);
      } catch {}

      overallTimer = setTimeout(() => {
        overallTimedOut = true;
        try {
          void page?.close?.().catch(() => {});
        } catch {}
      }, overallTimeout);

      responseHandler = (res: any) => {
        try {
          const headers = res?.headers?.() || {};
          const ct = String(headers["content-type"] || headers["Content-Type"] || "");
          if (!ct) return;
          if (!ct.toLowerCase().startsWith("video/") && !ct.toLowerCase().includes("video")) return;
          const u = safeString(res?.url?.() || "");
          if (!u) return;
          if (!/^https?:\/\//i.test(u)) return;
          captured.push(u);
        } catch {}
      };
      try {
        page.on("response", responseHandler);
      } catch {}

      const url = resolveGeminiUrl();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: navTimeout });
      await saveDebugSnapshot(page, debugDir, "01_after_goto");

      const curUrl = safeString(page.url());
      if (looksLikeLoginRequired(curUrl)) throw new Error("gemini_web_video_login_required");

      try {
        await page.keyboard.press("Escape").catch(() => {});
      } catch {}

      await bestEffortSelectVideoTool(page);
      await saveDebugSnapshot(page, debugDir, "02_after_select_tool");

      let before = new Set<string>(await collectCandidateVideoUrls(page, evalTimeout));

      if (opts.inputImageBase64) {
        inputTmp = await fileFromBase64(opts.inputImageBase64);
        const selectors = resolveFileInputSelector();
        await bestEffortAttachFile(page, selectors, inputTmp);
        await saveDebugSnapshot(page, debugDir, "02b_after_attach");

        const attachWaitMs = envInt("GEMINI_WEB_VIDEO_ATTACH_PREVIEW_WAIT_MS", 2500, 0, 60_000);
        if (attachWaitMs > 0) await page.waitForTimeout(attachWaitMs).catch(() => {});

        // Reset "before" after attach to reduce false positives when the UI adds extra elements.
        before = new Set<string>(await collectCandidateVideoUrls(page, evalTimeout));
      }

      const promptSelectors = resolvePromptSelector();
      const input = await bestEffortLocateAndFill(page, promptSelectors, prompt);

      const sendKey = resolveSendKey();
      try {
        await input.press(sendKey, { timeout: 5000 });
      } catch {
        await input.press("Enter", { timeout: 5000 }).catch(() => {});
      }
      await saveDebugSnapshot(page, debugDir, "03_after_send");

      const deadline = Date.now() + jobTimeout;
      const out: string[] = [];
      let lastCandidates: string[] = [];
      while (Date.now() < deadline && out.length < maxResults) {
        const bestCaptured = pickBestUrl(captured);
        if (bestCaptured && isLikelyVideoUrl(bestCaptured)) {
          out.push(bestCaptured);
          break;
        }

        const now = await collectCandidateVideoUrls(page, evalTimeout);
        const candidates = now.filter((s) => !before.has(s));
        lastCandidates = candidates;

        const pick = candidates.map((u) => safeString(u)).filter(Boolean);
        const best = pickBestUrl(pick);
        if (best && isLikelyVideoUrl(best)) {
          out.push(best);
          break;
        }

        await sleep(1500);
      }

      if (out.length === 0) {
        if (lastCandidates.length === 0 && captured.length === 0) {
          await saveDebugSnapshot(page, debugDir, "90_no_video_found");
          throw new Error("gemini_web_video_no_video_found");
        }
        await saveDebugSnapshot(page, debugDir, "91_video_url_not_found");
        throw new Error("gemini_web_video_url_not_found");
      }

      await saveDebugSnapshot(page, debugDir, "99_success");
      return out;
    } catch (e) {
      if (overallTimedOut) e = new Error("gemini_web_video_overall_timeout");
      try {
        if (page) await saveDebugSnapshot(page, debugDir, "98_error");
      } catch {}

      if (reuse) {
        const msg = String((e as any)?.message || e || "");
        const shouldDrop =
          msg.includes("Target closed") ||
          msg.includes("Browser closed") ||
          msg.includes("has been closed") ||
          msg.includes("Navigation failed") ||
          msg.includes("gemini_web_video_overall_timeout") ||
          msg.includes("gemini_web_video_eval_timeout");
        if (shouldDrop) {
          try {
            CTX_POOL.delete(persistent.key);
          } catch {}
          await closeCtxBestEffort(ctx);
        }
      }
      throw e;
    } finally {
      try {
        if (responseHandler && page) page.off?.("response", responseHandler);
      } catch {}
      try {
        if (page) await page.close();
      } catch {}
      if (overallTimer) clearTimeout(overallTimer);
      if (!reuse) await closeCtxBestEffort(ctx);
      if (inputTmp) {
        try { await fs.unlink(inputTmp); } catch {}
      }
    }
  } finally {
    await release();
  }
}
