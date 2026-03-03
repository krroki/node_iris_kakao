import { test, expect, request } from '@playwright/test';

const API =
  process.env.NEXT_PUBLIC_REALTIME_BASE ||
  process.env.REALTIME_API_BASE ||
  'http://localhost:8650';

test('backend /health is OK and recent', async ({ }) => {
  const ctx = await request.newContext();
  const res = await ctx.get(`${API}/health`, { timeout: 8000 });
  expect(res.ok()).toBeTruthy();
  const data = await res.json();
  expect(data?.ok).toBeTruthy();
  // lastEventAgeSec might be null on idle; allow up to 600s if present
  if (typeof data?.bot?.lastEventAgeSec === 'number') {
    expect(data.bot.lastEventAgeSec).toBeLessThan(600);
  }
});

test('backend /logs returns array', async () => {
  const ctx = await request.newContext();
  const res = await ctx.get(`${API}/logs?limit=5`, { timeout: 8000 });
  expect(res.ok()).toBeTruthy();
  const arr = await res.json();
  expect(Array.isArray(arr)).toBeTruthy();
});
