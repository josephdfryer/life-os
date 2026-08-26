import { redirect } from "next/navigation"
import { unstable_cache } from "next/cache"
import PersonsClient from "./PersonsClient"
import { requireAccess } from "@/server/domain/access"
import { AppError } from "@/server/api/errors"
import { db } from "@/lib/db"
import { personListInclude, serializePersonListRow } from "@/server/queries/person-list"

export const dynamic = "force-dynamic"

const LIMIT = 50

async function fetchPeopleForPage(workspaceId: string) {
  const where = { workspaceId }
  const orderBy = [{ last: "asc" as const }, { first: "asc" as const }]
  const [rows, total] = await Promise.all([
    db.person.findMany({
      where, orderBy, skip: 0, take: LIMIT,
      include: personListInclude(),
    }),
    db.person.count({ where }),
  ])
  return { rows, total }
}

export default async function PersonsPage() {
  try {
    const actor = await requireAccess("people.read")

    const { rows, total } = await unstable_cache(
      () => fetchPeopleForPage(actor.workspaceId),
      [`people-page:${actor.workspaceId}`],
      { revalidate: 60 },
    )()

    const persons = rows.map(serializePersonListRow)

    return <PersonsClient initialData={{ persons, total, hasMore: LIMIT < total }} />
  } catch (error) {
    if (error instanceof AppError && error.status === 401) {
      redirect("/login?callbackUrl=%2Fpersons")
    }
    return <PersonsClient initialData={null} />
  }
}
