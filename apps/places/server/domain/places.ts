import { db } from "@/lib/db"
import { centsToDollars } from "@life-os/db"
import { badRequest, notFound, requiredString } from "@/server/api/errors"
import { auditAction, type DomainActor } from "./audit"

type PlaceRow = Awaited<ReturnType<typeof fetchPlaceProfileRow>>
type EventRow = NonNullable<PlaceRow>["events"][number]
type GroupRow = Awaited<ReturnType<typeof fetchWorkspaceGroupPage>>[number]
type PlaceGroupRow = NonNullable<PlaceRow>["groupAffiliations"][number]

export type PlaceMapItem = {
  id: string
  name: string
  latitude?: number
  longitude?: number
  address?: string
  googlePlaceId?: string
  placeType?: string
  favorite?: boolean
  stats: PlaceStats
  weight: number
  thumbnailUrl?: string
  financialGroup?: {
    id: string
    name: string
    groupType: string
    relationshipType: string
  }
}

export type PlaceStats = {
  visitCount: number
  photoCount: number
  personCount: number
  groupCount: number
  noteCount: number
  planCount: number
  firstVisitAt?: string
  lastVisitAt?: string
  totalSpend?: number
}

export type PlaceTimelineItem = {
  eventId: string
  title: string
  startedAt: string
  endedAt?: string
  gapSincePreviousVisitDays?: number
  people: { id: string; name: string }[]
  groups: { id: string; name: string; associationType: "explicit_tag" | "inferred" | "place_affiliation" }[]
  photoCount: number
  photos: { id: string; name: string }[]
  spendAmount?: number
  notePreview?: string
}

export type PlacePersonSummary = {
  personId: string
  name: string
  sharedEventCount: number
  lastSharedEventAt?: string
}

export type PlaceGroupSummary = {
  groupId: string
  name: string
  groupType: string
  relationshipType?: string
  eventCount?: number
}

export type PlacePhotoSummary = {
  itemId: string
  name: string
  eventId: string
  eventTitle: string
  occurredAt: string
}

export type PlacePlanSummary = {
  planId: string
  title: string
  plannedDate?: string
}

export type PlaceProfile = {
  place: NonNullable<PlaceRow>
  stats: PlaceStats
  timeline: PlaceTimelineItem[]
  people: PlacePersonSummary[]
  groups: {
    affiliated: PlaceGroupSummary[]
    activity: PlaceGroupSummary[]
  }
  photos: PlacePhotoSummary[]
  notes: NonNullable<PlaceRow>["notes"]
  plans: PlacePlanSummary[]
}

export async function getPlacesForMap(workspaceId: string | null | undefined): Promise<PlaceMapItem[]> {
  const wsId = workspaceId ?? "default-workspace"
  const [places, groups] = await Promise.all([
    fetchAllPlacesForMap(wsId),
    fetchWorkspaceGroups(wsId),
  ])

  return places.map(place => {
    const derived = derivePlaceData(place, groups)
    const coordinates = parseCoordinates(place.coordinates)
    return {
      id: place.id,
      name: place.name,
      latitude: coordinates?.latitude,
      longitude: coordinates?.longitude,
      address: place.address ?? undefined,
      googlePlaceId: place.googlePlaceId ?? undefined,
      placeType: place.type ?? undefined,
      favorite: place.favorite,
      stats: {
        visitCount: derived.stats.visitCount,
        photoCount: derived.stats.photoCount,
        personCount: derived.stats.personCount,
        groupCount: derived.stats.groupCount,
        noteCount: derived.stats.noteCount,
        planCount: derived.stats.planCount,
        totalSpend: derived.stats.totalSpend,
        firstVisitAt: derived.stats.firstVisitAt,
        lastVisitAt: derived.stats.lastVisitAt,
      },
      weight: placeWeight(derived.stats),
      financialGroup: primaryFinancialGroup(place.groupAffiliations),
    }
  })
}

