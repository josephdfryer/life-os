import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { parseTags } from "@/lib/utils"
import { enrichWithAttention } from "@/lib/attention"
import type { Interaction } from "@/types"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const minimal = searchParams.get("minimal") === "true"

  // ── Lightweight paginated list (contacts page, import matching) ──────────────
  if (minimal) {
    const page   = Math.max(0, parseInt(searchParams.get("page")  ?? "0"))
    const limit  = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") ?? "50")))
    const search = searchParams.get("search")?.trim() ?? ""
    const sort   = searchParams.get("sort") ?? "name"

    const fields = searchParams.get("fields")?.split(",").filter(Boolean) ?? []
    const valueFilters = {
      title:    searchParams.get("title")?.trim() ?? "",
      company:  searchParams.get("company")?.trim() ?? "",
      location: searchParams.get("location")?.trim() ?? "",
      headline: searchParams.get("headline")?.trim() ?? "",
    }

    const AND: Record<string, unknown>[] = []
    // Split into tokens so "Paul G" matches first="Paul" AND last starts with "G"
    const tokens = search.split(/\s+/).filter(Boolean)
    for (const token of tokens) {
      AND.push({
        OR: [
          { first:    { contains: token } },
          { last:     { contains: token } },
          { emails:   { contains: token } },
          { title:    { contains: token } },
          { company:  { contains: token } },
          { headline: { contains: token } },
          { notes:    { contains: token } },
          { location: { contains: token } },
        ],
      })
    }
    for (const f of fields) {
      if (f === "first")    AND.push({ first:    { not: "" } })
      if (f === "last")     AND.push({ last:     { not: "" } })
      if (f === "email")    AND.push({ emails:   { not: "[]" } })
      if (f === "phone")    AND.push({ phones:   { not: "[]" } })
      if (f === "title")    AND.push({ title:    { not: null } })
      if (f === "company")  AND.push({ company:  { not: null } })
      if (f === "headline") AND.push({ headline: { not: null } })
      if (f === "birthday") AND.push({ birthday: { not: null } })
      if (f === "location") AND.push({ location: { not: null } })
      if (f === "linkedin") AND.push({ linkedin: { not: null } })
      if (f === "twitter")  AND.push({ twitter:  { not: null } })
      if (f === "website")  AND.push({ website:  { not: null } })
      if (f === "notes")    AND.push({ notes:    { not: null } })
    }
    if (valueFilters.title)    AND.push({ title:    { contains: valueFilters.title } })
    if (valueFilters.company)  AND.push({ company:  { contains: valueFilters.company } })
    if (valueFilters.location) AND.push({ location: { contains: valueFilters.location } })
    if (valueFilters.headline) AND.push({ headline: { contains: valueFilters.headline } })
    const where = AND.length ? { AND } : {}

    const orderBy =
      sort === "closeness" ? [{ closeness: "desc" as const }, { last: "asc" as const }]
      : sort === "recent"  ? [{ createdAt:  "desc" as const }]
      :                      [{ last: "asc" as const }, { first: "asc" as const }]

    const [rows, total] = await Promise.all([
      db.person.findMany({
        where, orderBy, skip: page * limit, take: limit,
        include: {
          interactions: { take: 1, orderBy: { timestamp: "desc" }, select: { timestamp: true } },
        },
      }),
      db.person.count({ where }),
    ])

    return NextResponse.json({
      persons: rows.map(p => {
        const lastTs = p.interactions[0]?.timestamp ?? null
        const lastInteractionDate = lastTs ? new Date(lastTs) : null
        const daysSinceLast = lastInteractionDate
          ? Math.floor((Date.now() - lastInteractionDate.getTime()) / 86400000)
          : null
        const cadence = p.closeness === 4 ? 10 : p.closeness === 3 ? 21 : p.closeness === 2 ? 90 : 0
        const attentionScore = p.closeness === 1
          ? 0
          : daysSinceLast !== null
            ? (cadence > 0 ? daysSinceLast / cadence : 0)
            : 99
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { interactions: _ix, ...rest } = p
        return {
          ...rest,
          tags: parseTags(p.tags), values: parseTags(p.values),
          emails: parseTags(p.emails), phones: parseTags(p.phones),
          interactions: [],
          lastInteractionDate,
          daysSinceLast,
          attentionScore,
        }
      }),
      total,
      page,
      limit,
      hasMore: (page + 1) * limit < total,
    })
  }

  // ── Full load with attention enrichment (individual use cases only) ──────────
  const persons = await db.person.findMany({
    include: {
      interactions: {
        select: {
          id: true, createdAt: true, personId: true, eventId: true,
          type: true, timestamp: true, duration: true, emotionalWeight: true,
          outcome: true, summary: true, notes: true, actionItems: true,
          billable: true, amount: true, direction: true, sourceFileId: true,
        },
        orderBy: { timestamp: "desc" },
        take: 10,
      },
      plans: { select: { id: true, status: true } },
    },
    orderBy: { createdAt: "asc" },
  })

  const enriched = persons.map(p => {
    const interactions: Interaction[] = p.interactions.map(ix => ({
      ...ix,
      actionItems: parseTags(ix.actionItems) as unknown as string[],
      event: null,
      sourceFile: null,
    })) as unknown as Interaction[]

    const person = {
      ...p,
      tags:   parseTags(p.tags),
      values: parseTags(p.values),
      emails: parseTags(p.emails),
      phones: parseTags(p.phones),
      interactions,
      plans: p.plans,
    }

    return enrichWithAttention(person as Parameters<typeof enrichWithAttention>[0])
  })

  return NextResponse.json(enriched)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const {
    first, last, title, headline, company, emails, phones, birthday,
    closeness, tags, values, notes, location, linkedin, twitter, website,
    color, colorSoft,
  } = body

  const person = await db.person.create({
    data: {
      first: first.trim(),
      last: last.trim(),
      title: title?.trim() || null,
      headline: headline?.trim() || null,
      company:  company?.trim()  || null,
      emails:   JSON.stringify(Array.isArray(emails) ? emails.map((e: string) => e.trim()).filter(Boolean) : (emails?.trim() ? [emails.trim()] : [])),
      phones:   JSON.stringify(Array.isArray(phones) ? phones.map((p: string) => p.trim()).filter(Boolean) : (phones?.trim() ? [phones.trim()] : [])),
      birthday: birthday?.trim() || null,
      closeness: Number(closeness) || 2,
      tags:   JSON.stringify(Array.isArray(tags)   ? tags   : []),
      values: JSON.stringify(Array.isArray(values) ? values : []),
      notes:    notes?.trim()    || null,
      location: location?.trim() || null,
      linkedin: linkedin?.trim() || null,
      twitter:  twitter?.trim()  || null,
      website:  website?.trim()  || null,
      color:    color    || null,
      colorSoft: colorSoft || null,
    },
  })

  return NextResponse.json({ ...person, emails: parseTags(person.emails), phones: parseTags(person.phones) }, { status: 201 })
}
