import { NextResponse } from 'next/server'
import { db } from '@life-os/db'
import {
  AcceptStagedInteractionError,
  acceptStagedInteraction,
  reconcileCalendarPlan,
  resolveVisitGroup,
  reviewNoteSuggestion,
} from '@life-os/domain'
import { workspaceForHomeRequest } from '@/lib/request-access'
import { reviewApiTarget } from '../../review-items/route'

/**
 * One resolver for a mixed batch of inbox rows.
 *
 * The inbox federates six queues that each had their own resolver and their own
 * request shape, so the UI could only ever action the one canonical queue —
 * everything else rendered as a row with no buttons. This dispatches per row,
 * which is what lets a selection spanning calendar plans, communications, note
 * suggestions and file claims be cleared with one keystroke.
 *
 *   POST /api/inbox/resolve
 *   { "action": "accept", "items": [{ "id": "...", "sourceKey": "calendar_reconciliation" }] }
 */

const MAX_ITEMS = 200
const CONCURRENCY = 6

type Verb = 'accept' | 'dismiss' | 'cancelled'

type BatchItem = { id: string; sourceKey: string; canonical?: boolean; personId?: string }

type Outcome = { id: string; ok: boolean; error?: string }

export async function POST(request: Request) {
  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as
    | { action?: unknown; items?: unknown; personId?: unknown; reason?: unknown }
    | null

  const action = body?.action
  if (action !== 'accept' && action !== 'dismiss' && action !== 'cancelled') {
    return NextResponse.json({ error: 'Action must be accept, dismiss, or cancelled' }, { status: 400 })
  }

  const items = parseItems(body?.items)
  if (!items.length) return NextResponse.json({ error: 'Choose at least one item' }, { status: 400 })
  if (items.length > MAX_ITEMS) {
    return NextResponse.json({ error: `Send no more than ${MAX_ITEMS} items per request` }, { status: 400 })
  }

  const personId = typeof body?.personId === 'string' && body.personId.trim() ? body.personId.trim() : undefined
  const reason = typeof body?.reason === 'string' ? body.reason : 'Resolved from the inbox'

  // Visits are answered per place, never per visit — 154 rows at one address are
  // one decision, and running them individually would create the Place 154 times.
  const visits = items.filter(item => item.sourceKey === 'import_staged_visit')
  const rest = items.filter(item => item.sourceKey !== 'import_staged_visit')

  const outcomes: Outcome[] = []
  if (visits.length) outcomes.push(...await resolveVisits(visits, action, workspaceId))
  outcomes.push(...await pooled(rest, CONCURRENCY, item =>
    resolveOne(item, action, workspaceId, personId, reason)))

  const processed = outcomes.filter(outcome => outcome.ok).length
  return NextResponse.json({
    processed,
    failed: outcomes.length - processed,
    results: outcomes,
  })
}

async function resolveOne(
  item: BatchItem,
  action: Verb,
  workspaceId: string,
  personId: string | undefined,
  reason: string,
): Promise<Outcome> {
  try {
    if (item.canonical) return await resolveCanonical(item.id, action, workspaceId)

    switch (item.sourceKey) {
      case 'calendar_reconciliation':
        // "Dismiss" on a calendar plan is not "this was cancelled" — it is
        // "stop asking", which is what skip records. Cancelling is its own verb.
        await reconcileCalendarPlan({
          workspaceId,
          planId: item.id,
          action: action === 'accept' ? 'happened' : action === 'cancelled' ? 'cancelled' : 'skip',
        })
        return { id: item.id, ok: true }

      case 'note_suggestion':
        await reviewNoteSuggestion({
          workspaceId,
          suggestionId: item.id,
          action: action === 'accept' ? 'accept' : 'dismiss',
        })
        return { id: item.id, ok: true }

      case 'staged_interaction':
        return await resolveStagedInteraction(item, action, workspaceId, personId ?? item.personId)

      case 'file_evidence':
        return await resolveFileEvidence(item.id, action, workspaceId, reason)

      default:
        return { id: item.id, ok: false, error: 'This item has no resolver yet' }
    }
  } catch (error) {
    return { id: item.id, ok: false, error: messageFor(error) }
  }
}

/** Canonical rows stay behind the shared review service, which owns their audit trail. */
async function resolveCanonical(id: string, action: Verb, workspaceId: string): Promise<Outcome> {
  const target = reviewApiTarget(`/v1/review-items/${encodeURIComponent(id)}`)
  const apiKey = process.env.PERSONS_API_KEY?.trim()
  if (!target || !apiKey) return { id, ok: false, error: 'The shared review service is not configured yet.' }

  const response = await fetch(target, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'x-workspace-override': workspaceId,
    },
    cache: 'no-store',
    body: JSON.stringify({ action: action === 'accept' ? 'accept' : 'dismiss' }),
  })
  if (response.ok) return { id, ok: true }
  const failure = await response.json().catch(() => null) as { error?: string } | null
  return { id, ok: false, error: failure?.error || 'The shared review service rejected this item.' }
}

