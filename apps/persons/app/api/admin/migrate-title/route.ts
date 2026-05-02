import { NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function POST() {
  try {
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
    console.error("[migrate-title] failed", err)
    return NextResponse.json({ error: "Migration failed" }, { status: 500 })
  }
}
