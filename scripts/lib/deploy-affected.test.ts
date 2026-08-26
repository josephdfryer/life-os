import assert from "node:assert/strict"
import { test } from "node:test"
import { appsToDeploy, skipGitTriggeredBuild } from "./deploy-affected"

test("docs-only changes deploy nothing", () => {
  assert.deepEqual(appsToDeploy(["docs/DEPLOY_RUNBOOK.md", "AGENTS.md"]), { kind: "none" })
})

test("companion-only changes deploy nothing", () => {
  assert.deepEqual(appsToDeploy(["apps/companion/README.md"]), { kind: "none" })
})

test("a single app change deploys that app", () => {
  assert.deepEqual(appsToDeploy(["apps/persons/app/page.tsx"]), { kind: "some", apps: ["persons"] })
})

test("two app changes deploy both", () => {
  assert.deepEqual(
    appsToDeploy(["apps/events/app/page.tsx", "apps/home/app/page.tsx"]),
    { kind: "some", apps: ["events", "home"] },
  )
})

test("a shared package change deploys every app", () => {
  assert.equal(appsToDeploy(["packages/ui/src/index.ts"]).kind, "all")
  assert.equal(appsToDeploy(["packages/db/prisma/schema.prisma"]).kind, "all")
  assert.equal(appsToDeploy(["package-lock.json"]).kind, "all")
  assert.equal(appsToDeploy(["turbo.json"]).kind, "all")
})

test("deploy tooling changes deploys every app", () => {
  assert.equal(appsToDeploy(["scripts/deploy.ts"]).kind, "all")
  assert.equal(appsToDeploy([".github/workflows/ci.yml"]).kind, "all")
})

test("git production builds are skipped so Actions owns prod", () => {
  const skip = skipGitTriggeredBuild({
    vercelEnv: "production",
    gitRef: "master",
    changedPaths: ["apps/places/app/page.tsx"],
    projectApp: "places",
  })
  assert.equal(skip.skip, true)
})

test("git preview builds when that app changed", () => {
  const skip = skipGitTriggeredBuild({
    vercelEnv: "preview",
    gitRef: "feat/map",
    changedPaths: ["apps/places/app/page.tsx"],
    projectApp: "places",
  })
  assert.equal(skip.skip, false)
})

test("git preview skips when a different app changed", () => {
  const skip = skipGitTriggeredBuild({
    vercelEnv: "preview",
    gitRef: "feat/people",
    changedPaths: ["apps/persons/app/page.tsx"],
    projectApp: "places",
  })
  assert.equal(skip.skip, true)
})
