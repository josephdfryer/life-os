import { defineConfig, devices } from '@playwright/test'

// A dedicated throwaway Postgres database; scripts/e2e/prepare.ts drops and
// recreates every table in it. Defaults to the docker-compose `postgres`
// service; CI overrides via DATABASE_URL / E2E_DATABASE_URL.
const databaseUrl =
  process.env.E2E_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://lifeos:lifeos@localhost:5432/lifeos_e2e_home'

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
