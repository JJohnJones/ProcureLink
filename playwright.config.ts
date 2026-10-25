import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1440, height: 1080 },
    headless: true,
    launchOptions: { args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] },
    screenshot: 'only-on-failure',
  },
  webServer: { command: 'npm run dev -- --port 5173', url: 'http://localhost:5173', reuseExistingServer: true },
});
