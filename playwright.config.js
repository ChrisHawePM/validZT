import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 15000,
  use: {
    baseURL: 'http://localhost:3456',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  webServer: {
    command: 'npx serve . -l 3456 -s --no-clipboard',
    port: 3456,
    reuseExistingServer: true,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
