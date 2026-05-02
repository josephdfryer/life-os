import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    await db.interaction.delete({ where: { id } })
    return NextResponse.json({ deleted: id })
  } catch (err) {
    console.error("[interactions/delete] failed", { id, err })
    return NextResponse.json({ error: "Delete failed" }, { status: 500 })
  }
}
