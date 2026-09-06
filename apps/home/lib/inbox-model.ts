/**
 * The inbox model, kept out of the component so the decisions it encodes —
 * what is actionable, what groups with what, what a keystroke selects — are
 * testable without rendering anything.
 */

import { unitConfidence } from './confidence'

export type InboxSourceKey =
  | 'staged_interaction'
  | 'note_suggestion'
  | 'import_staged_visit'
  | 'calendar_reconciliation'
  | 'file_evidence'
  | 'communication_occurrence'

export type InboxItem = {
  id: string
  source: string
  sourceKey: InboxSourceKey
  primitive: string
  title: string
  detail: string
  timestamp: string
  confidence: number | null
  priority: number
  // Governs whether a group may be cleared in one action. Review and confirm
  // tier items are excluded by the API on purpose, so the UI must not offer it.
  // Optional because the legacy read-only queues carry neither — absent means
  // not bulkable, which is the safe default.
  riskTier?: string
  itemType?: string
  canonical?: boolean
  // Present on staged place visits. The decision they need is about the place,
  // not the individual visit, so the place has to travel with the row.
  place?: {
    googlePlaceId: string | null
    name: string | null
    address: string | null
    latitude: number | null
    longitude: number | null
  }
  // A staged communication accepts against a Person. When the importer already
  // guessed one the row can be accepted in a keystroke; without one it needs a
  // person picked first, and the button has to say so instead of failing.
  candidatePersonId?: string | null
  candidatePersonName?: string | null
  // On a canonical row, the id of the legacy record it was staged from. It is
  // what lets the two sets be merged without showing the same decision twice.
  sourceId?: string
}

/** The verbs a row can be resolved with. `cancelled` only exists for calendar plans. */
export type InboxVerb = 'accept' | 'dismiss' | 'cancelled'

export type ReviewItemPayload = {
  id: string
  source: string
  sourceId: string
  itemType: string
  riskTier: string
  proposedCommand: { command: string; input: Record<string, unknown> }
  confidence: number | null
  priority: number
  createdAt: string
  evidence: unknown
}

/** Stable across the two id spaces — a legacy row and a canonical row can share an id. */
export function rowKey(item: InboxItem) {
  return `${item.sourceKey}:${item.id}`
}

/* ------------------------------------------------------------------ *
 * What can actually be done to a row
 * ------------------------------------------------------------------ */

/**
 * Every legacy queue in this inbox already has a resolver behind it — calendar
 * plans reconcile, note suggestions review, communications accept against a
 * Person, visits resolve per place, claims accept. The inbox simply never
 * called them, which is why 1,290 items sat under "Needs individual review"
 * with nothing to click. These two functions are the whole capability map.
 */
export function canAccept(item: InboxItem): boolean {
  if (item.canonical) return true
  switch (item.sourceKey) {
    case 'calendar_reconciliation':
    case 'note_suggestion':
    case 'import_staged_visit':
      return true
    // Accepting files the message under a Person. With no candidate there is
    // nothing to file it under, so the row asks for one instead of guessing.
    case 'staged_interaction':
      return Boolean(item.candidatePersonId)
    // An unresolved identity needs a Person chosen; a claim only needs a yes.
    case 'file_evidence':
      return item.primitive !== 'identity'
    default:
      return false
  }
}

export function canDismiss(item: InboxItem): boolean {
  if (item.canonical) return true
  return item.sourceKey !== 'communication_occurrence'
}

export function isActionable(item: InboxItem): boolean {
  return canAccept(item) || canDismiss(item)
}

/** Calendar is the only queue whose middle answer is a real third outcome. */
export function canCancel(item: InboxItem): boolean {
  return item.sourceKey === 'calendar_reconciliation' && !item.canonical
}

// "Accept"/"Dismiss" are the right words for a proposed command, and the wrong
// ones for "did this happen?" — the button should name the outcome it writes.
export function acceptLabel(item: InboxItem) {
  if (item.sourceKey === 'communication_occurrence') return 'Confirm event'
  if (item.sourceKey === 'calendar_reconciliation') return 'Happened'
  if (item.sourceKey === 'import_staged_visit') return 'This is the place'
  if (item.sourceKey === 'staged_interaction' && item.candidatePersonName) {
    return `Accept → ${item.candidatePersonName}`
  }
  return 'Accept'
}

