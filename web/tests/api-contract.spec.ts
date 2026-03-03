/**
 * KB Service API 계약 테스트 (Playwright)
 *
 * SSOT: docs/api-contract.md
 * 이 테스트는 KB Service API 응답 형식이 계약과 일치하는지 검증합니다.
 *
 * 실행: npx playwright test web/tests/api-contract.spec.ts
 * 참고: KB Service가 http://127.0.0.1:8610에서 실행 중이어야 합니다.
 */

import { test, expect } from '@playwright/test';

const KB_BASE_URL = process.env.KB_URL || 'http://127.0.0.1:8610';

test.describe('KB Service API Contract', () => {
  test.describe('GET /health', () => {
    test('should return ok: true', async ({ request }) => {
      const response = await request.get(`${KB_BASE_URL}/health`);
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.ok).toBe(true);
    });
  });

  test.describe('POST /ask', () => {
    test('should return ok field in response', async ({ request }) => {
      const response = await request.post(`${KB_BASE_URL}/ask`, {
        data: { query: '테스트', top_k: 1 },
      });
      const data = await response.json();
      expect(data).toHaveProperty('ok');
    });
  });

  test.describe('GET /menus', () => {
    test('should return ok, menus, groups, names fields', async ({ request }) => {
      const response = await request.get(`${KB_BASE_URL}/menus`);
      const data = await response.json();
      expect(data).toHaveProperty('ok');
      if (data.ok) {
        expect(data).toHaveProperty('menus');
        expect(data).toHaveProperty('groups');
        expect(data).toHaveProperty('names');
        expect(data).toHaveProperty('cafe_id');
        expect(Array.isArray(data.menus)).toBe(true);
        expect(typeof data.groups).toBe('object');
        expect(typeof data.names).toBe('object');
      }
    });
  });

  test.describe('GET /schedule', () => {
    test('should return ok and schedule fields', async ({ request }) => {
      const response = await request.get(`${KB_BASE_URL}/schedule`);
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data).toHaveProperty('schedule');
    });
  });

  test.describe('POST /reindex', () => {
    test('should return ok and status: queued', async ({ request }) => {
      const response = await request.post(`${KB_BASE_URL}/reindex`, {
        data: { mode: 'incremental' },
      });
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.status).toBe('queued');
    });
  });

  test.describe('GET /backfill/status', () => {
    test('should return ok, running, last_completed fields', async ({ request }) => {
      const response = await request.get(`${KB_BASE_URL}/backfill/status`);
      const data = await response.json();
      expect(data).toHaveProperty('ok');
      if (data.ok) {
        expect(data).toHaveProperty('running');
        expect(data).toHaveProperty('last_completed');
      }
    });
  });

  test.describe('GET /jobs/running', () => {
    test('should return ok, jobs (array), count (number)', async ({ request }) => {
      const response = await request.get(`${KB_BASE_URL}/jobs/running`);
      const data = await response.json();
      expect(data).toHaveProperty('ok');
      if (data.ok) {
        expect(data).toHaveProperty('jobs');
        expect(data).toHaveProperty('count');
        expect(Array.isArray(data.jobs)).toBe(true);
        expect(typeof data.count).toBe('number');
      }
    });
  });

  test.describe('GET /stats', () => {
    test('should return ok field', async ({ request }) => {
      const response = await request.get(`${KB_BASE_URL}/stats`);
      const data = await response.json();
      expect(data).toHaveProperty('ok');
    });
  });

  test.describe('GET /posts/by_menu', () => {
    test('should return ok and menus (object) fields', async ({ request }) => {
      const response = await request.get(`${KB_BASE_URL}/posts/by_menu`);
      const data = await response.json();
      expect(data).toHaveProperty('ok');
      if (data.ok) {
        expect(data).toHaveProperty('menus');
        expect(typeof data.menus).toBe('object');
      }
    });
  });

  test.describe('POST /run with invalid task', () => {
    test('should return 400 for invalid task', async ({ request }) => {
      const response = await request.post(`${KB_BASE_URL}/run`, {
        data: { task: 'invalid_task' },
      });
      expect(response.status()).toBe(400);
    });
  });

  test.describe('GET /creds', () => {
    test('should return ok field', async ({ request }) => {
      const response = await request.get(`${KB_BASE_URL}/creds`);
      const data = await response.json();
      expect(data).toHaveProperty('ok');
    });
  });

  // Type validation tests
  test.describe('Response Type Validation', () => {
    test('JobLogEntry should have required fields', async ({ request }) => {
      const response = await request.get(`${KB_BASE_URL}/stats`);
      const data = await response.json();
      if (data.ok && data.jobs && data.jobs.length > 0) {
        const job = data.jobs[0];
        expect(job).toHaveProperty('job_id');
        expect(job).toHaveProperty('job_type');
        expect(job).toHaveProperty('status');
        expect(job).toHaveProperty('started_at');
        // 'done' is a legacy value for 'success'
        expect(['running', 'success', 'failed', 'done']).toContain(job.status);
      }
    });

    test('MenuItem should have required fields', async ({ request }) => {
      const response = await request.get(`${KB_BASE_URL}/menus`);
      const data = await response.json();
      if (data.ok && data.menus && data.menus.length > 0) {
        const menu = data.menus[0];
        expect(menu).toHaveProperty('menu_id');
        expect(menu).toHaveProperty('name');
        expect(menu).toHaveProperty('profile');
        expect(typeof menu.menu_id).toBe('number');
        expect(typeof menu.name).toBe('string');
      }
    });

    test('MenusResponse groups should have label and menuIds', async ({ request }) => {
      const response = await request.get(`${KB_BASE_URL}/menus`);
      const data = await response.json();
      if (data.ok && data.groups) {
        for (const [profile, group] of Object.entries(data.groups)) {
          expect(group).toHaveProperty('label');
          expect(group).toHaveProperty('menuIds');
          expect(Array.isArray((group as any).menuIds)).toBe(true);
        }
      }
    });
  });
});
