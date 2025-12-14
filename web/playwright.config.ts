import { defineConfig } from '@playwright/test';

export default defineConfig({
  timeout: 20000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3100',
  },
});
