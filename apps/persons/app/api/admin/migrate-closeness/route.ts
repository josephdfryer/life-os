import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireAccess } from "@/server/domain/access"
import { handleRouteError } from "@/server/api/respond"

// One-time migration: shifts 3-level closeness (1/2/3) to 4-level (1/2/3/4)
// adding Nurture (2) between Acquaintance (1) and Friend (3).
// Safe to call multiple times — skips if already migrated.
// Admin-only and scoped to the caller's workspace: this must never touch
// another tenant's Person records.
export async function POST() {
  try {
    const access = await requireAccess("settings.manage")
    const alreadyMigrated = await db.person.count({ where: { closeness: 4, workspaceId: access.workspaceId } })
    if (alreadyMigrated > 0) {
      return NextResponse.json({ skipped: true, reason: "Already migrated (closeness=4 records exist)" })
    }

    // Shift in reverse order to avoid double-counting
    const innerCircle = await db.person.updateMany({ where: { closeness: 3, workspaceId: access.workspaceId }, data: { closeness: 4 } })
    const friends     = await db.person.updateMany({ where: { closeness: 2, workspaceId: access.workspaceId }, data: { closeness: 3 } })

    console.log("[migrate-closeness] done", { innerCircle: innerCircle.count, friends: friends.count })
    return NextResponse.json({ migrated: true, innerCircle: innerCircle.count, friends: friends.count })
  } catch (err) {
    return handleRouteError(err)
  }
}
