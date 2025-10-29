import { Logger } from "@tsuki-chat/node-iris";
import App from "./app";

const logger = new Logger("Main");

async function main() {
  const app = new App();
  process.on("SIGINT", async () => {
    logger.info("Received SIGINT, shutting down...");
    await app.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    logger.info("Received SIGTERM, shutting down...");
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
