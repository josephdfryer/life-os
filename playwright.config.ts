import { defineConfig, devices } from "@playwright/test"

const databaseUrl = "file:/private/tmp/life-os-e2e.db"

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run e2e:prepare && npm run dev -w persons -- --port 3100",
    url: "http://localhost:3100/people",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      AUTH_SECRET: "life-os-e2e-only-secret",
      DATABASE_URL: databaseUrl,
      LIFE_OS_LOCAL_REVIEW: "1",
      NEXTAUTH_SECRET: "life-os-e2e-only-secret",
      TURSO_AUTH_TOKEN: "",
      TURSO_DATABASE_URL: "",
    },
  },
})
