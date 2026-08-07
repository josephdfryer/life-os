'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type StreamRow = {
  id: string
  timestamp: string
  type: string
  subtype?: string | null
  source?: string | null
  summary?: string | null
  merchantName?: string | null
  amount?: number | null
  direction?: string | null
  person?: { id: string; first: string; last: string; company?: string | null } | null
  actorPerson?: { id: string; first: string; last: string } | null
  place?: { id: string; name: string } | null
  event?: { id: string; name: string; start: string } | null
}

type StreamResponse = {
  data: StreamRow[]
  nextCursor: string | null
  hasMore: boolean
  total?: number
  error?: string
  code?: string
}

const TYPES = [
  ['all', 'Everything'],
  ['message,call,meeting,email_thread,message_thread', 'Communication'],
  ['financial', 'Financial'],
  ['calendar', 'Calendar'],
  ['visit', 'Visits'],
]

export default function StreamClient() {
  const [type, setType] = useState('all')
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [rows, setRows] = useState<StreamRow[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [total, setTotal] = useState<number | undefined>()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const params = useMemo(() => {
    const search = new URLSearchParams({ limit: '50', include: 'person,place,actor,event' })
    if (type !== 'all') search.set('type', type)
    if (submittedQuery) search.set('q', submittedQuery)
    return search
  }, [submittedQuery, type])

  const load = useCallback(async (append: boolean, requestedCursor?: string | null) => {
    append ? setLoadingMore(true) : setLoading(true)
    setError(null)
    const search = new URLSearchParams(params)
    if (append && requestedCursor) search.set('cursor', requestedCursor)
    try {
      const response = await fetch(`/api/stream?${search.toString()}`)
      const body = await response.json() as StreamResponse
      if (!response.ok) throw new Error(body.error ?? 'Unable to load the stream.')
      setRows(previous => append ? [...previous, ...body.data] : body.data)
      setCursor(body.nextCursor)
      setHasMore(body.hasMore)
      setTotal(body.total)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load the stream.')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [params])

  useEffect(() => {
    setCursor(null)
    void load(false)
  }, [load])

  function applySearch(event: React.FormEvent) {
    event.preventDefault()
    setSubmittedQuery(query.trim())
  }

  return (
    <section aria-label="Interaction stream">
      <form className="stream-filters" onSubmit={applySearch}>
        <div className="stream-type-filters" role="tablist" aria-label="Filter by type">
          {TYPES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`stream-filter ${type === value ? 'stream-filter-active' : ''}`}
              onClick={() => setType(value)}
              role="tab"
              aria-selected={type === value}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="stream-search">
          <span className="sr-only">Search the stream</span>
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search what happened…" />
          <button className="still-button still-button-secondary" type="submit">Search</button>
        </label>
      </form>

      {total !== undefined && <p className="stream-count">{total.toLocaleString()} matching interactions</p>}

      {error && <div className="stream-message stream-message-error"><strong>Stream unavailable.</strong> {error}</div>}
      {!error && loading && <div className="stream-message">Loading the graph…</div>}
      {!error && !loading && rows.length === 0 && <div className="stream-message">Nothing matches these filters.</div>}

      <div className="stream-list">
        {rows.map(row => <StreamRowView key={row.id} row={row} />)}
      </div>

      {hasMore && !error && (
        <button className="still-button still-button-secondary stream-load-more" onClick={() => void load(true, cursor)} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  )
}

function StreamRowView({ row }: { row: StreamRow }) {
  const title = row.summary || row.merchantName || row.event?.name || labelize(row.type)
  const subject = row.person ? `${row.person.first} ${row.person.last}` : row.actorPerson ? `${row.actorPerson.first} ${row.actorPerson.last}` : null
  const detail = [subject, row.place?.name, row.source ? sourceLabel(row.source) : null].filter(Boolean).join(' · ')
  return (
    <article className="stream-row">
      <time className="stream-row-date" dateTime={row.timestamp}>{formatDate(row.timestamp)}</time>
      <div className="stream-row-body">
        <div className="stream-row-title">{title}</div>
        {detail && <div className="stream-row-detail">{detail}</div>}
      </div>
      <div className="stream-row-meta">
        <span className="stream-type-badge">{labelize(row.subtype || row.type)}</span>
        {row.amount != null && <span className="stream-amount">{formatAmount(row.amount, row.direction)}</span>}
      </div>
    </article>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

function formatAmount(amount: number, direction?: string | null) {
  const sign = direction === 'paid' ? '-' : direction === 'received' ? '+' : ''
  return `${sign}$${Math.abs(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function labelize(value: string) {
  return value.replace(/[-_]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

function sourceLabel(value: string) {
  return value === 'imessage' ? 'iMessage' : value === 'gmail' ? 'Email' : value === 'whatsapp' ? 'WhatsApp' : value
}