export function dismissLabel(item: InboxItem) {
  if (item.sourceKey === 'communication_occurrence') return 'Not an event'
  if (item.sourceKey === 'calendar_reconciliation') return 'Skip'
  if (item.sourceKey === 'import_staged_visit') return 'Not a place'
  return 'Dismiss'
}

/** Why an un-actionable row is un-actionable, so it is never a silent dead end. */
export function blockedReason(item: InboxItem): string | null {
  if (canAccept(item)) return null
  if (item.sourceKey === 'staged_interaction') return 'Pick a person to file this under'
  if (item.sourceKey === 'file_evidence' && item.primitive === 'identity') return 'Pick the person this refers to'
  return null
}

/* ------------------------------------------------------------------ *
 * Filtering
 * ------------------------------------------------------------------ */

export type InboxFilters = {
  source: string
  primitive: string
  confidence: string
  age: string
  query: string
  actionable: boolean
}

export const EMPTY_FILTERS: InboxFilters = {
  source: 'all',
  primitive: 'all',
  confidence: 'all',
  age: 'all',
  query: '',
  actionable: false,
}

/**
 * Tokenised AND over the text a row actually shows. Deliberately not fuzzy:
 * in a queue of 1,490 near-identical titles, a fuzzy match returns everything
 * and a substring match returns the four you meant.
 */
export function matchesQuery(item: InboxItem, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!tokens.length) return true
  const haystack = `${item.title} ${item.detail} ${item.source} ${item.primitive}`.toLowerCase()
  return tokens.every(token => haystack.includes(token))
}

export function filterItems(items: InboxItem[], filters: InboxFilters, now = Date.now()): InboxItem[] {
  return items.filter(item => {
    if (filters.source !== 'all' && item.sourceKey !== filters.source) return false
    if (filters.primitive !== 'all' && item.primitive !== filters.primitive) return false
    if (filters.confidence === 'high' && (item.confidence == null || item.confidence < 0.8)) return false
    if (filters.confidence === 'medium' && (item.confidence == null || item.confidence < 0.5 || item.confidence >= 0.8)) return false
    if (filters.confidence === 'low' && (item.confidence == null || item.confidence >= 0.5)) return false
    if (filters.age !== 'all') {
      const days = Number(filters.age)
      if (now - new Date(item.timestamp).getTime() < days * 86_400_000) return false
    }
    if (filters.actionable && !isActionable(item)) return false
    if (!matchesQuery(item, filters.query)) return false
    return true
  })
}

/* ------------------------------------------------------------------ *
 * Grouping
 * ------------------------------------------------------------------ */

export type InboxGroup = {
  key: string
  label: string
  items: InboxItem[]
  place?: InboxItem['place']
  /** Every item in the group can take the verb, so the header can offer it once. */
  acceptable: boolean
  dismissable: boolean
  /** True when the group contains anything the API considers individual-judgment work. */
  needsConfirmation: boolean
}

/**
 * Group by the question being asked, not by source. 500 items sharing one
 * command shape are one decision, and presenting them as 500 rows is what made
 * the queue unclearable.
 *
 * Place visits group tighter still: by place. 268 pending visits describe a
 * handful of places. The decision is "is this Red Rock Villas?", asked once —
 * not "was I there on the 4th?", asked 154 times.
 */
export function placeKey(item: InboxItem): string | null {
  if (!item.place) return null
  return item.place.googlePlaceId ?? `${item.place.name ?? ''}|${item.place.address ?? ''}`
}

/**
 * A visit is never resolved alone: the resolver answers per place, so accepting
 * one row at an address clears every pending visit there. The list has to leave
 * with it, or 153 rows stay on screen describing work the server already did.
 */
export function expandPlaceGroups(items: InboxItem[], universe: InboxItem[]): InboxItem[] {
  const places = new Set(items.map(placeKey).filter((key): key is string => key !== null))
  if (!places.size) return items
  const seen = new Set(items.map(rowKey))
  const expanded = [...items]
  for (const candidate of universe) {
    const key = placeKey(candidate)
    if (key && places.has(key) && !seen.has(rowKey(candidate))) {
      seen.add(rowKey(candidate))
      expanded.push(candidate)
    }
  }
  return expanded
}

