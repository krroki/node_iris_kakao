import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

function findFirstRoomDir(root: string): { roomId: string, logFile: string } | null {
  const logsDir = path.resolve(root, 'node-iris-app', 'data', 'logs');
  if (!fs.existsSync(logsDir)) return null;
  const rooms = fs.readdirSync(logsDir).filter(d => fs.statSync(path.join(logsDir, d)).isDirectory());
  for (const rid of rooms) {
    const p = path.join(logsDir, rid);
    const files = fs.readdirSync(p).filter(f => f.endsWith('.log')).sort();
    if (files.length === 0) continue;
    const last = files[files.length - 1];
    return { roomId: rid, logFile: path.join(p, last) };
  }
  return null;
}

function appendLine(logFile: string, roomId: string, roomName: string, sender: string, text: string) {
  const ts = new Date().toISOString();
  const obj = {
    timestamp: ts,
    snapshot: {
      roomId,
      roomName,
      senderId: sender,
      senderName: sender,
      messageText: text,
      messageId: `e2e-${Date.now()}`
    },
    payload: {}
  };
  fs.appendFileSync(logFile, JSON.stringify(obj) + '\n', { encoding: 'utf-8' });
}

test.describe('Realtime logs (SSE with fallback)', () => {
  test.skip(process.env.LEGACY_STREAMLIT_E2E !== '1', 'legacy Streamlit(:8512) E2E는 기본 비활성. 필요 시 LEGACY_STREAMLIT_E2E=1 로 실행');

  const base = process.env.LEGACY_STREAMLIT_BASE_URL || 'http://localhost:8512';
  const repoRoot = path.resolve(__dirname, '..', '..');

  test('status badge shows SSE or polling', async ({ page }) => {
    await page.goto(base, { waitUntil: 'load' });
    const badge = page.locator('#irisRealtimeStatus');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/SSE 연결|폴링 연결|연결 시도 중/i, { timeout: 10000 });
  });

  test('appends new lines and updates DOM within 10s', async ({ page }) => {
    const info = findFirstRoomDir(repoRoot);
    test.skip(!info, 'No room logs found to test');
    if (!info) return;
    const { roomId, logFile } = info;

    // Seed to ensure we know the roomName (fallback to roomId)
    const roomName = roomId;
    const marker = `E2E_TEST_${Date.now()}`;

    await page.goto(base, { waitUntil: 'load' });
    const box = page.locator(`#log-box-${roomId}`);
    const allBox = page.locator('#log-box-all');

    // Append two lines 1s apart
    appendLine(logFile, roomId, roomName, '테스터', `${marker}_1`);
    await page.waitForTimeout(1100);
    appendLine(logFile, roomId, roomName, '테스터', `${marker}_2`);

    // Wait up to 10s for either the room box or the all box to show the marker
    const start = Date.now();
    let ok = false;
    while (Date.now() - start < 10000) {
      const t1 = (await box.textContent().catch(() => '')) || '';
      const t2 = (await allBox.textContent().catch(() => '')) || '';
      if (t1.includes(marker) || t2.includes(marker)) { ok = true; break; }
      await page.waitForTimeout(500);
    }
    expect(ok).toBeTruthy();
  });
});
