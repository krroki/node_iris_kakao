import { config } from "dotenv";
import fs from "fs";
import path from "path";

const ENV_PATH = path.join(process.cwd(), ".env");

const REQUIRED_KEYS = ["IRIS_URL", "IRIS_HOST"];
const OPTIONAL_KEYS = [
  "KAKAOLINK_APP_KEY",
  "KAKAOLINK_ORIGIN",
  "MESSAGE_LOG_DIR",
  "BROADCAST_DB",
];

function main() {
  if (!fs.existsSync(ENV_PATH)) {
    console.error("❌ .env 파일을 찾을 수 없습니다. node-iris-app 디렉터리에서 생성해주세요.");
    process.exit(1);
  }

  config({ path: ENV_PATH });

  console.log("✅ .env 로드 완료");

  let hasError = false;
  console.log("\n필수 항목:");
  for (const key of REQUIRED_KEYS) {
    const value = process.env[key];
    if (!value || value.trim().length === 0) {
      console.log(`  - ❌ ${key}: 미설정`);
      hasError = true;
    } else {
      console.log(`  - ✅ ${key}: ${value}`);
    }
  }

  console.log("\n선택 항목:");
  for (const key of OPTIONAL_KEYS) {
    const value = process.env[key];
    if (!value || value.trim().length === 0) {
      console.log(`  - ⚠️ ${key}: 비어 있음 (필요 시 설정)`);
    } else {
      console.log(`  - ✅ ${key}: ${value}`);
    }
  }

  console.log(`\n현재 MOCK_IRIS=${process.env.MOCK_IRIS ?? "미설정"} (실연결 시 false 권장)`);

  if (hasError) {
    console.error("\n❌ 필수 환경 변수를 먼저 채워주세요.");
    process.exit(1);
  }

  console.log("\n다음 단계: IRIS 대시보드에서 해당 IP/포트가 올바른지 확인하고, npm run start로 연결을 검증하세요.");
}

main();
