import { writeAuditLog, type AuditActor } from "./audit"
import { publishGraphEvent, type GraphEventActor } from "./events"

type Actor = GraphEventActor & AuditActor

/**
 * Staged visits are a place question wearing a visit's clothes.
 *
 * Production asks 165 of them. They describe **three** places — 154 are one
 * address the phone sees every day, because it is home. Answering "is this
 * Red Rock Villas?" 154 times is not triage, it is the same answer typed
 * repeatedly, and no interface makes that pleasant (docs/INBOX_TRIAGE_ANALYSIS.md).
 *
 * So the unit of decision here is the place, not the visit. Resolve a place once
 * and every pending visit at it resolves with it — and because a Place carries
 * the googlePlaceId, the importer's own matching (upsertPlace) sends every
 * future visit there without asking again. The learning is a side effect of
 * answering once, not a separate rules feature.
 */

// A visit belongs to a group by the strongest identity it has. googlePlaceId is
// exact and survives a renamed or re-geocoded place; name+address is the
// fallback for rows that predate it.
export type VisitGroupSelector = {
  googlePlaceId?: string | null
  placeName?: string | null
  placeAddress?: string | null
}

export type ResolveVisitGroupResult = {
  matched: number
  resolved: number
  placeId: string | null
  eventsCreated: number
  duplicatesSkipped: number
  remaining: number
}

export class StagedVisitError extends Error {
  constructor(message: string, readonly code: "validation" | "not_found") {
    super(message)
    this.name = "StagedVisitError"
  }
}

// One call should finish the queue it was aimed at — 154 visits is the real
// case — while still bounding a single request. Anything above this reports
// `remaining` so the caller can repeat rather than silently doing half the job.
const MAX_VISITS_PER_CALL = 400
const DUPLICATE_WINDOW_MS = 2 * 60 * 60 * 1000
const NEARBY_METERS = 50

function selectorWhere(selector: VisitGroupSelector) {
  const googlePlaceId = selector.googlePlaceId?.trim()
  if (googlePlaceId) return { googlePlaceId }

  const placeName = selector.placeName?.trim()
  const placeAddress = selector.placeAddress?.trim()
  if (!placeName && !placeAddress) {
    throw new StagedVisitError("A visit group needs a googlePlaceId, a place name, or an address", "validation")
  }
  return {
    placeName: placeName ?? null,
    placeAddress: placeAddress ?? null,
  }
}

/**
 * Accept or reject every pending visit at one place.
 *
 * Accepting creates the Place if it is new, then one Event per visit — a visit
 * that happened 154 times is 154 events, that part is not duplication — while
 * skipping any Event already recorded within two hours of the same visit, which
 * is what makes re-running this safe.
 */
export async function resolveVisitGroup(input: {
  selector: VisitGroupSelector
  action: "accept" | "dismiss"
  workspaceId?: string
  actor?: Actor
}): Promise<ResolveVisitGroupResult> {
  const { db } = await import("@life-os/db")
  const workspaceId = input.workspaceId ?? "default-workspace"
  const where = { workspaceId, status: "pending" as const, ...selectorWhere(input.selector) }

  const matched = await db.importStagedVisit.count({ where })
  if (matched === 0) throw new StagedVisitError("No pending visits match this place", "not_found")

  const visits = await db.importStagedVisit.findMany({
    where,
    orderBy: { startedAt: "asc" },
    take: MAX_VISITS_PER_CALL,
  })

  if (input.action === "dismiss") {
    await db.importStagedVisit.updateMany({ where: { id: { in: visits.map(v => v.id) } }, data: { status: "rejected" } })
    await writeAuditLog({
      actor: input.actor,
      action: "places.visit_group.dismiss",
      targetType: "importStagedVisit",
      targetId: visits[0].id,
      metadata: { count: visits.length, placeName: visits[0].placeName, googlePlaceId: visits[0].googlePlaceId },
    })
    return { matched, resolved: visits.length, placeId: null, eventsCreated: 0, duplicatesSkipped: 0, remaining: matched - visits.length }
  }

  const place = await upsertPlaceForVisits(db, workspaceId, visits, input.actor)

  // Every Event already at this place, read once. The per-visit duplicate check
  // used to be a query each; at 154 visits that is 154 round-trips before a
  // single write, which is how a bulk action becomes a timeout.
  const existing = await db.event.findMany({
    where: { workspaceId, placeId: place.id },
    select: { id: true, timestamp: true },
  })
  const timeline = existing
    .filter(event => event.timestamp)
    .map(event => ({ id: event.id, at: event.timestamp!.getTime() }))

  let eventsCreated = 0
  let duplicatesSkipped = 0

  for (const visit of visits) {
    const at = visit.startedAt.getTime()
    const duplicate = timeline.find(entry => Math.abs(entry.at - at) <= DUPLICATE_WINDOW_MS)
    let eventId = duplicate?.id ?? null

    if (duplicate) {
      duplicatesSkipped += 1
    } else {
      const event = await db.event.create({
        data: {
          workspaceId,
          placeId: place.id,
          name: `Visit: ${place.name}`,
          type: "visit",
          start: visit.startedAt,
          end: visit.endedAt,
          timestamp: visit.startedAt,
          notes: visit.placeAddress ? `Imported visit. ${visit.placeAddress}` : "Imported visit.",
          metadata: JSON.stringify({
            source: "staged_visit_group",
            googlePlaceId: visit.googlePlaceId,
            confidence: visit.confidence,
            stagedVisitId: visit.id,
          }),
        },
      })
      eventId = event.id
      eventsCreated += 1
      // Added to the in-memory timeline so two staged visits an hour apart do
      // not both create an Event for what is one stay.
      timeline.push({ id: event.id, at })
    }

    await db.importStagedVisit.update({
      where: { id: visit.id },
      data: { status: "accepted", resolvedPlaceId: place.id, resolvedEventId: eventId },
    })
  }

  await db.$transaction(tx => publishGraphEvent(tx, {
    workspaceId,
    subjectType: "Place",
    subjectId: place.id,
    eventType: "place.visits_resolved",
    actor: input.actor,
    idempotencyKey: `visit-group:${place.id}:${visits[0].id}:${visits.length}`,
    payload: { visits: visits.length, eventsCreated, duplicatesSkipped, googlePlaceId: place.googlePlaceId },
  }))

  await writeAuditLog({
    actor: input.actor,
    action: "places.visit_group.accept",
    targetType: "place",
    targetId: place.id,
    metadata: { visits: visits.length, eventsCreated, duplicatesSkipped },
  })

  return { matched, resolved: visits.length, placeId: place.id, eventsCreated, duplicatesSkipped, remaining: matched - visits.length }
}

