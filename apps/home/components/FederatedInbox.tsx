'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  EMPTY_FILTERS,
  SNOOZE_PRESETS,
  acceptLabel,
  activeSnoozes,
  blockedReason,
  canAccept,
  canCancel,
  canDismiss,
  confirmationCount,
  dateRange,
  dismissLabel,
  expandPlaceGroups,
  filterItems,
  formatDate,
  groupItems,
  isActionable,
  labelize,
  mapUrl,
  mergeQueues,
  rangeKeys,
  rowKey,
  snoozeUntil,
  toInboxItem,
  type InboxFilters,
  type InboxItem,
  type InboxVerb,
  type ReviewItemPayload,
  type SnoozeMap,
} from '../lib/inbox-model'

export type { InboxItem } from '../lib/inbox-model'

const SOURCE_FILTERS = [
  ['staged_interaction', 'Communications'],
  ['note_suggestion', 'Notes'],
  ['import_staged_visit', 'Places'],
  ['calendar_reconciliation', 'Calendar'],
  ['communication_occurrence', 'Events'],
  ['file_evidence', 'File evidence'],
] as const

const SNOOZE_STORAGE_KEY = 'lifeos.inbox.snoozed'
/** How long an action stays undoable before it is sent. Long enough to catch a
 *  mis-keyed sweep of 500 rows, short enough that leaving the page is safe. */
const UNDO_WINDOW_MS = 5_000
const BATCH_SIZE = 200
/** Rows drawn per group before "show all". A 500-row group must not cost 500 nodes. */
const GROUP_PREVIEW = 6
/** Above this, a sweep over judgment-tier rows asks before it runs. */
const CONFIRM_THRESHOLD = 5

type PendingBatch = { id: string; action: InboxVerb; items: InboxItem[]; timer: ReturnType<typeof setTimeout> }

