import { test, expect, request } from '@playwright/test';

test('UI /api/health proxies backend', async () => {
  const ctx = await request.newContext({ baseURL: process.env.BASE_URL || 'http://localhost:3100' });
  const res = await ctx.get('/api/health', { timeout: 8000 });
  expect(res.ok()).toBeTruthy();
  const j = await res.json();
  expect(j?.ok).toBeTruthy();
});

test('UI stream endpoint reachable via backend', async () => {
  const api =
    process.env.NEXT_PUBLIC_REALTIME_BASE ||
    process.env.REALTIME_API_BASE ||
    'http://localhost:8650';
  const ctx = await request.newContext();
  const res = await ctx.get(`${api}/logs?limit=1`, { timeout: 8000 });
  expect(res.ok()).toBeTruthy();
});
