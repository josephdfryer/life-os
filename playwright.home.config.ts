import { defineConfig, devices } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const databaseUrl = `file:${join(tmpdir(), 'life-os-e2e-home.db')}`

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /home-control-plane\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3200',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node --import tsx scripts/e2e/prepare.ts && npm run dev -w home -- --port 3200',
    url: 'http://localhost:3200/stream',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      AUTH_SECRET: 'life-os-home-e2e-only-secret',
      DATABASE_URL: databaseUrl,
      LIFE_OS_LOCAL_REVIEW: '1',
      NEXTAUTH_SECRET: 'life-os-home-e2e-only-secret',
      TURSO_AUTH_TOKEN: '',
      TURSO_DATABASE_URL: '',
    },
  },
})
