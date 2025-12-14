import { Logger } from "@tsuki-chat/node-iris";
import { promises as fs } from "fs";
import path from "path";
import App from "./app";
import { startHeartbeat, updateStatus } from "./utils/status";

const logger = new Logger("Main");

async function main() {
  const app = new App();
  // 상태 파일 초기화 및 하트비트 시작
  const now = new Date().toISOString();

  // 이전 실행의 bot_health.json(EMFILE 플래그)이 남아 있으면 새 실행에서 혼동을 유발하므로 정리한다.
  try {
    const hp = path.join(process.cwd(), "data", "bot_health.json");
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
    await app.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    logger.info("Received SIGTERM, shutting down...");
    stopHeartbeat();
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
