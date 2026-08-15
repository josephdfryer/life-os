'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'

import { unitConfidence } from '../lib/confidence'

export type InboxItem = {
  id: string
  source: string
  sourceKey: 'staged_interaction' | 'note_suggestion' | 'import_staged_visit' | 'calendar_reconciliation' | 'file_evidence'
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
  // On a canonical row, the id of the legacy record it was staged from. It is
  // what lets the two sets be merged without showing the same decision twice.
  sourceId?: string
}

type ReviewItem = {
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

const SOURCE_FILTERS = [
  ['all', 'Everything'],
  ['staged_interaction', 'Communications'],
  ['note_suggestion', 'Notes'],
  ['import_staged_visit', 'Places'],
  ['calendar_reconciliation', 'Calendar'],
  ['file_evidence', 'File evidence'],
] as const

export default function FederatedInbox({ items }: { items: InboxItem[] }) {
  const [reviewItems, setReviewItems] = useState(items)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [serviceMode, setServiceMode] = useState<'checking' | 'canonical' | 'legacy'>('checking')
  const [actionError, setActionError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const [source, setSource] = useState('all')
  const [primitive, setPrimitive] = useState('all')
  const [confidence, setConfidence] = useState('all')
  const [age, setAge] = useState('all')

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/review-items?status=pending&limit=200', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('legacy')
        return response.json() as Promise<{ data?: ReviewItem[]; nextCursor?: string | null }>
      })
      .then(page => {
        if (!Array.isArray(page.data)) throw new Error('legacy')
        startTransition(() => {
          setReviewItems(mergeQueues(items, page.data!.map(toInboxItem)))
          setNextCursor(page.nextCursor ?? null)
          setServiceMode('canonical')
        })
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setServiceMode('legacy')
      })
    return () => controller.abort()
  }, [])

  async function loadMore() {
    if (!nextCursor || pendingId) return
    setPendingId('pagination')
    setActionError(null)
    try {
      const response = await fetch(`/api/review-items?status=pending&limit=200&cursor=${encodeURIComponent(nextCursor)}`)
      const page = await response.json() as { data?: ReviewItem[]; nextCursor?: string | null; error?: string }
      if (!response.ok || !Array.isArray(page.data)) throw new Error(page.error || 'Could not load more review items.')
      setReviewItems(current => mergeQueues(
        current.filter(item => !item.canonical),
        [...current.filter(item => item.canonical), ...page.data!.map(toInboxItem)],
      ))
      setNextCursor(page.nextCursor ?? null)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not load more review items.')
    } finally { setPendingId(null) }
  }

  const primitives = useMemo(() => ['all', ...new Set(reviewItems.map(item => item.primitive))], [reviewItems])
  const filtered = useMemo(() => reviewItems.filter(item => {
    if (source !== 'all' && item.sourceKey !== source) return false
    if (primitive !== 'all' && item.primitive !== primitive) return false
    if (confidence === 'high' && (item.confidence == null || item.confidence < 0.8)) return false
    if (confidence === 'medium' && (item.confidence == null || item.confidence < 0.5 || item.confidence >= 0.8)) return false
    if (confidence === 'low' && (item.confidence == null || item.confidence >= 0.5)) return false
    if (age !== 'all') {
      const days = Number(age)
      if (Date.now() - new Date(item.timestamp).getTime() < days * 86_400_000) return false
    }
    return true
  }), [age, confidence, primitive, reviewItems, source])

  async function resolve(item: InboxItem, action: 'accept' | 'dismiss') {
    if (!item.canonical || pendingId) return
    setPendingId(item.id)
    setActionError(null)
    try {
      const response = await fetch(`/api/review-items/${encodeURIComponent(item.id)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const body = await response.json() as { error?: string }
      if (!response.ok) throw new Error(body.error || 'Could not resolve this review item.')
      setReviewItems(current => current.filter(candidate => candidate.id !== item.id))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not resolve this review item.')
    } finally {
      setPendingId(null)
    }
  }

  // Counts come from the unfiltered set: a tab has to say how much work is in
  // that queue even while you are looking at another one. Queues with nothing
  // pending are dropped rather than shown as an empty choice.
  const queueTabs = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of reviewItems) counts.set(item.sourceKey, (counts.get(item.sourceKey) ?? 0) + 1)
    const tabs = SOURCE_FILTERS
      .filter(([key]) => key !== 'all')
      .map(([key, label]) => ({ key, label, count: counts.get(key) ?? 0 }))
      .filter(tab => tab.count > 0)
      .sort((a, b) => b.count - a.count)
    return [{ key: 'all', label: 'Everything', count: reviewItems.length }, ...tabs]
  }, [reviewItems])

  // A queue can empty while you are standing in it. Without this the switcher
  // drops the tab, the selection survives, and the inbox reads as permanently
  // empty with no indication of why.
  useEffect(() => {
    if (source !== 'all' && !queueTabs.some(tab => tab.key === source)) setSource('all')
  }, [queueTabs, source])

  const readOnlyCount = useMemo(() => filtered.filter(item => !item.canonical && !item.place).length, [filtered])

  // Group by the question being asked, not by source. 59 items sharing one
  // command shape are one decision, and presenting them as 59 rows is what made
  // the queue unclearable. Only groups whose tier permits it get a bulk action —
  // review and confirm tier items exist because they need individual judgment.
  //
  // Place visits group tighter still: by place. 165 pending visits describe
  // three places, 154 of them one address the phone sees every day. The decision
  // is "is this Red Rock Villas?", asked once — not "was I there on the 4th?",
  // asked 154 times.
  const groups = useMemo(() => {
    const byKey = new Map<string, InboxItem[]>()
    for (const item of filtered) {
      const key = item.place
        ? `place:${item.place.googlePlaceId ?? `${item.place.name ?? ''}|${item.place.address ?? ''}`}`
        : `${item.sourceKey}:${item.itemType ?? 'item'}`
      const bucket = byKey.get(key) ?? []
      bucket.push(item)
      byKey.set(key, bucket)
    }
    return [...byKey.entries()]
      .map(([key, items]) => ({
        key,
        items,
        place: items[0].place,
        label: items[0].place
          ? items[0].place.name || items[0].place.address || 'Unnamed place'
          : sourceLabel(items[0].source),
        bulkable: items.length > 1 && items.every(i => i.riskTier === 'observe' || i.riskTier === 'safe_auto'),
      }))
      .sort((a, b) => b.items.length - a.items.length)
  }, [filtered])

  async function resolveGroup(group: { key: string; items: InboxItem[]; place?: InboxItem['place'] }, action: 'accept' | 'dismiss') {
    if (pendingId) return
    setPendingId(`group:${group.key}`)
    setActionError(null)
    const ids = group.items.map(i => i.id)
    try {
      // A place group is resolved as a place — one Place record, an Event per
      // visit, and every future visit there matched automatically — rather than
      // as a list of review items, which these visits never were.
      const request = group.place
        ? {
            url: '/api/staged-visits/resolve',
            body: {
              googlePlaceId: group.place.googlePlaceId,
              placeName: group.place.googlePlaceId ? undefined : group.place.name,
              placeAddress: group.place.googlePlaceId ? undefined : group.place.address,
              action,
            },
          }
        : {
            url: `/api/review-items/bulk-${action === 'accept' ? 'accept' : 'dismiss'}`,
            body: action === 'accept' ? { ids } : { ids, reason: 'Bulk dismissed from inbox' },
          }
      const response = await fetch(request.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request.body),
      })
      const body = await response.json() as { error?: string }
      if (!response.ok) throw new Error(body.error || 'Could not resolve this group.')
      const removed = new Set(ids)
      setReviewItems(current => current.filter(candidate => !removed.has(candidate.id)))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not resolve this group.')
    } finally {
      setPendingId(null)
    }
  }

  return (
    <section aria-label="Federated review inbox">
      <div className="inbox-queues" role="tablist" aria-label="Review queues">
        {queueTabs.map(tab => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={source === tab.key}
            className={`inbox-queue${source === tab.key ? ' inbox-queue--active' : ''}`}
            onClick={() => setSource(tab.key)}
          >
            {tab.label}<span className="inbox-queue-count">{tab.count}</span>
          </button>
        ))}
      </div>

      <div className="inbox-filters">
        <Filter label="Primitive" value={primitive} options={primitives.map(value => [value, value === 'all' ? 'All primitives' : labelize(value)] as const)} onChange={setPrimitive} />
        <Filter label="Confidence" value={confidence} options={[['all', 'Any confidence'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]} onChange={setConfidence} />
        <Filter label="Age" value={age} options={[['all', 'Any age'], ['1', 'Older than 1 day'], ['7', 'Older than 7 days'], ['30', 'Older than 30 days']]} onChange={setAge} />
      </div>

      <div className="inbox-status-line">
        <p className="stream-count">Showing {filtered.length} of {reviewItems.length} review items</p>
        <span className={`inbox-service-mode inbox-service-mode--${serviceMode}`}>
          {serviceMode === 'canonical' ? 'Shared review queue' : serviceMode === 'legacy' ? 'Legacy queues · read only' : 'Connecting…'}
        </span>
      </div>
      {actionError ? <p className="inbox-action-error" role="alert">{actionError}</p> : null}
      {filtered.length === 0 ? <div className="stream-message">{source === 'all' ? 'Nothing to review — the queue is clear.' : 'Nothing left in this queue.'}</div> : (
        <div className="stream-list">
          {groups.map(group => (
            <div key={group.key} className="inbox-group">
              {group.place ? (
                <div className="inbox-group-head">
                  <span className="inbox-group-title">
                    <b>{group.label}</b>
                    <span className="inbox-group-sub">
                      {group.items.length} visit{group.items.length === 1 ? '' : 's'}
                      {group.place.address ? ` · ${group.place.address}` : ''}
                      {dateRange(group.items)}
                    </span>
                  </span>
                  <span className="inbox-group-actions">
                    {mapUrl(group.place) ? (
                      // You cannot confirm a place you cannot see. Opens in a new
                      // tab so a half-triaged queue is not lost to navigation.
                      <a className="inbox-action" href={mapUrl(group.place)!} target="_blank" rel="noopener noreferrer">View on map</a>
                    ) : null}
                    <button type="button" className="inbox-action inbox-action--accept" disabled={!!pendingId} onClick={() => resolveGroup(group, 'accept')}>
                      {pendingId === `group:${group.key}` ? 'Working…' : `This is the place · accept ${group.items.length}`}
                    </button>
                    <button type="button" className="inbox-action" disabled={!!pendingId} onClick={() => resolveGroup(group, 'dismiss')}>Not a place</button>
                  </span>
                </div>
              ) : group.items.length > 1 ? (
                <div className="inbox-group-head">
                  <span className="inbox-group-title">{group.items.length} × {group.label}</span>
                  {group.bulkable ? (
                    <span className="inbox-group-actions">
                      <button type="button" className="inbox-action" disabled={!!pendingId} onClick={() => resolveGroup(group, 'accept')}>Accept all {group.items.length}</button>
                      <button type="button" className="inbox-action" disabled={!!pendingId} onClick={() => resolveGroup(group, 'dismiss')}>Dismiss all</button>
                    </span>
                  ) : <span className="inbox-group-note">Needs individual review</span>}
                </div>
              ) : null}
              {/* A place group answers itself in the header. Listing all 154
                  visits underneath is the noise this replaces — the first few
                  are enough to recognise it. */}
              {(group.place ? group.items.slice(0, 3) : group.items).map(item => (
                <InboxRow key={`${item.sourceKey}:${item.id}`} item={item} pending={pendingId === item.id} onResolve={resolve} />
              ))}
              {group.place && group.items.length > 3 ? (
                <p className="inbox-group-more">and {group.items.length - 3} more visit{group.items.length - 3 === 1 ? '' : 's'} to this place</p>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {serviceMode === 'legacy' ? <p className="inbox-read-only">The shared queue is not configured, so these legacy queues remain read only.</p> : null}
      {serviceMode === 'canonical' && readOnlyCount > 0 ? <p className="inbox-read-only">{readOnlyCount} of these have not been staged into the shared queue yet, so they are shown here but resolved in their own app.</p> : null}
      {serviceMode === 'canonical' && nextCursor ? <button type="button" className="inbox-action" disabled={pendingId === 'pagination'} onClick={loadMore}>{pendingId === 'pagination' ? 'Loading…' : 'Load more review items'}</button> : null}
    </section>
  )
}

function Filter({ label, value, options, onChange }: { label: string; value: string; options: readonly (readonly [string, string])[]; onChange: (value: string) => void }) {
  return <label className="inbox-filter"><span>{label}</span><select value={value} onChange={event => onChange(event.target.value)}>{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
}

function InboxRow({ item, pending, onResolve }: { item: InboxItem; pending: boolean; onResolve: (item: InboxItem, action: 'accept' | 'dismiss') => void }) {
  return (
    <article className="inbox-row">
      <div className="inbox-row-leading">
        <span className="stream-type-badge">{item.source}</span>
        <span className="inbox-primitive">{labelize(item.primitive)}</span>
      </div>
      <div className="stream-row-body">
        <div className="stream-row-title">{item.title}</div>
        <div className="stream-row-detail">{item.detail}</div>
      </div>
      <div className="inbox-row-trailing">
        <time className="stream-row-date" dateTime={item.timestamp}>{formatDate(item.timestamp)}</time>
        <span className="inbox-confidence">{item.confidence == null ? 'Needs judgment' : `${Math.round(item.confidence * 100)}% confidence`}</span>
        {item.canonical ? <div className="inbox-row-actions">
          <button type="button" className="inbox-action inbox-action--accept" disabled={pending} onClick={() => onResolve(item, 'accept')}>{pending ? 'Working…' : 'Accept'}</button>
          <button type="button" className="inbox-action" disabled={pending} onClick={() => onResolve(item, 'dismiss')}>Dismiss</button>
        </div> : null}
      </div>
    </article>
  )
}

function toInboxItem(item: ReviewItem): InboxItem {
  const input = item.proposedCommand.input
  const evidence = asRecord(item.evidence)
  const title = firstString(input, ['title', 'text', 'summary', 'placeName', 'contactName'])
    || firstString(evidence, ['title', 'summary', 'placeName', 'assertion', 'sourceText'])
    || labelize(item.proposedCommand.command)
  const detail = firstString(input, ['description', 'body', 'reason', 'placeAddress'])
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
 * Canonical rows and legacy queue rows describe overlapping work, so they have
 * to be combined rather than swapped.
 *
 * Replacing one with the other is what broke this: only calendar reconciliation
 * dual-writes into ReviewItem today, so the canonical response deleted the 165
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

function normalizeSource(source: string): InboxItem['sourceKey'] {
  if (source === 'note_suggestion') return source
  if (source === 'import_staged_visit') return source
  if (source === 'calendar_reconciliation') return source
  if (source === 'file_entity_mention' || source === 'evidence_claim') return 'file_evidence'
  return 'staged_interaction'
}

function sourceLabel(source: string) {
  if (source === 'staged_interaction') return 'Communications'
  if (source === 'note_suggestion') return 'Notes'
  if (source === 'import_staged_visit') return 'Places'
  if (source === 'calendar_reconciliation') return 'Calendar'
  if (source === 'file_entity_mention' || source === 'evidence_claim') return 'File evidence'
  return labelize(source)
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
    if (typeof record[key] === 'string' && record[key].trim()) return record[key].trim()
  }
  return null
}

function mapUrl(place: NonNullable<InboxItem['place']>) {
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

function dateRange(items: InboxItem[]) {
  const times = items.map(item => new Date(item.timestamp).getTime()).filter(Number.isFinite)
  if (!times.length) return ''
  const first = formatDate(new Date(Math.min(...times)).toISOString())
  const last = formatDate(new Date(Math.max(...times)).toISOString())
  return first === last ? ` · ${first}` : ` · ${first} – ${last}`
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

function labelize(value: string) {
  return value.replace(/[-_]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}
