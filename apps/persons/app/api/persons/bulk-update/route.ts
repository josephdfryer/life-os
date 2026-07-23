import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireAccess } from "@/server/domain/access"
import { handleRouteError } from "@/server/api/respond"
import { optionalString, optionalStringArray } from "@/server/api/errors"
import { jsonList } from "@/server/domain/dto"
import { normalizeBirthday } from "@/lib/birthday"
import { revalidatePersonsCache } from "@/server/domain/persons"
import { bulkUpdatePeopleContract } from "@life-os/contracts"
import { parseJsonBody } from "@/server/api/contracts"

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAccess("people.write")
    const { updates } = await parseJsonBody(req, bulkUpdatePeopleContract)

    let count = 0
    await db.$transaction(async tx => {
      for (const update of updates) {
        const id = optionalString(update.id)
        if (!id) continue
        const fields = update.fields
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

    revalidatePersonsCache(actor.workspaceId)
    return NextResponse.json({ updated: count })
  } catch (error) {
    return handleRouteError(error)
  }
}