async function fetchAllPlacesForMap(workspaceId: string) {
  const result: Awaited<ReturnType<typeof fetchPlacesForMapPage>> = []
  let cursor: string | undefined
  do {
    const rows = await fetchPlacesForMapPage(workspaceId, cursor)
    result.push(...rows)
    cursor = rows.length === 50 ? rows.at(-1)?.id : undefined
  } while (cursor)
  return result
}

function fetchPlacesForMapPage(workspaceId: string, cursor?: string) {
  return db.place.findMany({
    where: { workspaceId },
    include: {
      notes: { where: { workspaceId } },
      plans: {
        where: { workspaceId },
        select: { id: true, text: true, scheduledStart: true },
        orderBy: { scheduledStart: "asc" as const },
      },
      groupAffiliations: {
        where: { group: { workspaceId } },
        include: { group: { select: { id: true, name: true, groupType: true } } },
      },
      interactions: {
        where: { workspaceId, eventId: null },
        select: { id: true, amount: true },
      },
      events: {
        where: { workspaceId },
        include: {
          groupTags: { where: { workspaceId }, select: { id: true, name: true, groupType: true } },
          interactions: {
            where: { workspaceId },
            include: {
              person: { select: { id: true, first: true, last: true } },
              itemInteractions: {
                where: { item: { workspaceId } },
                include: {
                  item: { select: { id: true, name: true, category: true, tags: true } },
                },
              },
            },
          },
        },
        orderBy: { timestamp: "desc" as const },
      },
    },
    orderBy: [{ name: "asc" as const }, { id: "asc" as const }],
    take: 50,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })
}

export async function getPlaceProfile(placeId: string, workspaceId: string | null | undefined): Promise<PlaceProfile> {
  const wsId = workspaceId ?? "default-workspace"
  const [place, groups] = await Promise.all([
    fetchPlaceProfileRow(placeId, wsId),
    fetchWorkspaceGroups(wsId),
  ])
  if (!place) throw notFound("Place not found", { placeId })
  return derivePlaceData(place, groups)
}

export async function createPlaceNote(
  placeId: string,
  workspaceId: string | null | undefined,
  body: unknown,
  opts: { eventId?: unknown; actor?: DomainActor } = {},
) {
  const wsId = workspaceId ?? "default-workspace"
  await assertPlace(placeId, wsId)
  const eventId = typeof opts.eventId === "string" && opts.eventId.trim() ? opts.eventId.trim() : null
  if (eventId) await assertPlaceEvent(placeId, eventId, wsId)

  const note = await db.placeNote.create({
    data: {
      placeId,
      workspaceId: wsId,
      body: requiredString(body, "body"),
      eventId,
    },
  })
  await auditAction({ actor: opts.actor, action: "place.note.create", targetType: "place", targetId: placeId, metadata: { noteId: note.id, eventId } })
  return note
}

export async function updatePlaceNote(noteId: string, workspaceId: string | null | undefined, body: unknown, actor?: DomainActor) {
  const wsId = workspaceId ?? "default-workspace"
  const note = await db.placeNote.findFirst({ where: { id: noteId, workspaceId: wsId } })
  if (!note) throw notFound("Place note not found", { noteId })
  const updated = await db.placeNote.update({
    where: { id: noteId },
    data: { body: requiredString(body, "body") },
  })
  await auditAction({ actor, action: "place.note.update", targetType: "place", targetId: note.placeId, metadata: { noteId } })
  return updated
}

export async function deletePlaceNote(noteId: string, workspaceId: string | null | undefined, actor?: DomainActor) {
  const wsId = workspaceId ?? "default-workspace"
  const note = await db.placeNote.findFirst({ where: { id: noteId, workspaceId: wsId } })
  if (!note) throw notFound("Place note not found", { noteId })
  await db.placeNote.delete({ where: { id: noteId } })
  await auditAction({ actor, action: "place.note.delete", targetType: "place", targetId: note.placeId, metadata: { noteId } })
}

export async function togglePlaceFavorite(placeId: string, workspaceId: string | null | undefined, actor?: DomainActor) {
  const wsId = workspaceId ?? "default-workspace"
  const place = await assertPlace(placeId, wsId)
  const updated = await db.place.update({
    where: { id: placeId },
    data: { favorite: !place.favorite },
  })
  await auditAction({ actor, action: "place.favorite.toggle", targetType: "place", targetId: placeId, metadata: { favorite: updated.favorite } })
  return updated
}

