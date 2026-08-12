#!/usr/bin/env tsx
/**
 * Find Person rows damaged by the pre-2026-08-12 vCard parser.
 *
 * Two bugs in `apps/persons/lib/vcard.ts` corrupted imported values:
 *
 *  1. Parameter leak. A content line was split at the first ";" or ":", so
 *     `EMAIL;TYPE=WORK:joseph@example.com` parsed as `TYPE=WORK:joseph@example.com`.
 *     Every *typed* property was affected — email, name, org, title, address,
 *     birthday, note, url. TEL was parsed by a separate, correct path, so phone
 *     numbers should come back clean; they are scanned anyway to confirm that.
 *
 *  2. Quoted-printable decoding ran on any value containing "=", regardless of
 *     the line's ENCODING parameter, and decoded byte-at-a-time. That produces
 *     mojibake for real UTF-8 ("José" → "JosÃ©") and swallows ordinary text as
 *     escapes (a URL ending "?ref=1b" loses "=1b" to a control character).
 *
 * This script is READ-ONLY. It reports what it finds and writes a JSON report
 * so a repair pass can be reviewed before anything is written back.
 *
 * Usage:
 *   npx tsx scripts/db/audit-vcard-import-corruption.ts
 *   npx tsx scripts/db/audit-vcard-import-corruption.ts --workspace default-workspace
 *   npx tsx scripts/db/audit-vcard-import-corruption.ts --json
 *   npx tsx scripts/db/audit-vcard-import-corruption.ts --limit 20
 */

import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import type { PrismaClient } from "@life-os/db"

const require = createRequire(import.meta.url)
const dotenv = require("dotenv") as { config(options: { path: string; quiet?: boolean }): void }
loadEnv()

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..")
const REPORT_DIR = path.join(REPO_ROOT, "archive")
const BATCH_SIZE = 500

// Scalar text fields the broken parser could write into.
const TEXT_FIELDS = [
  "first", "last", "nickname", "title", "headline", "birthday",
  "notes", "company", "location", "linkedin", "twitter", "website",
  "facebook", "instagram",
] as const

// Stored as JSON string arrays rather than scalars.
const LIST_FIELDS = ["emails", "phones"] as const

type Issue = {
  personId: string
  personName: string
  field: string
  index: number | null
  kind: "parameter-leak" | "mojibake" | "control-character"
  value: string
  suggested: string | null
}

type Report = {
  generatedAt: string
  workspaceFilter: string | null
  workspacesScanned: string[]
  peopleScanned: number
  /**
   * Non-empty values actually examined. Without this, a clean database and a
   * broken field selection both report "0 issues" and look identical.
   */
  valuesScanned: number
  peopleAffected: number
  issueCount: number
  byKind: Record<string, number>
  byField: Record<string, number>
  issues: Issue[]
}

// ── Detection ────────────────────────────────────────────────────────────────

/**
 * A leaked parameter segment, e.g. "TYPE=WORK:" or "CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:".
 * Requires an "=" so that a URL scheme ("https:", "mailto:") is never mistaken for one.
 */
const PARAM_WITH_VALUE = /^[A-Za-z][A-Za-z0-9-]*=[^:]*:/

/**
 * vCard 2.1 allowed bare parameters — "EMAIL;INTERNET:a@b.com". Matched against a
 * closed keyword list for the same reason: an open pattern would swallow URLs.
 */
const BARE_PARAM_TOKEN = "INTERNET|PREF|HOME|WORK|CELL|VOICE|FAX|OTHER|IPHONE|MAIN|MOBILE|X-[A-Za-z0-9-]+"
const PARAM_BARE = new RegExp(`^(?:${BARE_PARAM_TOKEN})(?:;(?:${BARE_PARAM_TOKEN}))*:`, "i")

/**
 * UTF-8 bytes rendered as Latin-1 — the signature of the byte-at-a-time decode.
 * "José" stored as "JosÃ©": a C3/C2 lead byte followed by a continuation byte.
 */
const MOJIBAKE = /[\u00C3\u00C2][\u0080-\u00BF]|\u00E2\u20AC|\uFEFF|\uFFFD/

/**
 * Control characters left behind when "=XX" in ordinary text was eaten as an
 * escape. Tab, newline, and carriage return are excluded — legitimate in notes.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/

function leakedPrefix(value: string): string | null {
  const match = value.match(PARAM_WITH_VALUE) ?? value.match(PARAM_BARE)
  return match ? match[0] : null
}

/** Best-effort reversal of the Latin-1/UTF-8 confusion, for review only. */
function repairMojibake(value: string): string | null {
  try {
    const bytes = Uint8Array.from([...value].map(char => char.charCodeAt(0) & 0xff))
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return decoded === value ? null : decoded
  } catch {
    return null
  }
}

function inspect(personId: string, personName: string, field: string, index: number | null, raw: unknown): Issue[] {
  if (typeof raw !== "string" || !raw.trim()) return []
  const issues: Issue[] = []

  const prefix = leakedPrefix(raw)
  if (prefix) {
    issues.push({
      personId, personName, field, index,
      kind: "parameter-leak",
      value: raw,
      suggested: raw.slice(prefix.length).trim() || null,
    })
  }

  if (MOJIBAKE.test(raw)) {
    issues.push({
      personId, personName, field, index,
      kind: "mojibake",
      value: raw,
      suggested: repairMojibake(raw),
    })
  }

  if (CONTROL_CHARS.test(raw)) {
    issues.push({
      personId, personName, field, index,
      kind: "control-character",
      value: JSON.stringify(raw),
      // Irrecoverable: the original characters were consumed at import.
      // The source contact has to be re-imported to restore them.
      suggested: null,
    })
  }

  return issues
}

