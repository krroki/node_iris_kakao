import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

function findFirstRoom(root: string) {
  const logsDir = path.resolve(root, 'node-iris-app', 'data', 'logs');
  if (!fs.existsSync(logsDir)) return null;
  const rooms = fs.readdirSync(logsDir).filter(d => fs.statSync(path.join(logsDir, d)).isDirectory());
  for (const rid of rooms) {
    const p = path.join(logsDir, rid);
    const files = fs.readdirSync(p).filter(f => f.endsWith('.log')).sort();
    if (!files.length) continue;
    const last = path.join(p, files[files.length-1]);
    return { roomId: rid, logFile: last };
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

test('include/exclude filters affect ALL feed', async ({ page }) => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const info = findFirstRoom(repoRoot);
  test.skip(!info, 'No room logs found');
  if (!info) return;
  const { roomId, logFile } = info;
  const roomName = roomId;

  await page.goto('/', { waitUntil: 'load' });
  const allFeed = page.locator('#all-feed');
  await expect(allFeed).toBeVisible({ timeout: 15_000 });

  // Ensure ALL mode
  const sel = page.locator('select');
  await sel.selectOption('');

  // Set include filter to a nonsense keyword to hide our marker
  const includeInput = page.getByPlaceholder('검색어 입력');
  await includeInput.fill('___no_match_keyword___');

  const marker = `E2E_FILTER_${Date.now()}`;
  appendLine(logFile, roomId, roomName, '필터테스트', `${marker}_X`);

  // Wait 2s and confirm marker not present
  await page.waitForTimeout(2000);
  const content1 = await allFeed.innerText();
  expect(content1.includes(marker)).toBeFalsy();

  // Clear include, set exclude to hide marker
  await includeInput.fill('');
  const excludeInput = page.getByPlaceholder('제외할 단어');
  await excludeInput.fill(marker);

  appendLine(logFile, roomId, roomName, '필터테스트', `${marker}_Y`);
  await page.waitForTimeout(2000);
  const content2 = await allFeed.innerText();
  expect(content2.includes(`${marker}_Y`)).toBeFalsy();

  // Clear exclude, marker should show now
  await excludeInput.fill('');
  appendLine(logFile, roomId, roomName, '필터테스트', `${marker}_Z`);

  const start = Date.now();
  let ok = false;
  while (Date.now() - start < 8000) {
    const txt = await allFeed.innerText();
    if (txt.includes(`${marker}_Z`)) { ok = true; break; }
    await page.waitForTimeout(500);
  }
  expect(ok).toBeTruthy();
});
