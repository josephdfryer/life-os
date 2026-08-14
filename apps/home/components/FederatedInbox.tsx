'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'

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
  canonical?: boolean
}

type ReviewItem = {
  id: string
  source: string
  itemType: string
  proposedCommand: { command: string; input: Record<string, unknown> }
  confidence: number | null
  priority: number
  createdAt: string
  evidence: unknown
}

const SOURCE_FILTERS = [
  ['all', 'All sources'],
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
          setReviewItems(page.data!.map(toInboxItem))
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
      setReviewItems(current => [...current, ...page.data!.map(toInboxItem)])
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

  return (
    <section aria-label="Federated review inbox">
      <div className="inbox-filters">
        <Filter label="Source" value={source} options={SOURCE_FILTERS} onChange={setSource} />
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
      {filtered.length === 0 ? <div className="stream-message">Nothing matches these filters.</div> : (
        <div className="stream-list">
          {filtered.map(item => <InboxRow key={`${item.sourceKey}:${item.id}`} item={item} pending={pendingId === item.id} onResolve={resolve} />)}
        </div>
      )}
      {serviceMode === 'legacy' ? <p className="inbox-read-only">The shared queue is not configured, so these legacy queues remain read only.</p> : null}
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
    confidence: item.confidence,
    priority: item.priority,
    canonical: true,
  }
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

function labelize(value: string) {
  return value.replace(/[-_]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}