export function groupItems(items: InboxItem[]): InboxGroup[] {
  const byKey = new Map<string, InboxItem[]>()
  for (const item of items) {
    // Grouped on the visible source too: iMessage and Email are both
    // staged_interaction, and folding them together labels 500 emails "iMessage"
    // and offers one button over two different decisions.
    const key = item.place
      ? `place:${placeKey(item)}`
      : `${item.sourceKey}:${item.source}:${item.itemType ?? item.primitive ?? 'item'}`
    const bucket = byKey.get(key) ?? []
    bucket.push(item)
    byKey.set(key, bucket)
  }
  return [...byKey.entries()]
    .map(([key, groupItems]) => ({
      key,
      items: groupItems,
      place: groupItems[0].place,
      // `source` already carries the display label on both sides of the merge,
      // so re-labelling it turned "iMessage" into "IMessage".
      label: groupItems[0].place
        ? groupItems[0].place.name || groupItems[0].place.address || 'Unnamed place'
        : groupItems[0].source,
      acceptable: groupItems.every(canAccept),
      dismissable: groupItems.every(canDismiss),
      // A place group is one decision by construction, so it never needs the
      // "are you sure" step no matter how many visits it covers.
      needsConfirmation: !groupItems[0].place && groupItems.some(needsIndividualJudgment),
    }))
    .sort((a, b) => b.items.length - a.items.length)
}

/**
 * Risk tiers exist so a sweep cannot quietly clear work that wanted a human
 * look. We do not refuse those here — the operator selected the rows and can
 * see them — but a sweep over them asks once before it runs.
 */
export function needsIndividualJudgment(item: InboxItem): boolean {
  const tier = item.riskTier ?? 'review'
  return tier !== 'observe' && tier !== 'safe_auto'
}

export function confirmationCount(items: InboxItem[]): number {
  return items.filter(needsIndividualJudgment).length
}

/* ------------------------------------------------------------------ *
 * Selection
 * ------------------------------------------------------------------ */

/** Shift-click and Shift+J/K both resolve to "every row between these two". */
export function rangeKeys(rows: InboxItem[], anchorKey: string | null, targetKey: string): string[] {
  const target = rows.findIndex(row => rowKey(row) === targetKey)
  if (target < 0) return []
  const anchor = anchorKey ? rows.findIndex(row => rowKey(row) === anchorKey) : -1
  if (anchor < 0) return [targetKey]
  const [from, to] = anchor <= target ? [anchor, target] : [target, anchor]
  return rows.slice(from, to + 1).map(rowKey)
}

/* ------------------------------------------------------------------ *
 * Snooze
 * ------------------------------------------------------------------ */

export type SnoozeMap = Record<string, string>

export const SNOOZE_PRESETS = [
  ['later', 'Later today', 3 * 3_600_000],
  ['tomorrow', 'Tomorrow', 24 * 3_600_000],
  ['week', 'Next week', 7 * 24 * 3_600_000],
] as const

export function snoozeUntil(preset: string, now = Date.now()): string {
  const match = SNOOZE_PRESETS.find(([key]) => key === preset) ?? SNOOZE_PRESETS[1]
  return new Date(now + match[2]).toISOString()
}

/** Expired entries are dropped on read, so a snooze never has to be cleaned up. */
export function activeSnoozes(map: SnoozeMap, now = Date.now()): SnoozeMap {
  const active: SnoozeMap = {}
  for (const [key, until] of Object.entries(map)) {
    if (new Date(until).getTime() > now) active[key] = until
  }
  return active
}

/* ------------------------------------------------------------------ *
 * Merging the canonical feed with the legacy queues
 * ------------------------------------------------------------------ */

/**
 * Canonical rows and legacy queue rows describe overlapping work, so they have
 * to be combined rather than swapped.
 *
 * Replacing one with the other is what broke this: only calendar reconciliation
 * dual-writes into ReviewItem today, so the canonical response deleted the
 * pending place visits and every file-evidence item from the inbox the moment
 * it arrived — including the tab you had just selected.
 *
 * Canonical wins wherever it exists, matched on sourceId (the legacy row's own
 * id), so a calendar decision is never listed twice.
 */
export function mergeQueues(legacy: InboxItem[], canonical: InboxItem[]): InboxItem[] {
  const covered = new Set(canonical.map(item => item.sourceId).filter(Boolean))
  return [...canonical, ...legacy.filter(item => !covered.has(item.id))]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}