export default function FederatedInbox({ items }: { items: InboxItem[] }) {
  const [reviewItems, setReviewItems] = useState(items)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [serviceMode, setServiceMode] = useState<'checking' | 'canonical' | 'legacy'>('checking')
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const [filters, setFilters] = useState<InboxFilters>(EMPTY_FILTERS)
  const [view, setView] = useState<'inbox' | 'snoozed'>('inbox')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [snoozed, setSnoozed] = useState<SnoozeMap>({})
  const [confirming, setConfirming] = useState<InboxVerb | null>(null)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showPreview, setShowPreview] = useState(true)

  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const queueRef = useRef<Map<string, PendingBatch>>(new Map())
  const [queueTick, setQueueTick] = useState(0)
  const bumpQueue = useCallback(() => setQueueTick(tick => tick + 1), [])

  /* ---------------------------------------------------------------- *
   * Loading
   * ---------------------------------------------------------------- */

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/review-items?status=pending&limit=200', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('legacy')
        return response.json() as Promise<{ data?: ReviewItemPayload[]; nextCursor?: string | null }>
      })
      .then(page => {
        if (!Array.isArray(page.data)) throw new Error('legacy')
        setReviewItems(current => mergeQueues(current.filter(item => !item.canonical), page.data!.map(toInboxItem)))
        setNextCursor(page.nextCursor ?? null)
        setServiceMode('canonical')
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setServiceMode('legacy')
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SNOOZE_STORAGE_KEY)
      if (raw) setSnoozed(activeSnoozes(JSON.parse(raw) as SnoozeMap))
    } catch { /* a browser that blocks storage still gets a working inbox */ }
  }, [])

  const persistSnoozes = useCallback((next: SnoozeMap) => {
    setSnoozed(next)
    try { window.localStorage.setItem(SNOOZE_STORAGE_KEY, JSON.stringify(next)) } catch { /* non-fatal */ }
  }, [])

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    setActionError(null)
    try {
      const response = await fetch(`/api/review-items?status=pending&limit=200&cursor=${encodeURIComponent(nextCursor)}`)
      const page = await response.json() as { data?: ReviewItemPayload[]; nextCursor?: string | null; error?: string }
      if (!response.ok || !Array.isArray(page.data)) throw new Error(page.error || 'Could not load more review items.')
      setReviewItems(current => mergeQueues(
        current.filter(item => !item.canonical),
        [...current.filter(item => item.canonical), ...page.data!.map(toInboxItem)],
      ))
      setNextCursor(page.nextCursor ?? null)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not load more review items.')
    } finally { setLoadingMore(false) }
  }

  /* ---------------------------------------------------------------- *
   * Derived views
   * ---------------------------------------------------------------- */

  const snoozedKeys = useMemo(() => new Set(Object.keys(snoozed)), [snoozed])

  const visibleUniverse = useMemo(
    () => reviewItems.filter(item => (view === 'snoozed') === snoozedKeys.has(rowKey(item))),
    [reviewItems, snoozedKeys, view],
  )

  const filtered = useMemo(() => filterItems(visibleUniverse, filters), [visibleUniverse, filters])
  const groups = useMemo(() => groupItems(filtered), [filtered])

  const primitives = useMemo(
    () => ['all', ...new Set(reviewItems.map(item => item.primitive))],
    [reviewItems],
  )

  // Counts come from the unfiltered set: a tab has to say how much work is in
  // that queue even while you are looking at another one. Queues with nothing
  // pending are dropped rather than shown as an empty choice.
  const queueTabs = useMemo(() => {
    const counts = new Map<string, number>()
    const actionable = new Map<string, number>()
    for (const item of visibleUniverse) {
      counts.set(item.sourceKey, (counts.get(item.sourceKey) ?? 0) + 1)
      if (isActionable(item)) actionable.set(item.sourceKey, (actionable.get(item.sourceKey) ?? 0) + 1)
    }
    const tabs = SOURCE_FILTERS
      .map(([key, label]) => ({ key, label, count: counts.get(key) ?? 0, actionable: actionable.get(key) ?? 0 }))
      .filter(tab => tab.count > 0)
      .sort((a, b) => b.count - a.count)
    return [{
      key: 'all',
      label: 'Everything',
      count: visibleUniverse.length,
      actionable: visibleUniverse.filter(isActionable).length,
    }, ...tabs]
  }, [visibleUniverse])

  // A queue can empty while you are standing in it. Without this the switcher
  // drops the tab, the selection survives, and the inbox reads as permanently
  // empty with no indication of why.
  useEffect(() => {
    if (filters.source !== 'all' && !queueTabs.some(tab => tab.key === filters.source)) {
      setFilters(current => ({ ...current, source: 'all' }))
    }
  }, [queueTabs, filters.source])

  /** The rows actually drawn, in draw order — what j/k walks and shift-click spans. */
  const rows = useMemo(() => {
    const drawn: InboxItem[] = []
    for (const group of groups) {
      if (collapsed.has(group.key)) continue
      const limit = expanded.has(group.key) || group.items.length <= GROUP_PREVIEW ? group.items.length : GROUP_PREVIEW
      drawn.push(...group.items.slice(0, limit))
    }
    return drawn
  }, [groups, collapsed, expanded])

  const rowMap = useMemo(() => new Map(rows.map(row => [rowKey(row), row])), [rows])

  // Focus has to survive a row being resolved out from under it, and land
  // somewhere real when the list first draws.
  useEffect(() => {
    if (!rows.length) { if (focusKey) setFocusKey(null); return }
    if (!focusKey || !rowMap.has(focusKey)) setFocusKey(rowKey(rows[0]))
  }, [rows, rowMap, focusKey])

  const focusedItem = focusKey ? rowMap.get(focusKey) ?? null : null

  const selectedItems = useMemo(() => {
    const inView = new Set(reviewItems.map(rowKey))
    return reviewItems.filter(item => selected.has(rowKey(item)) && inView.has(rowKey(item)))
  }, [reviewItems, selected])

  /** What a verb would act on: the selection if there is one, otherwise the focused row. */
  const targets = useCallback((): InboxItem[] => {
    if (selectedItems.length) return selectedItems
    return focusedItem ? [focusedItem] : []
  }, [selectedItems, focusedItem])

  /* ---------------------------------------------------------------- *
   * Resolving, with a real undo window
   * ---------------------------------------------------------------- */

  const restore = useCallback((items: InboxItem[]) => {
    setReviewItems(current => {
      const present = new Set(current.map(rowKey))
      const returning = items.filter(item => !present.has(rowKey(item)))
      return [...current, ...returning].sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    })
  }, [])

  const send = useCallback(async (action: InboxVerb, items: InboxItem[], personId?: string) => {
    const failed: InboxItem[] = []
    const messages = new Set<string>()
    setBusy(true)
    try {
      for (let index = 0; index < items.length; index += BATCH_SIZE) {
        const chunk = items.slice(index, index + BATCH_SIZE)
        const response = await fetch('/api/inbox/resolve', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action,
            personId,
            items: chunk.map(item => ({ id: item.id, sourceKey: item.sourceKey, canonical: item.canonical === true })),
          }),
        })
        const body = await response.json().catch(() => null) as
          | { results?: { id: string; ok: boolean; error?: string }[]; error?: string }
          | null
        if (!response.ok) throw new Error(body?.error || 'Could not resolve these items.')
        const byId = new Map((body?.results ?? []).map(result => [result.id, result]))
        for (const item of chunk) {
          const result = byId.get(item.id)
          if (result && !result.ok) {
            failed.push(item)
            if (result.error) messages.add(result.error)
          }
        }
      }
      if (failed.length) {
        restore(failed)
        setActionError(`${failed.length} item${failed.length === 1 ? '' : 's'} could not be resolved — ${[...messages].slice(0, 2).join('; ')}`)
      }
    } catch (error) {
      restore(items)
      setActionError(error instanceof Error ? error.message : 'Could not resolve these items.')
    } finally {
      setBusy(false)
    }
  }, [restore])

  const flush = useCallback((batchId: string) => {
    const batch = queueRef.current.get(batchId)
    if (!batch) return
    clearTimeout(batch.timer)
    queueRef.current.delete(batchId)
    bumpQueue()
    void send(batch.action, batch.items)
  }, [bumpQueue, send])

  /**
   * Rows leave the list at once and the request follows a few seconds later, so
   * triage feels instant and a mis-keyed sweep of 500 rows is still recoverable.
   * Anything still queued is sent if the tab goes away.
   */
  const resolve = useCallback((action: InboxVerb, items: InboxItem[], personId?: string) => {
    const eligible = expandPlaceGroups(
      items.filter(item => (action === 'accept' ? canAccept(item) : canDismiss(item))),
      reviewItems,
    )
    if (!eligible.length) {
      const blocked = items.map(blockedReason).find(Boolean)
      setActionError(blocked ?? `Nothing here can be ${action === 'accept' ? 'accepted' : 'dismissed'} from the inbox.`)
      return
    }
    const keys = new Set(eligible.map(rowKey))
    setReviewItems(current => current.filter(item => !keys.has(rowKey(item))))
    setSelected(current => {
      const next = new Set(current)
      for (const key of keys) next.delete(key)
      return next
    })
    setActionError(null)
    setConfirming(null)

    // A person-assigned accept is a deliberate, specific act; sending it right
    // away keeps the picker's feedback honest rather than delayed.
    if (personId) { void send(action, eligible, personId); return }

    const batchId = `${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
    const timer = setTimeout(() => flush(batchId), UNDO_WINDOW_MS)
    queueRef.current.set(batchId, { id: batchId, action, items: eligible, timer })
    bumpQueue()
  }, [bumpQueue, flush, reviewItems, send])

  const undo = useCallback(() => {
    const batches = [...queueRef.current.values()]
    const latest = batches[batches.length - 1]
    if (!latest) return
    clearTimeout(latest.timer)
    queueRef.current.delete(latest.id)
    bumpQueue()
    restore(latest.items)
    setSelected(new Set(latest.items.map(rowKey)))
  }, [bumpQueue, restore])

  useEffect(() => {
    const queue = queueRef.current
    const flushAll = () => { for (const id of [...queue.keys()]) flush(id) }
    const onHidden = () => { if (document.visibilityState === 'hidden') flushAll() }
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pagehide', flushAll)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('pagehide', flushAll)
      flushAll()
    }
  }, [flush])

  /** A verb over judgment-tier rows in bulk asks once, then runs. */
  const request = useCallback((action: InboxVerb) => {
    const items = targets()
    if (!items.length) return
    const risky = confirmationCount(items)
    if (items.length > 1 && risky >= CONFIRM_THRESHOLD && confirming !== action) {
      setConfirming(action)
      return
    }
    resolve(action, items)
  }, [confirming, resolve, targets])

  const snooze = useCallback((preset: string) => {
    const items = targets()
    if (!items.length) return
    const until = snoozeUntil(preset)
    const next = { ...snoozed }
    for (const item of items) next[rowKey(item)] = until
    persistSnoozes(next)
    setSelected(new Set())
  }, [persistSnoozes, snoozed, targets])

  // Unsnoozing the last item used to leave you standing in an empty Snoozed
  // view with a "Snoozed 0" tab as the only way out. Same failure as a queue
  // emptying underneath you, same fix.
  useEffect(() => {
    if (view === 'snoozed' && Object.keys(snoozed).length === 0) setView('inbox')
  }, [snoozed, view])

  const unsnooze = useCallback((items: InboxItem[]) => {
    const next = { ...snoozed }
    for (const item of items) delete next[rowKey(item)]
    persistSnoozes(next)
  }, [persistSnoozes, snoozed])

  /* ---------------------------------------------------------------- *
   * Selection
   * ---------------------------------------------------------------- */

  const toggle = useCallback((key: string, extend: boolean) => {
    setSelected(current => {
      const next = new Set(current)
      if (extend) {
        for (const span of rangeKeys(rows, anchor, key)) next.add(span)
      } else if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    if (!extend) setAnchor(key)
    setFocusKey(key)
  }, [anchor, rows])

  const selectAllDrawn = useCallback(() => {
    setSelected(current => {
      const keys = rows.map(rowKey)
      const everySelected = keys.length > 0 && keys.every(key => current.has(key))
      return everySelected ? new Set() : new Set(keys)
    })
  }, [rows])

  const selectEveryMatch = useCallback(() => setSelected(new Set(filtered.map(rowKey))), [filtered])

  const move = useCallback((delta: number, extend: boolean) => {
    if (!rows.length) return
    const index = focusKey ? rows.findIndex(row => rowKey(row) === focusKey) : -1
    const next = Math.min(rows.length - 1, Math.max(0, (index < 0 ? 0 : index) + delta))
    const key = rowKey(rows[next])
    setFocusKey(key)
    if (extend) setSelected(current => new Set([...current, ...rangeKeys(rows, focusKey, key)]))
    listRef.current?.querySelector<HTMLElement>(`[data-row-key="${cssEscape(key)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [focusKey, rows])

  /* ---------------------------------------------------------------- *
   * Keyboard
   * ---------------------------------------------------------------- */

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const typing = !!target && (
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable
      )

      if (event.key === 'Escape') {
        if (showShortcuts) { setShowShortcuts(false); return }
        if (typing) { (target as HTMLInputElement).blur(); return }
        if (confirming) { setConfirming(null); return }
        setSelected(new Set())
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); undo(); return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a' && !typing) {
        event.preventDefault(); selectAllDrawn(); return
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return

      switch (event.key) {
        case 'j': case 'ArrowDown': event.preventDefault(); move(1, event.shiftKey); break
        case 'k': case 'ArrowUp': event.preventDefault(); move(-1, event.shiftKey); break
        case 'J': event.preventDefault(); move(1, true); break
        case 'K': event.preventDefault(); move(-1, true); break
        case 'x': if (focusKey) { event.preventDefault(); toggle(focusKey, false) } break
        case 'e': event.preventDefault(); request('accept'); break
        case 'y': case '#': event.preventDefault(); request('dismiss'); break
        case 'h': event.preventDefault(); snooze('tomorrow'); break
        case 'u': event.preventDefault(); undo(); break
        case '/': event.preventDefault(); searchRef.current?.focus(); break
        case '?': event.preventDefault(); setShowShortcuts(current => !current); break
        // Deliberately no bare key for "select everything matching". A missed
        // click on the search box sends what you type here, and one letter that
        // selects 1,290 rows next to one that dismisses them is a trap. ⌘A
        // reaches the drawn rows; the wider sweep stays an explicit click.
        case 'p': event.preventDefault(); setShowPreview(current => !current); break
        default: {
          const digit = Number(event.key)
          if (Number.isInteger(digit) && digit >= 1 && digit <= queueTabs.length) {
            event.preventDefault()
            setFilters(current => ({ ...current, source: queueTabs[digit - 1].key }))
          }
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [confirming, focusKey, move, queueTabs, request, selectAllDrawn, showShortcuts, snooze, toggle, undo])

  /* ---------------------------------------------------------------- *
   * Render
   * ---------------------------------------------------------------- */

  const pendingBatches = useMemo(() => [...queueRef.current.values()], [queueTick])
  const latestBatch = pendingBatches[pendingBatches.length - 1] ?? null
  const actionTargets = targets()
  const allDrawnSelected = rows.length > 0 && rows.every(row => selected.has(rowKey(row)))
  const snoozedCount = snoozedKeys.size

  return (
    <section className="inbox" aria-label="Federated review inbox">
      <div className="inbox-queues" role="tablist" aria-label="Source">
        {queueTabs.map((tab, index) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={filters.source === tab.key}
            className={`inbox-queue${filters.source === tab.key ? ' inbox-queue--active' : ''}`}
            onClick={() => setFilters(current => ({ ...current, source: tab.key }))}
            title={`${tab.actionable} of ${tab.count} can be actioned here · press ${index + 1}`}
          >
            {tab.label}<span className="inbox-queue-count">{tab.count}</span>
          </button>
        ))}
        {snoozedCount > 0 ? (
          <button
            type="button"
            role="tab"
            aria-selected={view === 'snoozed'}
            className={`inbox-queue inbox-queue--snoozed${view === 'snoozed' ? ' inbox-queue--active' : ''}`}
            onClick={() => setView(view === 'snoozed' ? 'inbox' : 'snoozed')}
          >
            Snoozed<span className="inbox-queue-count">{snoozedCount}</span>
          </button>
        ) : null}
      </div>

      <div className="inbox-toolbar">
        <label className="inbox-search">
          <span aria-hidden="true">⌕</span>
          <input
            ref={searchRef}
            type="search"
            value={filters.query}
            placeholder="Search this inbox…"
            aria-label="Search review items"
            onChange={event => setFilters(current => ({ ...current, query: event.target.value }))}
          />
          <kbd>/</kbd>
        </label>
        <Filter label="Primitive" value={filters.primitive} options={primitives.map(value => [value, value === 'all' ? 'All primitives' : labelize(value)] as const)} onChange={value => setFilters(current => ({ ...current, primitive: value }))} />
        <Filter label="Confidence" value={filters.confidence} options={[['all', 'Any confidence'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]} onChange={value => setFilters(current => ({ ...current, confidence: value }))} />
        <Filter label="Age" value={filters.age} options={[['all', 'Any age'], ['1', 'Older than 1 day'], ['7', 'Older than 7 days'], ['30', 'Older than 30 days']]} onChange={value => setFilters(current => ({ ...current, age: value }))} />
        <label className="inbox-toggle">
          <input
            type="checkbox"
            checked={filters.actionable}
            onChange={event => setFilters(current => ({ ...current, actionable: event.target.checked }))}
          />
          <span>Only what I can action</span>
        </label>
      </div>

      <div className="inbox-status-line">
        <p className="stream-count">
          <label className="inbox-select-all">
            <input type="checkbox" checked={allDrawnSelected} onChange={selectAllDrawn} aria-label="Select every drawn row" />
          </label>
          Showing {filtered.length} of {visibleUniverse.length}
          {filtered.length > rows.length ? ` · ${rows.length} drawn` : ''}
          {selected.size ? ` · ${selected.size} selected` : ''}
        </p>
        <span className="inbox-toolbar-right">
          <button type="button" className="inbox-ghost" onClick={() => setShowPreview(current => !current)}>{showPreview ? 'Hide preview' : 'Show preview'}</button>
          <button type="button" className="inbox-ghost" onClick={() => setShowShortcuts(true)}>Shortcuts <kbd>?</kbd></button>
          <span className={`inbox-service-mode inbox-service-mode--${serviceMode}`}>
            {serviceMode === 'canonical' ? 'Shared review queue' : serviceMode === 'legacy' ? 'Legacy queues' : 'Connecting…'}
          </span>
        </span>
      </div>

      {selected.size > 0 && selected.size === rows.length && filtered.length > rows.length ? (
        <p className="inbox-select-hint">
          All {rows.length} drawn rows are selected.{' '}
          <button type="button" className="inbox-link" onClick={selectEveryMatch}>Select all {filtered.length} matching this filter</button>
        </p>
      ) : null}

      {actionError ? <p className="inbox-action-error" role="alert">{actionError}</p> : null}

      <div className={`inbox-body${showPreview && focusedItem ? ' inbox-body--split' : ''}`}>
        <div className="inbox-list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="stream-message inbox-empty">
              {view === 'snoozed' ? 'Nothing is snoozed.'
                : filters.query ? `Nothing matches “${filters.query}”.`
                  : filters.source === 'all' ? 'Nothing to review — the queue is clear.'
                    : 'Nothing left in this queue.'}
            </div>
          ) : groups.map(group => {
            const isCollapsed = collapsed.has(group.key)
            const shown = expanded.has(group.key) || group.items.length <= GROUP_PREVIEW ? group.items.length : GROUP_PREVIEW
            const groupSelected = group.items.every(item => selected.has(rowKey(item)))
            return (
              <div key={group.key} className="inbox-group">
                <div className="inbox-group-head">
                  <span className="inbox-group-title">
                    <input
                      type="checkbox"
                      className="inbox-check"
                      checked={groupSelected}
                      aria-label={`Select all ${group.items.length} in ${group.label}`}
                      onChange={() => setSelected(current => {
                        const next = new Set(current)
                        for (const item of group.items) {
                          if (groupSelected) next.delete(rowKey(item))
                          else next.add(rowKey(item))
                        }
                        return next
                      })}
                    />
                    <button
                      type="button"
                      className="inbox-group-toggle"
                      aria-expanded={!isCollapsed}
                      onClick={() => setCollapsed(current => {
                        const next = new Set(current)
                        if (next.has(group.key)) next.delete(group.key); else next.add(group.key)
                        return next
                      })}
                    >
                      <span className="inbox-caret" aria-hidden="true">{isCollapsed ? '▸' : '▾'}</span>
                      {group.place ? <b>{group.label}</b> : <>{group.items.length} × {group.label}</>}
                    </button>
                    {group.place ? (
                      <span className="inbox-group-sub">
                        {group.items.length} visit{group.items.length === 1 ? '' : 's'}
                        {group.place.address ? ` · ${group.place.address}` : ''}
                        {dateRange(group.items)}
                      </span>
                    ) : null}
                  </span>
                  <span className="inbox-group-actions">
                    {group.place && mapUrl(group.place) ? (
                      // You cannot confirm a place you cannot see. Opens in a new
                      // tab so a half-triaged queue is not lost to navigation.
                      <a className="inbox-action" href={mapUrl(group.place)!} target="_blank" rel="noopener noreferrer">Map</a>
                    ) : null}
                    {group.acceptable ? (
                      <button type="button" className="inbox-action inbox-action--accept" disabled={busy} onClick={() => resolve('accept', group.items)}>
                        {group.place ? `This is the place · ${group.items.length}` : `Accept all ${group.items.length}`}
                      </button>
                    ) : null}
                    {group.dismissable ? (
                      <button type="button" className="inbox-action" disabled={busy} onClick={() => resolve('dismiss', group.items)}>
                        {group.place ? 'Not a place' : `Dismiss all ${group.items.length}`}
                      </button>
                    ) : null}
                    {!group.acceptable && !group.dismissable ? <span className="inbox-group-note">Resolve individually</span> : null}
                  </span>
                </div>

                {isCollapsed ? null : (
                  <>
                    {group.items.slice(0, shown).map(item => (
                      <InboxRow
                        key={rowKey(item)}
                        item={item}
                        focused={focusKey === rowKey(item)}
                        selected={selected.has(rowKey(item))}
                        snoozedUntil={snoozed[rowKey(item)]}
                        busy={busy}
                        onToggle={toggle}
                        onFocus={setFocusKey}
                        onResolve={(verb, target) => resolve(verb, [target])}
                        onUnsnooze={target => unsnooze([target])}
                      />
                    ))}
                    {group.items.length > shown ? (
                      <button
                        type="button"
                        className="inbox-group-more"
                        onClick={() => setExpanded(current => new Set(current).add(group.key))}
                      >
                        Show all {group.items.length} — {group.items.length - shown} more hidden
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            )
          })}

          {serviceMode === 'canonical' && nextCursor ? (
            <button type="button" className="inbox-action stream-load-more" disabled={loadingMore} onClick={loadMore}>
              {loadingMore ? 'Loading…' : 'Load more review items'}
            </button>
          ) : null}
          {serviceMode === 'legacy' ? (
            <p className="inbox-read-only">The shared review service is unreachable, so canonical proposals are missing. Everything shown is still resolvable.</p>
          ) : null}
        </div>

        {showPreview && focusedItem ? (
          <InboxPreview
            item={focusedItem}
            busy={busy}
            onResolve={(verb, target, personId) => resolve(verb, [target], personId)}
            onSnooze={preset => { setSelected(new Set([rowKey(focusedItem)])); snooze(preset) }}
          />
        ) : null}
      </div>

      {actionTargets.length > 0 ? (
        <div className="inbox-bulk" role="region" aria-label="Bulk actions">
          <span className="inbox-bulk-count">
            {selectedItems.length ? `${selectedItems.length} selected` : '1 focused'}
          </span>
          {confirming ? (
            <>
              <span className="inbox-bulk-warn">
                {confirmationCount(actionTargets)} of these normally need individual review. {confirming === 'accept' ? 'Accept' : 'Dismiss'} anyway?
              </span>
              <button type="button" className="inbox-action inbox-action--accept" onClick={() => resolve(confirming, actionTargets)}>Yes, {confirming} {actionTargets.length}</button>
              <button type="button" className="inbox-action" onClick={() => setConfirming(null)}>Cancel</button>
            </>
          ) : (
            <>
              <button type="button" className="inbox-action inbox-action--accept" disabled={busy} onClick={() => request('accept')}>
                Accept {actionTargets.filter(canAccept).length} <kbd>E</kbd>
              </button>
              <button type="button" className="inbox-action" disabled={busy} onClick={() => request('dismiss')}>
                Dismiss {actionTargets.filter(canDismiss).length} <kbd>Y</kbd>
              </button>
              <span className="inbox-bulk-snooze">
                Snooze
                {SNOOZE_PRESETS.map(([key, label]) => (
                  <button key={key} type="button" className="inbox-action" onClick={() => snooze(key)}>{label}</button>
                ))}
              </span>
              <button type="button" className="inbox-ghost" onClick={() => setSelected(new Set())}>Clear <kbd>Esc</kbd></button>
            </>
          )}
        </div>
      ) : null}

      {latestBatch ? (
        <div className="inbox-toast" role="status">
          <span>
            {latestBatch.action === 'accept' ? 'Accepted' : 'Dismissed'} {latestBatch.items.length} item{latestBatch.items.length === 1 ? '' : 's'}
          </span>
          <button type="button" className="inbox-action" onClick={undo}>Undo <kbd>⌘Z</kbd></button>
          <button type="button" className="inbox-ghost" onClick={() => flush(latestBatch.id)}>Send now</button>
        </div>
      ) : null}

      {showShortcuts ? <Shortcuts onClose={() => setShowShortcuts(false)} /> : null}
    </section>
  )
}

/* ------------------------------------------------------------------ *
 * Rows
 * ------------------------------------------------------------------ */

function InboxRow({ item, focused, selected, snoozedUntil, busy, onToggle, onFocus, onResolve, onUnsnooze }: {
  item: InboxItem
  focused: boolean
  selected: boolean
  snoozedUntil?: string
  busy: boolean
  onToggle: (key: string, extend: boolean) => void
  onFocus: (key: string) => void
  onResolve: (action: InboxVerb, item: InboxItem) => void
  onUnsnooze: (item: InboxItem) => void
}) {
  const key = rowKey(item)
  const blocked = blockedReason(item)
  return (
    <article
      data-row-key={key}
      className={`inbox-row${focused ? ' inbox-row--focused' : ''}${selected ? ' inbox-row--selected' : ''}`}
      aria-selected={selected}
      onClick={() => onFocus(key)}
    >
      <input
        type="checkbox"
        className="inbox-check"
        checked={selected}
        aria-label={`Select ${item.title}`}
        onClick={event => { event.stopPropagation(); onToggle(key, event.shiftKey) }}
        onChange={() => { /* click handles it so shift is observable */ }}
      />
      <div className="inbox-row-leading">
        <span className="stream-type-badge">{item.source}</span>
        <span className="inbox-primitive">{labelize(item.primitive)}</span>
      </div>
      <div className="stream-row-body">
        <div className="stream-row-title">{item.title}</div>
        <div className="stream-row-detail">{item.detail}</div>
        {blocked ? <div className="inbox-row-blocked">{blocked}</div> : null}
      </div>
      <div className="inbox-row-trailing">
        <time className="stream-row-date" dateTime={item.timestamp}>{formatDate(item.timestamp)}</time>
        <span className="inbox-confidence">{item.confidence == null ? 'Needs judgment' : `${Math.round(item.confidence * 100)}% confidence`}</span>
        <div className="inbox-row-actions">
          {snoozedUntil ? (
            <button type="button" className="inbox-action" onClick={event => { event.stopPropagation(); onUnsnooze(item) }}>Unsnooze</button>
          ) : null}
          {canAccept(item) ? (
            <button type="button" className="inbox-action inbox-action--accept" disabled={busy} onClick={event => { event.stopPropagation(); onResolve('accept', item) }}>
              {acceptLabel(item)}
            </button>
          ) : null}
          {canCancel(item) ? (
            <button type="button" className="inbox-action" disabled={busy} onClick={event => { event.stopPropagation(); onResolve('cancelled', item) }}>Cancelled</button>
          ) : null}
          {canDismiss(item) ? (
            <button type="button" className="inbox-action" disabled={busy} onClick={event => { event.stopPropagation(); onResolve('dismiss', item) }}>
              {dismissLabel(item)}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  )
}

/* ------------------------------------------------------------------ *
 * Preview
 * ------------------------------------------------------------------ */

function InboxPreview({ item, busy, onResolve, onSnooze }: {
  item: InboxItem
  busy: boolean
  onResolve: (action: InboxVerb, item: InboxItem, personId?: string) => void
  onSnooze: (preset: string) => void
}) {
  const blocked = blockedReason(item)
  return (
    <aside className="inbox-preview" aria-label="Focused item">
      <div className="inbox-preview-head">
        <span className="stream-type-badge">{item.source}</span>
        <span className="inbox-primitive">{labelize(item.primitive)}</span>
        <time className="stream-row-date" dateTime={item.timestamp}>{formatDate(item.timestamp)}</time>
      </div>
      <h2 className="inbox-preview-title">{item.title}</h2>
      <p className="inbox-preview-detail">{item.detail}</p>

      <dl className="inbox-preview-meta">
        <div><dt>Confidence</dt><dd>{item.confidence == null ? 'Not scored' : `${Math.round(item.confidence * 100)}%`}</dd></div>
        <div><dt>Risk tier</dt><dd>{labelize(item.riskTier ?? 'legacy')}</dd></div>
        <div><dt>Priority</dt><dd>{item.priority}</dd></div>
        {item.place?.address ? <div><dt>Address</dt><dd>{item.place.address}</dd></div> : null}
      </dl>

      {item.place && mapUrl(item.place) ? (
        <a className="inbox-action" href={mapUrl(item.place)!} target="_blank" rel="noopener noreferrer">View on map</a>
      ) : null}

      <div className="inbox-preview-actions">
        {canAccept(item) ? (
          <button type="button" className="inbox-action inbox-action--accept" disabled={busy} onClick={() => onResolve('accept', item)}>{acceptLabel(item)}</button>
        ) : null}
        {canCancel(item) ? <button type="button" className="inbox-action" disabled={busy} onClick={() => onResolve('cancelled', item)}>Cancelled</button> : null}
        {canDismiss(item) ? (
          <button type="button" className="inbox-action" disabled={busy} onClick={() => onResolve('dismiss', item)}>{dismissLabel(item)}</button>
        ) : null}
      </div>

      {blocked ? (
        <PersonAssign item={item} note={blocked} busy={busy} onAssign={personId => onResolve('accept', item, personId)} />
      ) : null}

      <div className="inbox-preview-snooze">
        <span>Snooze</span>
        {SNOOZE_PRESETS.map(([key, label]) => (
          <button key={key} type="button" className="inbox-action" onClick={() => onSnooze(key)}>{label}</button>
        ))}
      </div>
    </aside>
  )
}

/**
 * A staged message and an unresolved file mention are both blocked on the same
 * missing fact: which Person this is. Asking for it here is what turns the
 * largest un-actionable queue in the inbox into a two-keystroke decision.
 */
function PersonAssign({ item, note, busy, onAssign }: {
  item: InboxItem
  note: string
  busy: boolean
  onAssign: (personId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [people, setPeople] = useState<{ id: string; first: string; last: string; detail: string }[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) { setPeople([]); return }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setSearching(true)
      fetch(`/api/communications/people?search=${encodeURIComponent(term)}`, { signal: controller.signal })
        .then(response => response.json() as Promise<{ people?: typeof people }>)
        .then(body => setPeople(body.people ?? []))
        .catch(() => { /* an aborted keystroke is not an error worth showing */ })
        .finally(() => setSearching(false))
    }, 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query])

  // Only communications accept against a Person through this endpoint today.
  if (item.sourceKey !== 'staged_interaction') return <p className="inbox-row-blocked">{note}</p>

  return (
    <div className="inbox-assign">
      <label className="inbox-assign-label" htmlFor={`assign-${item.id}`}>{note}</label>
      <input
        id={`assign-${item.id}`}
        type="search"
        value={query}
        placeholder="Search people…"
        onChange={event => setQuery(event.target.value)}
      />
      {searching ? <p className="inbox-assign-note">Searching…</p> : null}
      {people.map(person => (
        <button key={person.id} type="button" className="inbox-assign-option" disabled={busy} onClick={() => onAssign(person.id)}>
          <b>{[person.first, person.last].filter(Boolean).join(' ')}</b>
          {person.detail ? <span>{person.detail}</span> : null}
        </button>
      ))}
      {query.trim().length >= 2 && !searching && people.length === 0 ? <p className="inbox-assign-note">No one matches.</p> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Chrome
 * ------------------------------------------------------------------ */

function Filter({ label, value, options, onChange }: {
  label: string
  value: string
  options: readonly (readonly [string, string])[]
  onChange: (value: string) => void
}) {
  // aria-label rather than leaning on the wrapping <label>: the label element
  // contains the option text too, so the computed accessible name came out as
  // "AgeAny ageOlder than 1 day…" — unusable to a screen reader, and ambiguous
  // to anything matching on it.
  return (
    <label className="inbox-filter">
      <span>{label}</span>
      <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>
        {options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
      </select>
    </label>
  )
}

const SHORTCUTS: [string, string][] = [
  ['J / K', 'Move down / up'],
  ['⇧J / ⇧K', 'Extend the selection'],
  ['X', 'Select the focused row'],
  ['⇧click', 'Select a range'],
  ['⌘A', 'Select every drawn row'],
  ['E', 'Accept'],
  ['Y or #', 'Dismiss'],
  ['H', 'Snooze until tomorrow'],
  ['U / ⌘Z', 'Undo the last action'],
  ['/ or ⌘K', 'Search'],
  ['1 – 9', 'Jump to a queue'],
  ['P', 'Toggle the preview pane'],
  ['Esc', 'Clear the selection'],
  ['?', 'This list'],
]

function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <div className="inbox-modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={onClose}>
      <div className="inbox-modal-card" onClick={event => event.stopPropagation()}>
        <h2>Keyboard</h2>
        <dl className="inbox-shortcuts">
          {SHORTCUTS.map(([keys, description]) => (
            <div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{description}</dd></div>
          ))}
        </dl>
        <button type="button" className="inbox-action" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}

/** Row keys contain colons, which a bare attribute selector will not take. */
function cssEscape(value: string) {
  const escape = (globalThis as { CSS?: { escape?: (input: string) => string } }).CSS?.escape
  return escape ? escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, match => `\\${match}`)
}