function parseList(raw: unknown): string[] {
  if (typeof raw !== "string") return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const asJson = args.includes("--json")
  const workspaceId = argValue(args, "--workspace")
  const sampleLimit = Number(argValue(args, "--limit") ?? 10)

  const db: PrismaClient = (await import("@life-os/db")).db

  const select = {
    id: true, workspaceId: true,
    ...Object.fromEntries(TEXT_FIELDS.map(field => [field, true])),
    ...Object.fromEntries(LIST_FIELDS.map(field => [field, true])),
  } as Record<string, true>

  const issues: Issue[] = []
  const workspaces = new Set<string>()
  let scanned = 0
  let valuesScanned = 0
  let skip = 0

  // Batched: a single unbounded query against thousands of people exceeds
  // Turso/libSQL's query parameter limit.
  for (;;) {
    const batch = await db.person.findMany({
      where: workspaceId ? { workspaceId } : undefined,
      select,
      orderBy: { createdAt: "asc" },
      skip,
      take: BATCH_SIZE,
    }) as unknown as Record<string, unknown>[]

    for (const person of batch) {
      scanned++
      workspaces.add(String(person.workspaceId))
      const id = String(person.id)
      const name = `${person.first ?? ""} ${person.last ?? ""}`.trim() || "(unnamed)"

      for (const field of TEXT_FIELDS) {
        const value = person[field]
        if (typeof value === "string" && value.trim()) valuesScanned++
        issues.push(...inspect(id, name, field, null, value))
      }
      for (const field of LIST_FIELDS) {
        parseList(person[field]).forEach((value, index) => {
          if (value.trim()) valuesScanned++
          issues.push(...inspect(id, name, field, index, value))
        })
      }
    }

    if (batch.length < BATCH_SIZE) break
    skip += BATCH_SIZE
  }

  const affectedPeople = new Set(issues.map(issue => issue.personId))
  const report: Report = {
    generatedAt: new Date().toISOString(),
    workspaceFilter: workspaceId ?? null,
    workspacesScanned: [...workspaces].sort(),
    peopleScanned: scanned,
    valuesScanned,
    peopleAffected: affectedPeople.size,
    issueCount: issues.length,
    byKind: countBy(issues, issue => issue.kind),
    byField: countBy(issues, issue => issue.field),
    issues,
  }

  if (asJson) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n")
    return
  }

  fs.mkdirSync(REPORT_DIR, { recursive: true })
  const reportPath = path.join(REPORT_DIR, `vcard-corruption-${Date.now()}.json`)
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))

  print(report, sampleLimit, reportPath)
}

function print(report: Report, sampleLimit: number, reportPath: string) {
  const { issues } = report
  console.log("")
  console.log("vCard import corruption audit")
  console.log("─".repeat(60))
  console.log(`Workspaces scanned : ${report.workspacesScanned.join(", ") || "(none)"}`)
  console.log(`People scanned     : ${report.peopleScanned}`)
  console.log(`Values examined    : ${report.valuesScanned}`)
  console.log(`People affected    : ${report.peopleAffected}`)
  console.log(`Issues found       : ${report.issueCount}`)

  if (!issues.length) {
    console.log("")
    if (report.valuesScanned === 0) {
      console.log("WARNING: no non-empty values were examined at all.")
      console.log("A clean result here is meaningless — check the workspace filter")
      console.log("and that the Person field selection still matches the schema.")
    } else {
      console.log("No corrupted values found. Nothing to repair.")
    }
    console.log("")
    return
  }

  console.log("")
  console.log("By kind:")
  for (const [kind, count] of Object.entries(report.byKind).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${kind.padEnd(20)} ${count}`)
  }
  console.log("")
  console.log("By field:")
  for (const [field, count] of Object.entries(report.byField).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${field.padEnd(20)} ${count}`)
  }

  console.log("")
  console.log(`Sample (first ${Math.min(sampleLimit, issues.length)} of ${issues.length}):`)
  console.log("─".repeat(60))
  for (const issue of issues.slice(0, sampleLimit)) {
    const location = issue.index === null ? issue.field : `${issue.field}[${issue.index}]`
    console.log(`  ${issue.personName}  (${issue.personId})`)
    console.log(`    ${location} · ${issue.kind}`)
    console.log(`    stored    : ${truncate(issue.value)}`)
    console.log(`    suggested : ${issue.suggested === null ? "(unrecoverable — re-import the source contact)" : truncate(issue.suggested)}`)
    console.log("")
  }

  const unrecoverable = issues.filter(issue => issue.suggested === null).length
  if (unrecoverable) {
    console.log(`${unrecoverable} value(s) cannot be reconstructed from what was stored.`)
    console.log("Those need the original .vcf re-imported through the fixed parser.")
    console.log("")
  }

  console.log(`Full report: ${path.relative(REPO_ROOT, reportPath)}`)
  console.log("")
  console.log("This script made no changes. Review the report before any repair pass.")
  console.log("")
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) {
    const value = key(item)
    counts[value] = (counts[value] ?? 0) + 1
  }
  return counts
}

function truncate(value: string, max = 90) {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function argValue(args: string[], flag: string): string | undefined {
  const inline = args.find(arg => arg.startsWith(`${flag}=`))
  if (inline) return inline.slice(flag.length + 1)
  const index = args.indexOf(flag)
  return index !== -1 ? args[index + 1] : undefined
}

function loadEnv() {
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(process.cwd(), "apps/persons/.env"),
    path.join(process.cwd(), "apps/persons/.env.local"),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) dotenv.config({ path: candidate, quiet: true })
  }
}

main()
  .catch(error => {
    console.error("Audit failed:", error)
    process.exitCode = 1
  })
