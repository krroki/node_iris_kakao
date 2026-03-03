import { defineConfig } from '@playwright/test';

const DEFAULT_WEB_PORT = 3110;
const BASE_URL = process.env.PW_BASE_URL || process.env.BASE_URL || `http://127.0.0.1:${DEFAULT_WEB_PORT}`;
let webPort = DEFAULT_WEB_PORT;
try {
  const u = new URL(BASE_URL);
  if (u.port) webPort = Number(u.port);
} catch {}
if (process.env.PW_WEB_PORT) {
  webPort = Number(process.env.PW_WEB_PORT);
}

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [ ['list'] ],
  use: { baseURL: BASE_URL },
  webServer: {
    command: `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "cd web; if (Test-Path .next) { Remove-Item -Recurse -Force .next }; if (-not $env:NEXT_PUBLIC_KB_URL) { $env:NEXT_PUBLIC_KB_URL = 'http://127.0.0.1:8610' }; npm run dev -- -p ${webPort} --hostname 127.0.0.1"`,
    url: BASE_URL,
    timeout: 120_000,
    reuseExistingServer: false,
  },
  // Use system Edge to avoid downloading browsers
  projects: [
    {
      name: 'edge',
      use: { browserName: 'chromium', channel: 'msedge' },
    },
  ],
});
