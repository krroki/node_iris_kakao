import { Logger } from "@tsuki-chat/node-iris";
import App from "./app";
import { startHeartbeat, updateStatus } from "./utils/status";

const logger = new Logger("Main");

async function main() {
  const app = new App();
  // 상태 파일 초기화 및 하트비트 시작
  await updateStatus({ heartbeatTs: new Date().toISOString(), irisUrl: process.env.IRIS_URL });
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
