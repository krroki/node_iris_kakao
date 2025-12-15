import { Logger } from "@tsuki-chat/node-iris";
import { promises as fs } from "fs";
import path from "path";
import App from "./app";
import { APP_ROOT } from "./utils/paths";
import { startHeartbeat, updateStatus } from "./utils/status";

const logger = new Logger("Main");

const BOT_LOCK_PATH = path.join(__dirname, "../data/bot.lock");

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

async function acquireBotLock(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(BOT_LOCK_PATH), { recursive: true });
    await fs.writeFile(BOT_LOCK_PATH, String(process.pid), { encoding: "utf8", flag: "wx" });
    return;
  } catch (e: any) {
    const code = String(e?.code || "");
    if (code !== "EEXIST") {
      logger.warn("[lock] bot.lock 생성 실패 (중복 실행 방지 비활성화)", { lockPath: BOT_LOCK_PATH, err: String(e) });
      return;
    }

    let oldPid: number | null = null;
    try {
      const raw = await fs.readFile(BOT_LOCK_PATH, "utf8");
      const n = Number.parseInt(String(raw || "").trim(), 10);
      oldPid = Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      oldPid = null;
    }

    if (oldPid && isPidAlive(oldPid)) {
      logger.warn("[lock] 다른 bot이 이미 실행 중이므로 종료합니다.", { pid: oldPid, lockPath: BOT_LOCK_PATH });
      process.exit(0);
    }

    // stale lock: remove and retry once
    try {
      await fs.unlink(BOT_LOCK_PATH);
    } catch {}
    try {
      await fs.writeFile(BOT_LOCK_PATH, String(process.pid), { encoding: "utf8", flag: "wx" });
      logger.warn("[lock] stale lock 정리 후 재획득", { stalePid: oldPid, lockPath: BOT_LOCK_PATH });
    } catch (e2) {
      logger.warn("[lock] lock 재획득 실패로 종료합니다.", { lockPath: BOT_LOCK_PATH, err: String(e2) });
      process.exit(1);
    }
  }
}

function releaseBotLock(): void {
  void fs.unlink(BOT_LOCK_PATH).catch(() => {});
}

async function main() {
  await acquireBotLock();
  process.on("exit", releaseBotLock);

  const app = new App();
  // 상태 파일 초기화 및 하트비트 시작
  const now = new Date().toISOString();

  // 이전 실행의 bot_health.json(EMFILE 플래그)이 남아 있으면 새 실행에서 혼동을 유발하므로 정리한다.
  try {
    const hp = path.join(APP_ROOT, "data", "bot_health.json");
    try {
      await fs.unlink(hp);
      logger.warn("cleared stale bot_health.json from previous run");
    } catch (e: any) {
      if (e && String(e.code || "") === "ENOENT") {
        // no-op
      } else {
        throw e;
      }
    }
  } catch (e) {
    logger.warn("failed to cleanup bot_health.json", { err: String(e) });
  }

  await updateStatus({ startedAt: now, heartbeatTs: now, irisUrl: process.env.IRIS_URL });
  const stopHeartbeat = startHeartbeat();
  process.on("SIGINT", async () => {
    logger.info("Received SIGINT, shutting down...");
    stopHeartbeat();
    releaseBotLock();
    await app.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    logger.info("Received SIGTERM, shutting down...");
    stopHeartbeat();
    releaseBotLock();
    await app.stop();
    process.exit(0);
  });

  // 봇 시작
  await app.start();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Failed to start:`, error);
    process.exit(1);
  });
}
