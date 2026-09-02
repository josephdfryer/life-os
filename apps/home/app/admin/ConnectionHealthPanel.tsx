import {
  formatStreamAge,
  sortStreamRows,
  STREAM_STATUS_LABEL,
  streamDetailPath,
  type StreamRow,
  type StreamStatus,
} from "@/lib/data-streams"
import type { loadDataStreams } from "@/lib/load-data-streams"
import type { StreamEvent, SystemHealth } from "@/lib/load-system-health"
import { AdminBreadcrumb } from "./AdminChrome"

type DataStreams = Awaited<ReturnType<typeof loadDataStreams>>

export function ConnectionHealthPanel({ streams, spine }: { streams: DataStreams; spine: SystemHealth }) {
  const { workspace, store, rows, summary } = streams
  const sorted = sortStreamRows(rows)
  const failedReceipts = spine.receipts.failed ?? 0
  const waitingReceipts = (spine.receipts.pending ?? 0) + (spine.receipts.processing ?? 0)
  const spineAttention = failedReceipts > 0 || spine.failedReviews > 0 || spine.failedRuleRuns > 0
  const headline = summary.error || summary.silent || summary.stale || spineAttention
    ? { label: "Needs attention", className: "system-state-attention", detail: healthDetail(summary, spineAttention) }
    : summary.streaming > 0
      ? { label: "Streaming", className: "system-state-healthy", detail: `${summary.streaming} connection${summary.streaming === 1 ? "" : "s"} delivered a record inside its freshness window.` }
      : { label: "Nothing connected", className: "system-state-idle", detail: "Expected accounts and devices are listed below so a missing source is visible." }

  const cloud = sorted.filter(row => row.spec.family === "cloud")
  const device = sorted.filter(row => row.spec.family === "device")

  return (
    <section className="connection-health" aria-labelledby="system-health-heading">
      <div className={`system-health-state ${headline.className}`}>
        <div>
          <p className="still-eyebrow">System health</p>
          <h2 id="system-health-heading">{headline.label}</h2>
          <p>{headline.detail}</p>
        </div>
        <div>
          <span>This workspace</span>
          <strong>{workspace.name}</strong>
          <small>{workspace.ownerEmail ?? workspace.slug} · {store.label}</small>
        </div>
      </div>

      <div className="system-health-metrics" aria-label="System health metrics">
        <HealthMetric label="Streaming" value={summary.streaming} detail="Collector and graph both fresh" />
        <HealthMetric label="Needs attention" value={summary.needsAttention} detail={`${summary.stale} stale · ${summary.silent} silent · ${summary.error} error`} attention={summary.needsAttention > 0} />
        <HealthMetric label="Not connected" value={summary.notConnected} detail="Expected sources with no account or device" />
        <HealthMetric label="Event spine" value={failedReceipts + spine.failedReviews + spine.failedRuleRuns} detail={spine.oldestPendingAt ? `Queue ${formatStreamAge(spine.oldestPendingAt)}` : `${spine.eventCount} GraphEvents · ${waitingReceipts} waiting`} attention={spineAttention} />
      </div>

      <StreamFamily heading="Cloud streams" eyebrow="OAuth and API keys" rows={cloud} />
      <StreamFamily heading="Device streams" eyebrow="Companion, LaunchAgents, watchers" rows={device} />
      <SpineEvents health={spine} />
    </section>
  )
}

function StreamFamily({ heading, eyebrow, rows }: { heading: string; eyebrow: string; rows: StreamRow[] }) {
  return (
    <>
      <div className="admin-section-heading">
        <div>
          <p className="still-eyebrow">{eyebrow}</p>
          <h2>{heading}</h2>
        </div>
        <span className="stream-count">{rows.length} listed</span>
      </div>
      <div className="connection-health-table" aria-label={heading}>
        <div className="connection-health-head">
          <span>Stream</span>
          <span>Last data</span>
          <span>Last collector</span>
          <span>Last 24h</span>
          <span>Status</span>
        </div>
        {rows.map(row => (
          <a className={`connection-health-row connection-health-${row.status}`} href={streamDetailPath(row.id)} key={row.id}>
            <span>
              <strong>{row.title}</strong>
              <small>{row.detail}</small>
            </span>
            <span>{formatStreamAge(row.arrivalAt)}</span>
            <span>
              {formatStreamAge(row.collectorAt)}
              {row.collectorError ? <small className="data-stream-error">{truncateError(row.collectorError)}</small> : null}
            </span>
            <span>{row.accepted24h} accepted</span>
            <span><StatusPill status={row.status} /></span>
          </a>
        ))}
      </div>
    </>
  )
}

