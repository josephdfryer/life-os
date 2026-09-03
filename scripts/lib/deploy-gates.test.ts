import assert from "node:assert/strict"
import { test } from "node:test"
import {
  alignmentMessage,
  ciVerdict,
  dirtyTreeMessage,
  headAlignment,
  missingCrons,
  parseDeployArgs,
  smokeOk,
} from "./deploy-gates"
import { findProject, selectProjects, VERCEL_PROJECTS } from "./vercel-projects"

test("dirtyTreeMessage is silent on an empty porcelain", () => {
  assert.equal(dirtyTreeMessage(""), null)
  assert.equal(dirtyTreeMessage("\n"), null)
})

test("dirtyTreeMessage names the count and refuses by default", () => {
  const message = dirtyTreeMessage(" M apps/home/app/page.tsx\n?? foo.ts")
  assert.match(message!, /2 path/)
  assert.match(message!, /--allow-dirty/)
})

test("headAlignment classifies match, behind, ahead, diverged", () => {
  assert.equal(headAlignment("aaa", "aaa", true, true), "match")
  assert.equal(headAlignment("old", "new", true, false), "behind")
  assert.equal(headAlignment("new", "old", false, true), "ahead")
  assert.equal(headAlignment("a", "b", false, false), "diverged")
})

test("alignmentMessage is silent only on match", () => {
  assert.equal(alignmentMessage("match", "aaa", "aaa"), null)
  assert.match(alignmentMessage("behind", "aaa", "bbb")!, /roll production back/)
  assert.match(alignmentMessage("ahead", "aaa", "bbb")!, /not on origin\/master/)
  assert.match(alignmentMessage("diverged", "aaa", "bbb")!, /diverged/)
})

test("ciVerdict prefers a passing CI run and fails on failure", () => {
  assert.equal(ciVerdict([]).result, "missing")
  assert.equal(ciVerdict([{ conclusion: "success", status: "completed", name: "CI" }]).result, "pass")
  assert.equal(ciVerdict([{ conclusion: "failure", status: "completed", name: "CI", url: "https://x" }]).result, "fail")
  assert.equal(ciVerdict([{ conclusion: null, status: "in_progress", name: "CI" }]).result, "pending")
})

test("smokeOk accepts 2xx and 3xx only", () => {
  assert.equal(smokeOk(200), true)
  assert.equal(smokeOk(302), true)
  assert.equal(smokeOk(307), true)
  assert.equal(smokeOk(401), false)
  assert.equal(smokeOk(404), false)
  assert.equal(smokeOk(500), false)
})

test("missingCrons detects a dropped schedule", () => {
  const expected = [{ path: "/api/cron/theory-refresh", schedule: "0 10 * * *" }]
  assert.deepEqual(missingCrons(expected, expected), [])
  assert.equal(
    missingCrons(expected, [{ path: "/api/cron/theory-refresh", schedule: "0 11 * * *" }]).length,
    1,
  )
})

test("parseDeployArgs defaults to apply and honors --only / --dry-run", () => {
  assert.equal(parseDeployArgs([]).apply, true)
  assert.equal(parseDeployArgs(["--dry-run"]).apply, false)
  assert.equal(parseDeployArgs(["--only", "persons"]).only, "persons")
  assert.equal(parseDeployArgs(["--allow-dirty"]).allowDirty, true)
  assert.equal(parseDeployArgs(["--ci", "--affected", "--before", "abc"]).ci, true)
  assert.equal(parseDeployArgs(["--ci"]).skipCi, true)
  assert.equal(parseDeployArgs(["--affected"]).affected, true)
  assert.equal(parseDeployArgs(["--before", "abc"]).before, "abc")
})

test("parseDeployArgs configures the guarded fast lane", () => {
  const options = parseDeployArgs(["--fast", "home"])
  assert.equal(options.fast, "home")
  assert.equal(options.only, "home")
  assert.equal(options.allowUnpushed, true)
  assert.equal(options.skipCi, true)
  assert.throws(() => parseDeployArgs(["--fast"]), /requires one app name/)
  assert.throws(() => parseDeployArgs(["--fast", "home", "--skip-smoke"]), /cannot be combined/)
  assert.throws(() => parseDeployArgs(["--fast", "home", "--allow-dirty"]), /cannot be combined/)
  assert.throws(() => parseDeployArgs(["--fast", "home", "--before", "abc"]), /cannot be combined/)
})

test("selectProjects resolves filter, app, and vercel names", () => {
  assert.equal(selectProjects().length, VERCEL_PROJECTS.length)
  assert.equal(findProject("persons")?.vercelName, "persons")
  assert.equal(findProject("events")?.vercelName, "life-os-events")
  assert.equal(findProject("life-os-api")?.filter, "api")
  assert.throws(() => selectProjects("db"), /Unknown project/)
})

test("every project has a production URL and smoke probe", () => {
  for (const project of VERCEL_PROJECTS) {
    assert.match(project.productionUrl, /^https:\/\//)
    assert.ok(project.smoke.length >= 1, project.filter)
    assert.ok(project.projectId.startsWith("prj_"), project.filter)
  }
})

test("persons and events declare the production crons", () => {
  assert.deepEqual(findProject("persons")?.crons, [
    { path: "/api/cron/theory-refresh", schedule: "0 10 * * *" },
  ])
  assert.deepEqual(findProject("events")?.crons, [
    { path: "/api/cron/granola-sync", schedule: "0 14 * * *" },
    { path: "/api/cron/calendar-sync", schedule: "*/15 * * * *" },
  ])
})
