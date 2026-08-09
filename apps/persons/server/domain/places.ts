import { db } from "@/lib/db"
import { centsToDollars } from "@life-os/db"
import { badRequest, notFound } from "@/server/api/errors"
import type { DomainActor } from "./audit"
import { runRulesForTarget } from "./rules"
import {
  createPlaceNote as sharedCreatePlaceNote,
  updatePlaceNote as sharedUpdatePlaceNote,
  deletePlaceNote as sharedDeletePlaceNote,
  togglePlaceFavorite as sharedTogglePlaceFavorite,
  PlaceNoteError,
} from "@life-os/domain"

// Write operations (PlaceNote CRUD, favorite toggle) moved to
// @life-os/domain/place-notes.ts (Track C, phase C4) — same shim pattern
// as persons.ts/plans.ts/events.ts. Everything else in this file (map/
// profile reads, timeline derivation) is unchanged. Fires new
// place.note.create/place.favorite.toggle triggers (packages/domain never
// depends on packages/automation).
function translatePlaceNoteError<T>(promise: Promise<T>): Promise<T> {
  return promise.catch(error => {
    if (error instanceof PlaceNoteError) throw error.code === "not_found" ? notFound(error.message) : badRequest(error.message)
    throw error
  })
}

export async function createPlaceNote(
  placeId: string,
  workspaceId: string | null | undefined,
  body: unknown,
  opts: { eventId?: unknown; actor?: DomainActor } = {},
) {
  const note = await translatePlaceNoteError(sharedCreatePlaceNote(placeId, workspaceId, body, opts))
  await runRulesForTarget({
    trigger: "place.note.create",
    targetType: "place",
    targetId: placeId,
    payload: { placeId, noteId: note.id },
    actor: opts.actor,
  })
  return note
}

export function updatePlaceNote(noteId: string, workspaceId: string | null | undefined, body: unknown, actor?: DomainActor) {
  return translatePlaceNoteError(sharedUpdatePlaceNote(noteId, workspaceId, body, actor))
}

export function deletePlaceNote(noteId: string, workspaceId: string | null | undefined, actor?: DomainActor) {
  return translatePlaceNoteError(sharedDeletePlaceNote(noteId, workspaceId, actor))
}

export async function togglePlaceFavorite(placeId: string, workspaceId: string | null | undefined, actor?: DomainActor) {
  const updated = await translatePlaceNoteError(sharedTogglePlaceFavorite(placeId, workspaceId, actor))
  await runRulesForTarget({
    trigger: "place.favorite.toggle",
    targetType: "place",
    targetId: placeId,
    payload: { placeId, favorite: updated.favorite },
    actor,
  })
  return updated
}

type PlaceRow = Awaited<ReturnType<typeof fetchPlaceProfileRow>>
type EventRow = NonNullable<PlaceRow>["events"][number]
type GroupRow = Awaited<ReturnType<typeof fetchWorkspaceGroups>>[number]
type PlaceGroupRow = NonNullable<PlaceRow>["groupAffiliations"][number]

export type PlaceMapItem = {
  id: string
  name: string
  latitude?: number
  longitude?: number
  address?: string
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
  people: { id: string; name: string }[]
  groups: { id: string; name: string; associationType: "explicit_tag" | "inferred" | "place_affiliation" }[]
  photoCount: number
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
    db.place.findMany({
      where: { workspaceId: wsId },
      include: {
        notes: { where: { workspaceId: wsId } },
        groupAffiliations: {
          where: { group: { workspaceId: wsId } },
          include: { group: { select: { id: true, name: true, groupType: true } } },
        },
        events: {
          where: { workspaceId: wsId },
          include: {
            groupTags: { where: { workspaceId: wsId }, select: { id: true, name: true, groupType: true } },
            interactions: {
              where: { workspaceId: wsId },
              include: {
                person: { select: { id: true, first: true, last: true } },
                itemInteractions: {
                  where: { item: { workspaceId: wsId } },
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
      orderBy: { name: "asc" },
    }),
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
        lastVisitAt: derived.stats.lastVisitAt,
      },
      weight: placeWeight(derived.stats),
      financialGroup: primaryFinancialGroup(place.groupAffiliations),
    }
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

  const timeline = events.map(event => {
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
      people: eventPeople,
      groups: [
        ...explicitGroups.map(group => ({ id: group.id, name: group.name, associationType: group.associationType })),
        ...inferredGroups.map(group => ({ id: group.id, name: group.name, associationType: "inferred" as const })),
        ...placeAffiliationGroups.map(row => ({ id: row.groupId, name: row.group.name, associationType: "place_affiliation" as const })),
      ],
      photoCount: eventPhotos.length,
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
    planCount: 0,
    firstVisitAt: events.length ? events[events.length - 1].timestamp.toISOString() : undefined,
    lastVisitAt: events[0]?.timestamp.toISOString(),
    totalSpend: events.reduce((sum, event) => sum + sumEventSpend(event), 0),
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
    plans: [],
  }
}

function fetchPlaceProfileRow(placeId: string, workspaceId: string) {
  return db.place.findFirst({
    where: { id: placeId, workspaceId },
    include: {
      notes: { where: { workspaceId }, orderBy: { createdAt: "desc" } },
      groupAffiliations: {
        where: { group: { workspaceId } },
        include: { group: { select: { id: true, name: true, groupType: true } } },
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

function fetchWorkspaceGroups(workspaceId: string) {
  return db.group.findMany({
    where: { workspaceId },
    include: {
      personMembers: {
        where: { OR: [{ endDate: null }, { endDate: { gt: new Date() } }] },
        select: { personId: true },
      },
    },
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
