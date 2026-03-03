import path from "path";

// NOTE:
// - __dirname is stable both in src/ (ts-node) and dist/ (compiled js).
// - `IRIS_APP_BASE`를 지정하면(테스트/미러링) 경로 기준점을 강제로 바꿀 수 있다.
// - 이 값은 node-iris-app 디렉터리를 가리켜야 한다.
const OVERRIDE = String(process.env.IRIS_APP_BASE || "").trim();
export const APP_ROOT = OVERRIDE ? path.resolve(OVERRIDE) : path.resolve(__dirname, "..", "..");
export const REPO_ROOT = path.resolve(APP_ROOT, "..");