export async function updatePlaceMeaning(placeId: string, workspaceId: string | null | undefined, meaning: unknown, actor?: DomainActor) {
  const wsId = workspaceId ?? "default-workspace"
  await assertPlace(placeId, wsId)
  if (typeof meaning !== "string") throw badRequest("meaning must be a string")
  const normalized = meaning.trim()
  if (normalized.length > 2_000) throw badRequest("meaning must be 2000 characters or fewer")
  const place = await db.place.update({
    where: { id: placeId },
    data: { meaning: normalized || null },
  })
  await auditAction({
    actor,
    action: "place.meaning.update",
    targetType: "place",
    targetId: placeId,
    metadata: { hasMeaning: Boolean(place.meaning) },
  })
  return place
}

function derivePlaceData(place: NonNullable<PlaceRow>, workspaceGroups: GroupRow[]): PlaceProfile {
  const events = [...place.events].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
  const affiliated = place.groupAffiliations.map(affiliationToSummary)
  const affiliatedById = new Map(place.groupAffiliations.map(row => [row.groupId, row]))
  const activityGroups = new Map<string, PlaceGroupSummary>()
  const photos: PlacePhotoSummary[] = []
  const personEvents = new Map<string, { name: string; eventIds: Set<string>; lastAt: Date }>()
  const eventNotes = new Map<string, string>()

  for (const note of place.notes) {
    if (note.eventId && !eventNotes.has(note.eventId)) {
      eventNotes.set(note.eventId, note.body)
    }
  }

  const timeline = events.map((event, index) => {
    const eventPeople = peopleForEvent(event)
    const explicitGroups = event.groupTags.map(group => ({
      id: group.id,
      name: group.name,
      groupType: group.groupType,
      associationType: "explicit_tag" as const,
    }))
    const inferredGroups = inferGroupsForEvent(event, workspaceGroups).filter(group =>
      !explicitGroups.some(explicit => explicit.id === group.id)
    )
    const placeAffiliationGroups = place.groupAffiliations.filter(row =>
      !explicitGroups.some(group => group.id === row.groupId) &&
      !inferredGroups.some(group => group.id === row.groupId)
    )
    const eventPhotos = photosForEvent(event)
    const spendAmount = sumEventSpend(event)

    for (const person of eventPeople) {
      const current = personEvents.get(person.id)
      if (!current) {
        personEvents.set(person.id, { name: person.name, eventIds: new Set([event.id]), lastAt: event.timestamp })
      } else {
        current.eventIds.add(event.id)
        if (event.timestamp > current.lastAt) current.lastAt = event.timestamp
      }
    }

    for (const group of [...explicitGroups, ...inferredGroups]) {
      const existing = activityGroups.get(group.id)
      activityGroups.set(group.id, {
        groupId: group.id,
        name: group.name,
        groupType: group.groupType,
        eventCount: (existing?.eventCount ?? 0) + 1,
      })
    }

    for (const photo of eventPhotos) {
      photos.push({
        itemId: photo.id,
        name: photo.name,
        eventId: event.id,
        eventTitle: event.name || `Visit to ${place.name}`,
        occurredAt: event.timestamp.toISOString(),
      })
    }

    return {
      eventId: event.id,
      title: event.name || `Visit to ${place.name}`,
      startedAt: event.timestamp.toISOString(),
      endedAt: event.end?.toISOString(),
      gapSincePreviousVisitDays: events[index + 1]
        ? Math.max(0, Math.round((event.timestamp.getTime() - events[index + 1].timestamp.getTime()) / 86_400_000))
        : undefined,
      people: eventPeople,
      groups: [
        ...explicitGroups.map(group => ({ id: group.id, name: group.name, associationType: group.associationType })),
        ...inferredGroups.map(group => ({ id: group.id, name: group.name, associationType: "inferred" as const })),
        ...placeAffiliationGroups.map(row => ({ id: row.groupId, name: row.group.name, associationType: "place_affiliation" as const })),
      ],
      photoCount: eventPhotos.length,
      photos: eventPhotos,
      spendAmount: spendAmount || undefined,
      notePreview: eventNotes.get(event.id)?.slice(0, 140),
    } satisfies PlaceTimelineItem
  })

  const personSummaries = [...personEvents.entries()]
    .map(([personId, row]) => ({
      personId,
      name: row.name,
      sharedEventCount: row.eventIds.size,
      lastSharedEventAt: row.lastAt.toISOString(),
    }))
    .sort((a, b) => b.sharedEventCount - a.sharedEventCount || a.name.localeCompare(b.name))

  const groupIds = new Set<string>([
    ...affiliatedById.keys(),
    ...activityGroups.keys(),
  ])
  const stats = {
    visitCount: events.length,
    photoCount: photos.length,
    personCount: personSummaries.length,
    groupCount: groupIds.size,
    noteCount: place.notes.length,
    planCount: place.plans.length,
    firstVisitAt: events.length ? events[events.length - 1].timestamp.toISOString() : undefined,
    lastVisitAt: events[0]?.timestamp.toISOString(),
    // Includes both event-linked spend and spend resolved straight to this
    // Place with no Event (place.interactions, filtered to eventId: null at
    // the query level so nothing here double-counts sumEventSpend above).
    totalSpend: events.reduce((sum, event) => sum + sumEventSpend(event), 0) +
      (centsToDollars(place.interactions.reduce((sum, ix) => sum + (ix.amount ?? 0), 0)) ?? 0),
  }

  return {
    place,
    stats,
    timeline,
    people: personSummaries,
    groups: {
      affiliated,
      activity: [...activityGroups.values()].sort((a, b) => (b.eventCount ?? 0) - (a.eventCount ?? 0) || a.name.localeCompare(b.name)),
    },
    photos,
    notes: place.notes,
    plans: place.plans.map(plan => ({
      planId: plan.id,
      title: plan.text,
      plannedDate: plan.scheduledStart?.toISOString(),
    })),
  }
}

