import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://127.0.0.1:5179', viewport: { width: 800, height: 600 } },
  webServer: { command: 'npx vite --host 127.0.0.1', url: 'http://127.0.0.1:5179', reuseExistingServer: true, timeout: 60000 },
})