async function resolveStagedInteraction(
  item: BatchItem,
  action: Verb,
  workspaceId: string,
  personId: string | undefined,
): Promise<Outcome> {
  const staged = await db.stagedInteraction.findFirst({
    where: {
      id: item.id,
      workspaceId,
      status: { in: ['pending', 'blocked'] },
      source: { in: ['imessage', 'gmail', 'whatsapp'] },
      type: { not: 'financial' },
    },
    select: { id: true, candidatePersonId: true },
  })
  if (!staged) return { id: item.id, ok: false, error: 'Already reviewed' }

  if (action === 'accept') {
    const target = personId ?? staged.candidatePersonId
    if (!target) return { id: item.id, ok: false, error: 'Choose a person to file this under' }
    try {
      await acceptStagedInteraction({ id: staged.id, workspaceId, personId: target })
    } catch (error) {
      return {
        id: item.id,
        ok: false,
        error: error instanceof AcceptStagedInteractionError ? error.message : 'Could not accept this communication',
      }
    }
    return { id: item.id, ok: true }
  }

  await db.$transaction([
    db.stagedInteraction.update({ where: { id: staged.id }, data: { status: 'dismissed' } }),
    db.auditLog.create({
      data: {
        workspaceId,
        action: 'inbox.dismiss',
        targetType: 'stagedInteraction',
        targetId: staged.id,
        actorType: 'user',
        actorLabel: 'Home',
      },
    }),
  ])
  return { id: item.id, ok: true }
}

/**
 * File evidence covers two records that share one queue. Which one an id names
 * is read from the database rather than taken from the client, so a mislabelled
 * row cannot steer a write at the wrong table.
 */
async function resolveFileEvidence(id: string, action: Verb, workspaceId: string, reason: string): Promise<Outcome> {
  const claim = await db.evidenceClaim.findFirst({ where: { id, workspaceId }, select: { id: true } })
  if (claim) {
    await db.evidenceClaim.update({
      where: { id: claim.id },
      data: { status: action === 'accept' ? 'accepted' : 'dismissed', reviewedAt: new Date() },
    })
    return { id, ok: true }
  }

  const mention = await db.fileEntityMention.findFirst({ where: { id, workspaceId }, select: { id: true, resolvedPersonId: true } })
  if (!mention) return { id, ok: false, error: 'Already reviewed' }
  // Accepting an identity means naming the Person, which this batch endpoint
  // has no way to know. Only the dismissal is expressible here.
  if (action === 'accept') return { id, ok: false, error: 'Pick the person this refers to' }

  await db.$transaction(async transaction => {
    await transaction.fileEntityMention.update({
      where: { id: mention.id },
      data: {
        resolvedPersonId: null,
        resolvedEntityId: null,
        resolutionStatus: 'dismissed',
        resolutionReason: reason,
        resolutionUpdatedAt: new Date(),
      },
    })
    await transaction.fileEntityResolution.create({
      data: {
        workspaceId,
        mentionId: mention.id,
        fromPersonId: mention.resolvedPersonId,
        action: 'dismissed',
        reason,
      },
    })
  })
  return { id, ok: true }
}

/** Collapses the selected visits down to the places they describe, then answers per place. */
async function resolveVisits(items: BatchItem[], action: Verb, workspaceId: string): Promise<Outcome[]> {
  const visits = await db.importStagedVisit.findMany({
    where: { id: { in: items.map(item => item.id) }, workspaceId, status: 'pending' },
    select: { id: true, googlePlaceId: true, placeName: true, placeAddress: true },
  })

  const byPlace = new Map<string, typeof visits>()
  for (const visit of visits) {
    const key = visit.googlePlaceId ?? `${visit.placeName ?? ''}|${visit.placeAddress ?? ''}`
    byPlace.set(key, [...(byPlace.get(key) ?? []), visit])
  }

  const outcomes: Outcome[] = []
  const seen = new Set(visits.map(visit => visit.id))
  for (const item of items) {
    if (!seen.has(item.id)) outcomes.push({ id: item.id, ok: false, error: 'Already reviewed' })
  }

  for (const group of byPlace.values()) {
    const [first] = group
    try {
      await resolveVisitGroup({
        workspaceId,
        action: action === 'accept' ? 'accept' : 'dismiss',
        selector: first.googlePlaceId
          ? { googlePlaceId: first.googlePlaceId }
          : { placeName: first.placeName, placeAddress: first.placeAddress },
      })
      for (const visit of group) outcomes.push({ id: visit.id, ok: true })
    } catch (error) {
      const message = messageFor(error)
      for (const visit of group) outcomes.push({ id: visit.id, ok: false, error: message })
    }
  }
  return outcomes
}

/**
 * Bounded fan-out. Accepting 200 rows is 200 real domain commands with 200 audit
 * trails; running them all at once exhausts the connection pool, and running them
 * one at a time turns a bulk action into a timeout.
 */
async function pooled<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await run(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

function parseItems(value: unknown): BatchItem[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const items: BatchItem[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const { id, sourceKey, canonical, personId } = entry as Record<string, unknown>
    if (typeof id !== 'string' || !id || typeof sourceKey !== 'string') continue
    const key = `${sourceKey}:${canonical ? 'c' : 'l'}:${id}`
    if (seen.has(key)) continue
    seen.add(key)
    items.push({
      id,
      sourceKey,
      canonical: canonical === true,
      personId: typeof personId === 'string' && personId.trim() ? personId.trim() : undefined,
    })
  }
  return items
}

function messageFor(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  return 'Could not resolve this item'
}
