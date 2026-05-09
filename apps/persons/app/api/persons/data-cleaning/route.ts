import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { parseTags } from "@/lib/utils"
import { requireAccess } from "@/server/domain/access"

type IssueKey =
  | "missing_email"
  | "missing_phone"
  | "missing_first"
  | "missing_last"
  | "name_only"
  | "strange_symbols"

type CleanupPerson = {
  id: string
  createdAt: Date
  updatedAt: Date
  first: string
  last: string
  nickname: string | null
  title: string | null
  headline: string | null
  emails: string[]
  phones: string[]
  birthday: string | null
  closeness: number
  tags: string[]
  values: string[]
  notes: string | null
  company: string | null
  location: string | null
  linkedin: string | null
  twitter: string | null
  website: string | null
  color: string | null
  colorSoft: string | null
  interactionCount: number
  issueKeys: IssueKey[]
  issueLabels: string[]
  completenessScore: number
}

const ISSUE_LABELS: Record<IssueKey, string> = {
  missing_email: "Missing email",
  missing_phone: "Missing phone",
  missing_first: "Missing first",
  missing_last: "Missing last",
  name_only: "Name only",
  strange_symbols: "Strange symbols",
}

export async function GET(req: NextRequest) {
  const actor = await requireAccess("people.read")
  const { searchParams } = new URL(req.url)
  const page = Math.max(0, parseInt(searchParams.get("page") ?? "0"))
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") ?? "50")))
  const search = searchParams.get("search")?.trim().toLowerCase() ?? ""
  const sort = searchParams.get("sort") ?? "issues"
  const issue = searchParams.get("issue") as IssueKey | "all" | null

  const rows = await db.person.findMany({
    where: { workspaceId: actor.workspaceId },
    orderBy: [{ last: "asc" }, { first: "asc" }],
    include: {
      _count: { select: { interactions: true } },
    },
  })

  const people = rows.map((row: typeof rows[number]) => {
    const emails = parseTags(row.emails)
    const phones = parseTags(row.phones)
    const tags = parseTags(row.tags)
    const values = parseTags(row.values)
    const issueKeys = findIssues({
      first: row.first,
      last: row.last,
      nickname: row.nickname,
      emails,
      phones,
      title: row.title,
      headline: row.headline,
      company: row.company,
      location: row.location,
      birthday: row.birthday,
      notes: row.notes,
      linkedin: row.linkedin,
      twitter: row.twitter,
      website: row.website,
      tags,
      values,
      interactionCount: row._count.interactions,
    })

    const filledCore = [
      row.first,
      row.last,
      row.nickname,
      row.title,
      row.company,
      row.location,
      row.birthday,
      row.notes,
      row.linkedin,
      row.twitter,
      row.website,
      emails.length ? "email" : "",
      phones.length ? "phone" : "",
      tags.length ? "tags" : "",
      values.length ? "values" : "",
      row._count.interactions ? "interactions" : "",
    ].filter(value => typeof value === "string" ? value.trim() : Boolean(value)).length

    return {
      id: row.id,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      first: row.first,
      last: row.last,
      nickname: row.nickname,
      title: row.title,
      headline: row.headline,
      emails,
      phones,
      birthday: row.birthday,
      closeness: row.closeness,
      tags,
      values,
      notes: row.notes,
      company: row.company,
      location: row.location,
      linkedin: row.linkedin,
      twitter: row.twitter,
      website: row.website,
      color: row.color,
      colorSoft: row.colorSoft,
      interactionCount: row._count.interactions,
      issueKeys,
      issueLabels: issueKeys.map(key => ISSUE_LABELS[key]),
      completenessScore: filledCore,
    } satisfies CleanupPerson
  })

  const stats = {
    total: people.length,
    needsCleanup: people.filter(person => person.issueKeys.length > 0).length,
    missingEmail: people.filter(person => person.issueKeys.includes("missing_email")).length,
    missingPhone: people.filter(person => person.issueKeys.includes("missing_phone")).length,
    missingFirst: people.filter(person => person.issueKeys.includes("missing_first")).length,
    missingLast: people.filter(person => person.issueKeys.includes("missing_last")).length,
    nameOnly: people.filter(person => person.issueKeys.includes("name_only")).length,
    strangeSymbols: people.filter(person => person.issueKeys.includes("strange_symbols")).length,
  }

  const filtered = people
    .filter(person => person.issueKeys.length > 0)
    .filter(person => !issue || issue === "all" || person.issueKeys.includes(issue))
    .filter(person => {
      if (!search) return true
      const haystack = [
        person.first,
        person.last,
        person.nickname,
        person.title,
        person.company,
        person.location,
        ...person.emails,
        ...person.phones,
        ...person.issueLabels,
      ].filter(Boolean).join(" ").toLowerCase()
      return haystack.includes(search)
    })
    .sort((a, b) => {
      if (sort === "name") return `${a.last} ${a.first}`.localeCompare(`${b.last} ${b.first}`)
      if (sort === "recent") return b.updatedAt.getTime() - a.updatedAt.getTime()
      if (sort === "sparse") return a.completenessScore - b.completenessScore
      return b.issueKeys.length - a.issueKeys.length || a.completenessScore - b.completenessScore
    })

  const start = page * limit
  const pageRows = filtered.slice(start, start + limit)

  return NextResponse.json({
    people: pageRows,
    stats,
    total: filtered.length,
    page,
    limit,
    hasMore: start + limit < filtered.length,
    issues: ISSUE_LABELS,
  })
}

function findIssues(person: {
  first: string
  last: string
  nickname: string | null
  emails: string[]
  phones: string[]
  title: string | null
  headline: string | null
  company: string | null
  location: string | null
  birthday: string | null
  notes: string | null
  linkedin: string | null
  twitter: string | null
  website: string | null
  tags: string[]
  values: string[]
  interactionCount: number
}) {
  const issues: IssueKey[] = []
  const first = person.first.trim()
  const last = person.last.trim()
  if (!person.emails.length) issues.push("missing_email")
  if (!person.phones.length) issues.push("missing_phone")
  if (!first) issues.push("missing_first")
  if (!last) issues.push("missing_last")

  const otherData = [
    person.nickname,
    person.title,
    person.headline,
    person.company,
    person.location,
    person.birthday,
    person.notes,
    person.linkedin,
    person.twitter,
    person.website,
    person.emails.length ? "email" : "",
    person.phones.length ? "phone" : "",
    person.tags.length ? "tags" : "",
    person.values.length ? "values" : "",
    person.interactionCount ? "interactions" : "",
  ].some(value => typeof value === "string" ? value.trim() : Boolean(value))
  if (first && last && !otherData) issues.push("name_only")

  if ([person.first, person.last, person.nickname].some(hasStrangeSymbols)) {
    issues.push("strange_symbols")
  }

  return issues
}

function hasStrangeSymbols(value: string | null) {
  if (!value) return false
  return /[()[\]{}<>|\\/_+=~`^*]/.test(value)
}
