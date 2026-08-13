import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireAccess } from "@/server/domain/access"
import { handleRouteError } from "@/server/api/respond"
import { optionalString, optionalStringArray, requiredString } from "@/server/api/errors"
import { jsonList } from "@/server/domain/dto"
import { normalizeBirthday } from "@/lib/birthday"
import { revalidatePersonsCache } from "@/server/domain/persons"
import { bulkCreatePeopleContract } from "@life-os/contracts"
import { parseJsonBody } from "@/server/api/contracts"

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAccess("people.write")
    const { contacts } = await parseJsonBody(req, bulkCreatePeopleContract)

    const rows = contacts.map(contact => {
      const emailsList = (() => {
        const arr = optionalStringArray(contact.emails)
        if (arr.length) return arr
        const single = optionalString(contact.email)
        return single ? [single] : []
      })()
      const phonesList = (() => {
        const arr = optionalStringArray(contact.phones)
        if (arr.length) return arr
        const single = optionalString(contact.phone)
        return single ? [single] : []
      })()
      const emailsJson = jsonList(emailsList)
      const birthdayRaw = optionalString(contact.birthday)
      const birthday = birthdayRaw ? normalizeBirthday(birthdayRaw) : null

      return {
        workspaceId: actor.workspaceId,
        first: requiredString(contact.first, "first"),
        last: optionalString(contact.last) ?? "",
        nickname: optionalString(contact.nickname),
        title: optionalString(contact.title),
        headline: optionalString(contact.headline),
        company: optionalString(contact.company),
        emails: emailsJson,
        emailSearch: emailsJson.toLowerCase(),
        phones: jsonList(phonesList),
        birthday,
        closeness: contact.closeness !== undefined ? Number(contact.closeness) || 2 : 2,
        tags: jsonList(optionalStringArray(contact.tags)),
        values: jsonList(optionalStringArray(contact.values)),
        notes: optionalString(contact.notes),
        location: optionalString(contact.location),
        linkedin: optionalString(contact.linkedin),
        twitter: optionalString(contact.twitter),
        website: optionalString(contact.website),
        facebook: optionalString(contact.facebook),
        instagram: optionalString(contact.instagram),
        color: optionalString(contact.color),
        colorSoft: optionalString(contact.colorSoft),
        source: optionalString(contact.source),
      }
    })

    const result = await db.person.createMany({ data: rows })
    revalidatePersonsCache(actor.workspaceId)
    return NextResponse.json({ created: result.count })
  } catch (error) {
    return handleRouteError(error)
  }
}