export function StreamDetailPanel({ row, events }: { row: StreamRow; events: StreamEvent[] }) {
  return (
    <section className="data-streams" aria-labelledby="stream-detail-heading">
      <AdminBreadcrumb items={[
        { href: "/admin/health", label: "System health" },
        { label: row.title },
      ]} />
      <article className={`data-stream-detail data-stream-${row.status}`}>
        <div className={`system-health-state ${row.status === "streaming" ? "system-state-healthy" : row.status === "not_connected" ? "system-state-idle" : "system-state-attention"}`}>
          <div>
            <p className="still-eyebrow">{row.spec.family === "cloud" ? "Cloud account" : "Device collector"}</p>
            <h2 id="stream-detail-heading">{row.title}</h2>
            <p>{row.detail}</p>
          </div>
          <div>
            <span>Status</span>
            <strong>{STREAM_STATUS_LABEL[row.status]}</strong>
            <small>Fresh within {formatWindow(row.spec.staleAfterMs)}</small>
          </div>
        </div>
        <div className="system-health-metrics" aria-label={`${row.title} freshness`}>
          <HealthMetric label="Last data" value={null} detail={formatStreamAge(row.arrivalAt)} />
          <HealthMetric label="Last collector" value={null} detail={formatStreamAge(row.collectorAt)} />
          <HealthMetric label="Accepted 24h" value={row.accepted24h} detail={`${row.staged24h} staged · ${row.failed24h} failed`} attention={row.failed24h > 0} />
          <HealthMetric label="Repair" value={null} detail={row.spec.laptopBound ? "Laptop-bound collector" : row.spec.family === "cloud" ? "Account connection" : "Device permission"} />
        </div>
        {row.collectorError ? <p className="data-stream-error-block">{row.collectorError}</p> : null}
        <div className="admin-section-tools" style={{ marginTop: 18 }}>
          <a className="still-button still-button-secondary" href={row.spec.repairHref}>{row.spec.repairLabel}</a>
          <a className="still-button still-button-secondary" href="/admin/connections">Manage connections</a>
        </div>
      </article>
      <div className="admin-section-heading">
        <div>
          <p className="still-eyebrow">Recent activity</p>
          <h2>Canonical events</h2>
        </div>
        <span className="stream-count">{events.length} shown</span>
      </div>
      {events.length === 0
        ? <div className="stream-message">No GraphEvents from this source yet. Accepted records still appear as last data above.</div>
        : <EventList events={events} />}
    </section>
  )
}

function SpineEvents({ health }: { health: SystemHealth }) {
  return (
    <>
      <div className="admin-section-heading">
        <div>
          <p className="still-eyebrow">Event spine</p>
          <h2>Canonical events</h2>
        </div>
        <span className="stream-count">{health.recentEvents.length} shown</span>
      </div>
      {health.recentEvents.length === 0
        ? <div className="stream-message">No GraphEvents recorded. The first shared command that publishes one will appear here with its consumer receipts.</div>
        : <EventList events={health.recentEvents} />}
    </>
  )
}

function EventList({ events }: { events: StreamEvent[] }) {
  return (
    <div className="stream-list">
      {events.map(event => (
        <article className="system-event-row" key={event.id}>
          <time dateTime={event.recordedAt.toISOString()}>{formatDate(event.recordedAt)}</time>
          <div>
            <strong>{event.eventType}</strong>
            <span>{event.subjectType} · {event.sourceConnector || "canonical command"}</span>
          </div>
          <div>
            {event.receipts.length === 0
              ? <span className="system-receipt system-receipt-missing">No receipts</span>
              : event.receipts.map(receipt => (
                <span className={`system-receipt system-receipt-${receipt.status}`} title={receipt.lastError || undefined} key={receipt.id}>
                  {receipt.consumer} · {receipt.status} · {receipt.attempts}
                </span>
              ))}
          </div>
        </article>
      ))}
    </div>
  )
}

function HealthMetric({ label, value, detail, attention = false }: { label: string; value: number | null; detail: string; attention?: boolean }) {
  return (
    <div className={attention ? "system-health-metric system-health-metric-attention" : "system-health-metric"}>
      <span>{label}</span>
      {value == null ? <strong className="system-health-metric-text">{detail}</strong> : <><strong>{value}</strong><small>{detail}</small></>}
    </div>
  )
}

function StatusPill({ status }: { status: StreamStatus }) {
  return <span className={`data-stream-status data-stream-status-${status}`}>{STREAM_STATUS_LABEL[status]}</span>
}

function healthDetail(summary: DataStreams["summary"], spineAttention: boolean) {
  const parts = [
    summary.error ? `${summary.error} in error` : null,
    summary.silent ? `${summary.silent} silent` : null,
    summary.stale ? `${summary.stale} stale` : null,
    spineAttention ? "event spine reported a failure" : null,
  ].filter(Boolean)
  return `${parts.join(", ")}. Silent means the collector reported success but nothing landed in this workspace.`
}

function truncateError(value: string) {
  const firstLine = value.split(/\n/)[0]?.trim() ?? value
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine
}

function formatWindow(ms: number) {
  const hours = ms / 3_600_000
  if (hours < 1) return `${Math.round(ms / 60_000)} minutes`
  if (hours < 24) return `${Math.round(hours)} hours`
  return `${Math.round(hours / 24)} days`
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(value)
}