export function toInboxItem(item: ReviewItemPayload): InboxItem {
  const input = item.proposedCommand.input
  const evidence = asRecord(item.evidence)
  const title = firstString(input, ['title', 'text', 'summary', 'placeName', 'contactName'])
    || firstString(evidence, ['title', 'summary', 'placeName', 'assertion', 'sourceText'])
    || labelize(item.proposedCommand.command)
  const detail = item.source === 'communication_occurrence'
    ? occurrenceDetail(evidence)
    : firstString(input, ['description', 'body', 'reason', 'placeAddress'])
      || firstString(evidence, ['description', 'body', 'reason', 'exactQuote'])
      || `Proposed command: ${labelize(item.proposedCommand.command)}`

  return {
    id: item.id,
    source: sourceLabel(item.source),
    sourceKey: normalizeSource(item.source),
    primitive: item.itemType,
    title,
    detail,
    timestamp: item.createdAt,
    confidence: unitConfidence(item.confidence, 'unit'),
    priority: item.priority,
    riskTier: item.riskTier ?? 'review',
    itemType: item.itemType,
    canonical: true,
    sourceId: item.sourceId,
  }
}

/**
 * A message-suggested event needs to answer "from where, about when, and why
 * does this look like an event" before it can be judged. The generic fallback
 * printed "Proposed command: communication_occurrence.confirm", which answers
 * none of them.
 */
export function occurrenceDetail(evidence: Record<string, unknown>): string {
  const parts: string[] = []
  const from = typeof evidence.messageSource === 'string' ? evidence.messageSource.trim() : ''
  if (from) parts.push(`From ${labelize(from)}`)
  const when = typeof evidence.occurredAt === 'string' ? evidence.occurredAt : ''
  if (when) {
    const parsed = new Date(when)
    if (!Number.isNaN(parsed.getTime())) parts.push(formatDate(when))
  }
  const reason = typeof evidence.reason === 'string' ? evidence.reason.trim() : ''
  const prefix = parts.join(' · ')
  if (prefix && reason) return `${prefix} — ${reason}`
  return prefix || reason || 'A message looks like it refers to a real event'
}

export function normalizeSource(source: string): InboxSourceKey {
  if (source === 'note_suggestion') return source
  if (source === 'import_staged_visit') return source
  if (source === 'calendar_reconciliation') return source
  // Without this it fell through to the staged_interaction default, filing an
  // event proposal in the Communications queue as if it were an unmatched
  // message — present, but not where anyone would look for it.
  if (source === 'communication_occurrence') return source
  if (source === 'file_entity_mention' || source === 'evidence_claim') return 'file_evidence'
  return 'staged_interaction'
}

export function sourceLabel(source: string) {
  if (source === 'staged_interaction') return 'Communications'
  if (source === 'note_suggestion') return 'Notes'
  if (source === 'import_staged_visit') return 'Places'
  if (source === 'calendar_reconciliation') return 'Calendar'
  if (source === 'communication_occurrence') return 'Events'
  if (source === 'file_entity_mention' || source === 'evidence_claim') return 'File evidence'
  return labelize(source)
}

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

export function mapUrl(place: NonNullable<InboxItem['place']>) {
  // Google's documented cross-platform search URL. Coordinates first because a
  // pin is what actually answers "is this my building?"; the place id refines
  // the label when Google knows the spot.
  if (place.latitude != null && place.longitude != null) {
    const query = `${place.latitude},${place.longitude}`
    const id = place.googlePlaceId ? `&query_place_id=${encodeURIComponent(place.googlePlaceId)}` : ''
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}${id}`
  }
  if (place.address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.address)}`
  return null
}

export function dateRange(items: InboxItem[]) {
  const times = items.map(item => new Date(item.timestamp).getTime()).filter(Number.isFinite)
  if (!times.length) return ''
  const first = formatDate(new Date(Math.min(...times)).toISOString())
  const last = formatDate(new Date(Math.max(...times)).toISOString())
  return first === last ? ` · ${first}` : ` · ${first} – ${last}`
}

export function formatDate(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed)
}

export function labelize(value: string) {
  return value.replace(/[-_]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
    } catch { return {} }
  }
  return {}
}

function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (typeof record[key] === 'string' && record[key].trim()) return (record[key] as string).trim()
  }
  return null
}
