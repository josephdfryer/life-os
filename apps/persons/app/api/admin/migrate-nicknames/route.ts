import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireAccess } from "@/server/domain/access"
import { handleRouteError } from "@/server/api/respond"

// One-time migration: finds persons where first or last contains (nickname),
// extracts the parenthetical into the nickname field, and removes the parens.
// Safe to call multiple times — only touches records where first/last still
// contain a "(" character and nickname is not yet set.
// Admin-only and scoped to the caller's workspace.
export async function POST() {
  try {
    const access = await requireAccess("settings.manage")
    const candidates = await db.person.findMany({
      where: {
        AND: [
          { nickname: null },
          { OR: [{ first: { contains: "(" } }, { last: { contains: "(" } }] },
          { workspaceId: access.workspaceId },
        ],
      },
      select: { id: true, first: true, last: true },
    })

    let migrated = 0
    let skipped = 0
    const preview: { id: string; before: string; after: string; nickname: string }[] = []

    for (const person of candidates) {
      const combined = `${person.first} ${person.last}`.trim()
      const match = combined.match(/\(([^)]+)\)/)
      if (!match) { skipped++; continue }

      const nickname = match[1].trim()
      if (!nickname) { skipped++; continue }

      const cleanFirst = person.first.replace(/\s*\([^)]+\)\s*/g, " ").trim()
      const cleanLast = person.last.replace(/\s*\([^)]+\)\s*/g, " ").trim()

      await db.person.updateMany({
        where: { id: person.id, workspaceId: access.workspaceId },
        data: { first: cleanFirst, last: cleanLast, nickname },
      })

      preview.push({
        id: person.id,
        before: `${person.first} ${person.last}`.trim(),
        after: `${cleanFirst} ${cleanLast}`.trim(),
        nickname,
      })
      migrated++
    }

    console.log("[migrate-nicknames] done", { migrated, skipped })
    return NextResponse.json({ migrated, skipped, preview: preview.slice(0, 20) })
  } catch (err) {
    return handleRouteError(err)
  }
}