/**
 * Find the Place these visits belong to, or create it.
 *
 * Mirrors apps/places' upsertPlace: googlePlaceId is authoritative, then a
 * same-name place within 50m, then create. Matching on googlePlaceId first is
 * also what makes answering once stick — the importer takes the same path on
 * the next import and never stages these visits again.
 */
async function upsertPlaceForVisits(
  db: Awaited<typeof import("@life-os/db")>["db"],
  workspaceId: string,
  visits: Array<{ placeName: string | null; placeAddress: string | null; latitude: number | null; longitude: number | null; googlePlaceId: string | null }>,
  actor?: Actor,
) {
  const sample = visits.find(v => v.googlePlaceId) ?? visits.find(v => v.placeName) ?? visits[0]
  const googlePlaceId = sample.googlePlaceId
  const placeName = sample.placeName?.trim() || visits.find(v => v.placeName)?.placeName?.trim() || null
  const placeAddress = sample.placeAddress?.trim() || visits.find(v => v.placeAddress)?.placeAddress?.trim() || null
  const latitude = sample.latitude ?? visits.find(v => v.latitude != null)?.latitude ?? null
  const longitude = sample.longitude ?? visits.find(v => v.longitude != null)?.longitude ?? null

  if (googlePlaceId) {
    const existing = await db.place.findFirst({ where: { workspaceId, googlePlaceId } })
    if (existing) return existing
  }

  if (placeName && latitude != null && longitude != null) {
    const candidates = await db.place.findMany({ where: { workspaceId }, take: 500 })
    const nearby = candidates.find(candidate => {
      const coords = coordinatesFromString(candidate.coordinates)
      if (!coords) return false
      return namesSimilar(candidate.name, placeName)
        && distanceMeters(coords.latitude, coords.longitude, latitude, longitude) <= NEARBY_METERS
    })
    if (nearby) {
      return db.place.update({
        where: { id: nearby.id },
        data: {
          googlePlaceId: nearby.googlePlaceId ?? googlePlaceId ?? undefined,
          address: nearby.address ?? placeAddress ?? undefined,
        },
      })
    }
  }

  const created = await db.place.create({
    data: {
      workspaceId,
      name: placeName || "Unnamed place",
      googlePlaceId,
      type: "visited_place",
      address: placeAddress,
      coordinates: latitude != null && longitude != null ? JSON.stringify({ latitude, longitude }) : undefined,
      meaning: placeName ? undefined : "Created from imported visits without a name. Review and rename this place.",
    },
  })
  await db.$transaction(tx => publishGraphEvent(tx, {
    workspaceId,
    subjectType: "Place",
    subjectId: created.id,
    eventType: "place.create",
    actor,
    idempotencyKey: `place-create:${created.id}`,
    payload: { name: created.name, googlePlaceId: created.googlePlaceId },
  }))
  return created
}

function coordinatesFromString(raw: string | null) {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const latitude = Number(parsed.latitude ?? parsed.lat)
    const longitude = Number(parsed.longitude ?? parsed.lng ?? parsed.lon)
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null
  } catch {
    return null
  }
}

function namesSimilar(a: string, b: string) {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  return normalize(a) === normalize(b)
}

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radius = 6_371_000
  const toRad = (value: number) => value * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
