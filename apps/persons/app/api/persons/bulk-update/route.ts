import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireAccess } from "@/server/domain/access"
import { handleRouteError } from "@/server/api/respond"
import { badRequest, optionalString, optionalStringArray } from "@/server/api/errors"
import { jsonList } from "@/server/domain/dto"
import { normalizeBirthday } from "@/lib/birthday"
import { revalidatePeopleCache } from "@/server/domain/people"

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAccess("people.write")
    const body = await req.json()
    const updates: unknown[] = Array.isArray(body.updates) ? body.updates : []
    if (updates.length === 0) throw badRequest("updates must be a non-empty array")
    if (updates.length > 200) throw badRequest("Maximum 200 updates per request")

    let count = 0
    await db.$transaction(async tx => {
      for (const u of updates) {
        const update = u as Record<string, unknown>
        const id = optionalString(update.id)
        if (!id) continue
        const fields = (update.fields ?? {}) as Record<string, unknown>
        const patch: Record<string, unknown> = {}

        if (fields.email !== undefined || fields.emails !== undefined) {
          const arr = optionalStringArray(fields.emails)
          const list = arr.length ? arr : optionalString(fields.email) ? [optionalString(fields.email)!] : []
          if (list.length) {
            const emailsJson = jsonList(list)
            patch.emails = emailsJson
            patch.emailSearch = emailsJson.toLowerCase()
          }
        }
        if (fields.phone !== undefined || fields.phones !== undefined) {
          const arr = optionalStringArray(fields.phones)
          const list = arr.length ? arr : optionalString(fields.phone) ? [optionalString(fields.phone)!] : []
          if (list.length) patch.phones = jsonList(list)
        }
        if (fields.title     !== undefined) patch.title     = optionalString(fields.title)
        if (fields.headline  !== undefined) patch.headline  = optionalString(fields.headline)
        if (fields.company   !== undefined) patch.company   = optionalString(fields.company)
        if (fields.notes     !== undefined) patch.notes     = optionalString(fields.notes)
        if (fields.location  !== undefined) patch.location  = optionalString(fields.location)
        if (fields.linkedin  !== undefined) patch.linkedin  = optionalString(fields.linkedin)
        if (fields.twitter   !== undefined) patch.twitter   = optionalString(fields.twitter)
        if (fields.website   !== undefined) patch.website   = optionalString(fields.website)
        if (fields.facebook  !== undefined) patch.facebook  = optionalString(fields.facebook)
        if (fields.instagram !== undefined) patch.instagram = optionalString(fields.instagram)
        if (fields.birthday  !== undefined) {
          const raw = optionalString(fields.birthday)
          patch.birthday = raw ? normalizeBirthday(raw) : null
        }

        if (Object.keys(patch).length === 0) continue

        const existing = await tx.person.findFirst({ where: { id, workspaceId: actor.workspaceId }, select: { id: true } })
        if (!existing) continue
        await tx.person.update({ where: { id }, data: patch })
        count++
      }
    })

    revalidatePeopleCache(actor.workspaceId)
    return NextResponse.json({ updated: count })
  } catch (error) {
    return handleRouteError(error)
  }
}
