import fs from 'fs';
import path from 'path';
import { APP_ROOT } from './paths';

type StatusData = {
  pid?: number;
  startedAt?: string;
  lastEventTs?: string;
  lastEventRoomId?: string;
  lastEventText?: string;
  heartbeatTs?: string;
  irisUrl?: string;
};

// NOTE:
// - dist/ 아래에서 실행되더라도 항상 repo root(node-iris-app/)의 data/status.json을 쓰기 위해
//   __dirname이 아닌 process.cwd() 기준으로 잡는다.
// - windows/start_bot.ps1도 이 경로를 기준으로 readiness를 판단한다.
const STATUS_PATH = path.join(APP_ROOT, 'data', 'status.json');
const STATUS_BAK_PATH = path.join(APP_ROOT, 'data', 'status.json.bak');

let writeChain: Promise<void> = Promise.resolve();
let lastWriteErrorAt = 0;

const mkdirp = async (p: string) => {
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
};

function logWriteErrorThrottled(err: unknown) {
  const now = Date.now();
  if (lastWriteErrorAt && now - lastWriteErrorAt < 60_000) return;
  lastWriteErrorAt = now;
  console.error('[status] updateStatus failed:', err);
}

async function readJsonSafe(p: string): Promise<StatusData> {
  try {
    const raw = await fs.promises.readFile(p, 'utf8');
    const obj = JSON.parse(raw || '{}');
    return obj && typeof obj === 'object' ? (obj as StatusData) : {};
  } catch {
    return {};
  }
}

async function writeJsonAtomic(p: string, data: unknown): Promise<void> {
  const dir = path.dirname(p);
  await fs.promises.mkdir(dir, { recursive: true });

  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  const payload = JSON.stringify(data, null, 2);
  await fs.promises.writeFile(tmp, payload, 'utf8');

  // Windows: rename은 기존 파일이 있으면 덮어쓰기 불가 → 백업 후 교체한다.
  // (중간에 프로세스가 종료돼도 .bak가 남아 복구 가능)
  try {
    try {
      await fs.promises.unlink(STATUS_BAK_PATH);
    } catch (e: any) {
      if (e && String(e.code || '') !== 'ENOENT') throw e;
    }
    try {
      await fs.promises.rename(p, STATUS_BAK_PATH);
    } catch (e: any) {
      if (e && String(e.code || '') !== 'ENOENT') throw e;
    }
    await fs.promises.rename(tmp, p);
  } finally {
    try {
      await fs.promises.unlink(tmp);
    } catch (e: any) {
      if (e && String(e.code || '') !== 'ENOENT') {
        console.error('[status] cleanup tmp failed:', e);
      }
    }
  }
}

/**
 * status.json 병합 업데이트
 * - 기존 필드를 유지하고, 새 값이 있으면 덮어쓴다.
 * - pid/irisUrl은 기본값으로 채워서 모니터링에 활용.
 */
export async function updateStatus(partial: StatusData): Promise<void> {
  // 다중 이벤트가 동시에 들어오면 writeFile 경쟁으로 0-byte 파일이 남을 수 있으므로 직렬화한다.
  writeChain = writeChain
    .then(async () => {
      await mkdirp(STATUS_PATH);

      // status.json이 비었거나 깨졌을 때를 대비해 .bak를 복구 소스로 사용한다.
      let cur: StatusData = await readJsonSafe(STATUS_PATH);
      if (!cur || Object.keys(cur).length === 0) {
        const bak = await readJsonSafe(STATUS_BAK_PATH);
        if (bak && Object.keys(bak).length > 0) cur = bak;
      }

      const next: StatusData = {
        ...cur,
        ...partial,
        irisUrl: process.env.IRIS_URL || partial.irisUrl || cur.irisUrl,
        pid: process.pid,
      };

      await writeJsonAtomic(STATUS_PATH, next);
    })
    .catch((e) => {
      logWriteErrorThrottled(e);
    });

  await writeChain;
}

/**
 * 60초 주기의 하트비트 작성기. 반환하는 clear 함수로 정리 가능.
 */
export function startHeartbeat(intervalMs = 60_000): () => void {
  const tick = () => {
    void updateStatus({ heartbeatTs: new Date().toISOString() });
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}
