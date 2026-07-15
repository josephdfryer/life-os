import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireAccess } from "@/server/domain/access"
import { handleRouteError } from "@/server/api/respond"

// Raw DDL migration — no per-tenant data to scope, but this must never be
// reachable without admin auth: it runs arbitrary schema changes.
export async function POST() {
  try {
    await requireAccess("settings.manage")
    const columns = await db.$queryRawUnsafe<{ name: string }[]>("PRAGMA table_info(Person)")
    const hasTitle = columns.some(col => col.name === "title")

    if (!hasTitle) {
      await db.$executeRawUnsafe("ALTER TABLE Person ADD COLUMN title TEXT")
    }

    const after = await db.$queryRawUnsafe<{ name: string }[]>("PRAGMA table_info(Person)")
    return NextResponse.json({
      migrated: !hasTitle,
      titleColumnPresent: after.some(col => col.name === "title"),
    })
  } catch (err) {
    return handleRouteError(err)
  }
}