function fetchPlaceProfileRow(placeId: string, workspaceId: string) {
  return db.place.findFirst({
    where: { id: placeId, workspaceId },
    include: {
      notes: { where: { workspaceId }, orderBy: { createdAt: "desc" } },
      plans: {
        where: { workspaceId },
        select: { id: true, text: true, scheduledStart: true },
        orderBy: { scheduledStart: "asc" },
      },
      groupAffiliations: {
        where: { group: { workspaceId } },
        include: { group: { select: { id: true, name: true, groupType: true } } },
      },
      // Financial Interactions resolved straight to this Place (e.g. an Era
      // card transaction matched by merchant/location, never tied to a
      // calendar Event) — kept separate from `events` below so a bare
      // transaction is never counted as a "visit," only as spend.
      interactions: {
        where: { workspaceId, eventId: null },
        select: { id: true, amount: true },
      },
      events: {
        where: { workspaceId },
        include: {
          groupTags: { where: { workspaceId }, select: { id: true, name: true, groupType: true } },
          interactions: {
            where: { workspaceId },
            include: {
              person: { select: { id: true, first: true, last: true } },
              itemInteractions: {
                where: { item: { workspaceId } },
                include: {
                  item: { select: { id: true, name: true, category: true, tags: true } },
                },
              },
            },
          },
        },
        orderBy: { timestamp: "desc" },
      },
    },
  })
}

async function fetchWorkspaceGroups(workspaceId: string) {
  const result: GroupRow[] = []
  let cursor: string | undefined
  do {
    const rows = await fetchWorkspaceGroupPage(workspaceId, cursor)
    result.push(...rows)
    cursor = rows.length === 200 ? rows.at(-1)?.id : undefined
  } while (cursor)
  return result
}

function fetchWorkspaceGroupPage(workspaceId: string, cursor?: string) {
  return db.group.findMany({
    where: { workspaceId },
    include: {
      personMembers: {
        where: { OR: [{ endDate: null }, { endDate: { gt: new Date() } }] },
        select: { personId: true },
      },
    },
    orderBy: { id: "asc" },
    take: 200,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })
}

