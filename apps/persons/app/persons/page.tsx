import { redirect } from "next/navigation"
import { unstable_cache } from "next/cache"
import PersonsClient from "./PersonsClient"
import { requireAccess } from "@/server/domain/access"
import { AppError } from "@/server/api/errors"
import { db } from "@/lib/db"
import { parseTags } from "@/lib/utils"

export const dynamic = "force-dynamic"

const LIMIT = 50

async function fetchPeopleForPage(workspaceId: string) {
  const where = { workspaceId }
  const orderBy = [{ last: "asc" as const }, { first: "asc" as const }]
  const [rows, total] = await Promise.all([
    db.person.findMany({
      where, orderBy, skip: 0, take: LIMIT,
      include: { interactions: { take: 1, orderBy: { timestamp: "desc" }, select: { timestamp: true } } },
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

    const persons = rows.map((p: typeof rows[number]) => {
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
    })

    return <PersonsClient initialData={{ persons: persons as never, total, hasMore: LIMIT < total }} />
  } catch (error) {
    if (error instanceof AppError && error.status === 401) {
      redirect("/login?callbackUrl=%2Fpersons")
    }
    return <PersonsClient initialData={null} />
  }
}
