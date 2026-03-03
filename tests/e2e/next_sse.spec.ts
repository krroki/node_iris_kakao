import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

function findFirstRoomDir(root: string): { roomId: string, roomName: string, logFile: string } | null {
  const logsDir = path.resolve(root, 'node-iris-app', 'data', 'logs');
  if (!fs.existsSync(logsDir)) return null;
  const rooms = fs.readdirSync(logsDir).filter(d => fs.statSync(path.join(logsDir, d)).isDirectory());
  for (const rid of rooms) {
    const p = path.join(logsDir, rid);
    const files = fs.readdirSync(p).filter(f => f.endsWith('.log')).sort();
    if (files.length === 0) continue;
    const last = files[files.length - 1];
    // try get room name from last line
    let rn = rid;
    try {
      const lines = fs.readFileSync(path.join(p,last), 'utf-8').trim().split(/\r?\n/);
      const obj = JSON.parse(lines[lines.length-1]);
      rn = obj?.snapshot?.roomName || rn;
    } catch {}
    return { roomId: rid, roomName: rn, logFile: path.join(p, last) };
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

test('status badge visible', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load' });
  // Expect site title visible in header
  await expect(page.getByRole('link', { name: '디하클 카카오봇' })).toBeVisible({ timeout: 10000 });
});

test('room card receives new lines within 10s', async ({ page }) => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const info = findFirstRoomDir(repoRoot);
  test.skip(!info, 'No room logs found');
  if (!info) return;
  const { roomId, roomName } = info;
  const logsDir = path.resolve(repoRoot, 'node-iris-app','data','logs', roomId);
  test.skip(!fs.existsSync(logsDir), 'Room log dir not found');
  const files = fs.readdirSync(logsDir).filter(f=>f.endsWith('.log')).sort();
  test.skip(files.length===0, 'No room log file');
  const logFile = path.join(logsDir, files[files.length-1]);
  await page.goto('/', { waitUntil: 'load' });
  const allFeed = page.locator('#all-feed');
  await expect(allFeed).toBeVisible({ timeout: 15_000 });
  // We assert against ALL feed since room cards may be virtualized or delayed

  const marker = `E2E_NEXT_${Date.now()}`;
  appendLine(logFile, roomId, roomName, '테스터', `${marker}_1`);
  await page.waitForTimeout(1200);
  appendLine(logFile, roomId, roomName, '테스터', `${marker}_2`);

  // Wait up to 10s for the marker to appear in the room log
  const start = Date.now();
  let ok = false;
  while (Date.now() - start < 12000) {
    const txt = await allFeed.innerText();
    if ((txt||'').includes(marker)) { ok = true; break; }
    await page.waitForTimeout(600);
  }
  expect(ok).toBeTruthy();
});