function peopleForEvent(event: EventRow) {
  const people = new Map<string, { id: string; name: string }>()
  for (const interaction of event.interactions) {
    if (!interaction.person) continue
    people.set(interaction.person.id, {
      id: interaction.person.id,
      name: `${interaction.person.first} ${interaction.person.last}`.trim(),
    })
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function inferGroupsForEvent(event: EventRow, workspaceGroups: GroupRow[]) {
  const participantIds = new Set(event.interactions.map(ix => ix.personId).filter(Boolean))
  return workspaceGroups.filter(group => {
    const memberIds = group.personMembers.map(member => member.personId)
    if (!memberIds.length) return false
    const participatingMembers = memberIds.filter(id => participantIds.has(id)).length
    return participatingMembers / memberIds.length >= 0.5
  })
}

function photosForEvent(event: EventRow) {
  const photos = new Map<string, { id: string; name: string }>()
  for (const interaction of event.interactions) {
    for (const itemInteraction of interaction.itemInteractions) {
      const item = itemInteraction.item
      if (isMediaItem(item)) photos.set(item.id, { id: item.id, name: item.name })
    }
  }
  return [...photos.values()]
}

function sumEventSpend(event: EventRow) {
  const cents = event.interactions.reduce((sum, interaction) => sum + (interaction.amount ?? 0), 0)
  return centsToDollars(cents) ?? 0
}

function affiliationToSummary(row: PlaceGroupRow): PlaceGroupSummary {
  return {
    groupId: row.groupId,
    name: row.group.name,
    groupType: row.group.groupType,
    relationshipType: row.relationshipType,
  }
}

function primaryFinancialGroup(affiliations: PlaceGroupRow[]) {
  const groupAffiliation = affiliations.find(row => row.relationshipType === "corporate_parent") ?? affiliations[0]
  if (!groupAffiliation) return undefined
  return {
    id: groupAffiliation.groupId,
    name: groupAffiliation.group.name,
    groupType: groupAffiliation.group.groupType,
    relationshipType: groupAffiliation.relationshipType,
  }
}

export function placeWeight(stats: Pick<PlaceStats, "visitCount" | "photoCount" | "personCount" | "groupCount" | "noteCount" | "planCount">) {
  return stats.visitCount * 3 +
    stats.photoCount +
    stats.personCount * 5 +
    stats.groupCount * 4 +
    stats.noteCount * 8 +
    stats.planCount * 6
}

export function parseCoordinates(raw: string | null | undefined): { latitude: number; longitude: number } | null {
  if (!raw) return null
  const text = raw.trim()
  if (!text) return null

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const latitude = numberFrom(parsed.latitude ?? parsed.lat)
    const longitude = numberFrom(parsed.longitude ?? parsed.lng ?? parsed.lon)
    return latitude === null || longitude === null ? null : { latitude, longitude }
  } catch {
    const [latRaw, lngRaw] = text.split(",").map(part => part.trim())
    const latitude = numberFrom(latRaw)
    const longitude = numberFrom(lngRaw)
    return latitude === null || longitude === null ? null : { latitude, longitude }
  }
}

export function isMediaItem(item: { name?: string | null; category?: string | null; tags?: string | null }) {
  const haystack = [item.name, item.category, item.tags].filter(Boolean).join(" ").toLowerCase()
  return /\b(photo|photos|image|images|media|video|jpeg|jpg|png|heic|mov|mp4)\b/.test(haystack)
}

function numberFrom(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

async function assertPlace(placeId: string, workspaceId: string) {
  const place = await db.place.findFirst({ where: { id: placeId, workspaceId } })
  if (!place) throw notFound("Place not found", { placeId })
  return place
}

async function assertPlaceEvent(placeId: string, eventId: string, workspaceId: string) {
  const event = await db.event.findFirst({ where: { id: eventId, workspaceId } })
  if (!event) throw notFound("Event not found", { eventId })
  if (event.placeId !== placeId) throw badRequest("Event does not belong to this place", { placeId, eventId })
  return event
}
