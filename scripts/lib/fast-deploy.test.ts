import assert from "node:assert/strict"
import { test } from "node:test"
import { assessFastDeploy, formatFastDeployRejections } from "./fast-deploy"

test("fast deploy accepts app-local UI and test changes", () => {
  const result = assessFastDeploy([
    "apps/home/app/page.tsx",
    "apps/home/components/ScheduleWidget.tsx",
    "apps/home/tests/schedule.test.ts",
  ], "home")

  assert.equal(result.ok, true)
  assert.equal(result.deployPaths.length, 3)
  assert.deepEqual(result.rejections, [])
})

test("fast deploy ignores documentation in the same commit", () => {
  const result = assessFastDeploy([
    "apps/home/app/globals.css",
    "docs/DEPLOY_RUNBOOK.md",
    "apps/home/README.md",
  ], "home")

  assert.equal(result.ok, true)
  assert.deepEqual(result.deployPaths, ["apps/home/app/globals.css"])
  assert.equal(result.ignoredPaths.length, 2)
})

test("fast deploy rejects another app or a shared package", () => {
  const result = assessFastDeploy([
    "apps/home/app/page.tsx",
    "apps/events/app/page.tsx",
    "packages/ui/src/index.ts",
  ], "home")

  assert.equal(result.ok, false)
  assert.match(formatFastDeployRejections(result.rejections), /outside apps\/home/)
})

test("fast deploy rejects database, API, server, auth, and dependency changes", () => {
  const paths = [
    "apps/persons/prisma/schema.prisma",
    "apps/persons/app/api/people/route.ts",
    "apps/persons/server/domain/imports.ts",
    "apps/persons/lib/auth.ts",
    "apps/persons/package.json",
  ]
  const result = assessFastDeploy(paths, "persons")

  assert.equal(result.ok, false)
  assert.equal(result.rejections.length, paths.length)
})

test("fast deploy requires an app change ahead of origin/master", () => {
  const result = assessFastDeploy(["docs/DEPLOY_RUNBOOK.md"], "home")

  assert.equal(result.ok, false)
  assert.match(result.rejections[0].reason, /no deployable app change/)
})

test("fast deploy never accepts the API project", () => {
  const result = assessFastDeploy(["apps/api/app/v1/people/route.ts"], "api")

  assert.equal(result.ok, false)
  assert.match(result.rejections[0].reason, /always requires the full CI lane/)
})
