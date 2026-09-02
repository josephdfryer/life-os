export type StreamStatus = "streaming" | "stale" | "error" | "silent" | "not_connected"
export type StreamFamily = "cloud" | "device"

export type StreamSpec = {
  kind: string
  family: StreamFamily
  label: string
  description: string
  staleAfterMs: number
  laptopBound: boolean
  graphSources: readonly string[]
  connectionKind?: string
  deviceSource?: string
  repairHref: string
  repairLabel: string
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const STREAM_SPECS: readonly StreamSpec[] = [
  {
    kind: "calendar",
    family: "cloud",
    label: "Google Calendar",
    description: "Plans and attendance from each connected calendar.",
    staleAfterMs: 90 * MINUTE,
    laptopBound: false,
    graphSources: ["calendar"],
    connectionKind: "calendar",
    repairHref: "/admin/connections",
    repairLabel: "Connections",
  },
  {
    kind: "gmail",
    family: "cloud",
    label: "Gmail",
    description: "Mail matched to People. Local agent hits production every 4 hours.",
    staleAfterMs: 8 * HOUR,
    laptopBound: true,
    graphSources: ["gmail"],
    connectionKind: "gmail",
    repairHref: "/admin/connections",
    repairLabel: "Connections",
  },
  {
    kind: "meetings",
    family: "cloud",
    label: "Granola",
    description: "Meeting notes, transcripts, and attendee review.",
    staleAfterMs: 26 * HOUR,
    laptopBound: false,
    graphSources: ["granola"],
    connectionKind: "meetings",
    repairHref: "/admin/connections",
    repairLabel: "Connections",
  },
  {
    kind: "era",
    family: "cloud",
    label: "Era",
    description: "Accounts and transactions into finance Interactions.",
    staleAfterMs: 8 * HOUR,
    laptopBound: false,
    graphSources: ["era"],
    connectionKind: "era",
    repairHref: "/admin/connections",
    repairLabel: "Connections",
  },
  {
    kind: "oura",
    family: "cloud",
    label: "Oura",
    description: "Daily readiness, sleep, activity, and stress scores.",
    staleAfterMs: 26 * HOUR,
    laptopBound: false,
    graphSources: ["oura"],
    connectionKind: "oura",
    repairHref: "/admin/connections",
    repairLabel: "Connections",
  },
  {
    kind: "imessage",
    family: "device",
    label: "iMessage",
    description: "Messages from Companion or the local watcher.",
    staleAfterMs: 30 * MINUTE,
    laptopBound: true,
    graphSources: ["imessage"],
    deviceSource: "imessage",
    repairHref: "/device/authorize",
    repairLabel: "Authorize a device",
  },
  {
    kind: "whatsapp",
    family: "device",
    label: "WhatsApp",
    description: "One-to-one messages from Companion or the Mac agent.",
    staleAfterMs: 30 * MINUTE,
    laptopBound: true,
    graphSources: ["whatsapp"],
    deviceSource: "whatsapp",
    repairHref: "/device/authorize",
    repairLabel: "Authorize a device",
  },
  {
    kind: "healthkit",
    family: "device",
    label: "HealthKit",
    description: "Daily aggregates and workouts from the iPhone collector.",
    staleAfterMs: 26 * HOUR,
    laptopBound: false,
    graphSources: ["healthkit"],
    deviceSource: "healthkit",
    repairHref: "/device/authorize",
    repairLabel: "Authorize a device",
  },
  {
    kind: "location",
    family: "device",
    label: "Location",
    description: "Derived visits from significant-change location.",
    staleAfterMs: 26 * HOUR,
    laptopBound: false,
    graphSources: ["location"],
    deviceSource: "location",
    repairHref: "/device/authorize",
    repairLabel: "Authorize a device",
  },
  {
    kind: "contacts",
    family: "device",
    label: "Contacts",
    description: "Address-book imports staged for People review.",
    staleAfterMs: 7 * DAY,
    laptopBound: false,
    graphSources: ["contacts"],
    deviceSource: "contacts",
    repairHref: "/device/authorize",
    repairLabel: "Authorize a device",
  },
  {
    kind: "photos",
    family: "device",
    label: "Photos",
    description: "Photo metadata from the Mac agent or Companion.",
    staleAfterMs: 26 * HOUR,
    laptopBound: true,
    graphSources: ["photos"],
    deviceSource: "photos",
    repairHref: "/device/authorize",
    repairLabel: "Authorize a device",
  },
  {
    kind: "voice_journal",
    family: "device",
    label: "Voice journal",
    description: "Normalized transcripts, not raw recordings.",
    staleAfterMs: 45 * MINUTE,
    laptopBound: true,
    graphSources: ["voice_journal"],
    deviceSource: "voice_journal",
    repairHref: "/device/authorize",
    repairLabel: "Authorize a device",
  },
  {
    kind: "documents",
    family: "device",
    label: "Documents",
    description: "Document metadata and extracted text.",
    staleAfterMs: 45 * MINUTE,
    laptopBound: true,
    graphSources: ["documents"],
    deviceSource: "documents",
    repairHref: "/device/authorize",
    repairLabel: "Authorize a device",
  },
]

export const STREAM_GRAPH_SOURCES = [...new Set(STREAM_SPECS.flatMap(spec => spec.graphSources))]

export type ConnectionSignal = {
  id: string
  kind: string
  status: string
  accountEmail: string | null
  label: string | null
  lastSyncedAt: Date | null
  lastError: string | null
}

export type DeviceSourceSignal = {
  deviceId: string
  deviceName: string
  revokedAt: Date | null
  source: string
  enabled: boolean
  permissionStatus: string
  lastSuccessAt: Date | null
  lastErrorCode: string | null
}

export type SourceInstant = { source: string; at: Date }
export type SourceVolume = { source: string; accepted: number; staged: number; failed: number }

export type StreamRow = {
  id: string
  spec: StreamSpec
  title: string
  detail: string
  status: StreamStatus
  connected: boolean
  collectorAt: Date | null
  arrivalAt: Date | null
  collectorError: string | null
  accepted24h: number
  staged24h: number
  failed24h: number
}

export function classifyStream(input: {
  connected: boolean
  collectorAt: Date | null
  collectorError: string | null
  arrivalAt: Date | null
  staleAfterMs: number
  now?: number
}): StreamStatus {
  const now = input.now ?? Date.now()
  const fresh = (at: Date | null) => at != null && now - at.getTime() <= input.staleAfterMs
  const arrivalFresh = fresh(input.arrivalAt)
  if (!input.connected) return "not_connected"
  if (input.collectorError && !arrivalFresh) return "error"
  if (arrivalFresh) return "streaming"
  if (fresh(input.collectorAt)) return "silent"
  return "stale"
}

export function latestForSources(points: readonly SourceInstant[], sources: readonly string[]): Date | null {
  let latest: Date | null = null
  const wanted = new Set(sources)
  for (const point of points) {
    if (!wanted.has(point.source)) continue
    if (!latest || point.at.getTime() > latest.getTime()) latest = point.at
  }
  return latest
}

export function volumeForSources(rows: readonly SourceVolume[], sources: readonly string[]) {
  const wanted = new Set(sources)
  return rows.reduce(
    (sum, row) => {
      if (!wanted.has(row.source)) return sum
      return {
        accepted: sum.accepted + row.accepted,
        staged: sum.staged + row.staged,
        failed: sum.failed + row.failed,
      }
    },
    { accepted: 0, staged: 0, failed: 0 },
  )
}

export function assembleStreamRows(input: {
  connections: readonly ConnectionSignal[]
  devices: readonly DeviceSourceSignal[]
  arrivals: readonly SourceInstant[]
  volumes: readonly SourceVolume[]
  now?: number
}): StreamRow[] {
  const rows: StreamRow[] = []
  for (const spec of STREAM_SPECS) {
    const arrivalAt = latestForSources(input.arrivals, spec.graphSources)
    const volume = volumeForSources(input.volumes, spec.graphSources)
    let produced = 0

    if (spec.connectionKind) {
      for (const connection of input.connections.filter(row => row.kind === spec.connectionKind)) {
        produced += 1
        const connected = connection.status === "active"
        rows.push(makeRow({
          id: `connection:${connection.id}`,
          spec,
          title: connection.label || connection.accountEmail || spec.label,
          detail: connection.accountEmail && connection.label ? connection.accountEmail : spec.description,
          connected,
          collectorAt: connection.lastSyncedAt,
          collectorError: connection.lastError,
          arrivalAt,
          volume,
          now: input.now,
        }))
      }
    }

    if (spec.deviceSource) {
      for (const device of input.devices.filter(row => row.source === spec.deviceSource && !row.revokedAt)) {
        produced += 1
        const permissionBlocked = device.permissionStatus === "denied" || device.permissionStatus === "revoked"
        rows.push(makeRow({
          id: `device:${device.deviceId}:${device.source}`,
          spec,
          title: `${spec.label} · ${device.deviceName}`,
          detail: permissionBlocked ? `Permission ${device.permissionStatus}` : spec.description,
          connected: device.enabled,
          collectorAt: device.lastSuccessAt,
          collectorError: device.lastErrorCode ?? (permissionBlocked ? `Permission ${device.permissionStatus}` : null),
          arrivalAt,
          volume,
          now: input.now,
        }))
      }
    }

    if (produced === 0 && arrivalAt) {
      rows.push(makeRow({
        id: `arrival:${spec.kind}`,
        spec,
        title: spec.label,
        detail: spec.description,
        connected: true,
        collectorAt: null,
        collectorError: null,
        arrivalAt,
        volume,
        now: input.now,
      }))
      produced += 1
    }

    if (produced === 0) {
      rows.push(makeRow({
        id: `expected:${spec.kind}`,
        spec,
        title: spec.label,
        detail: spec.description,
        connected: false,
        collectorAt: null,
        collectorError: null,
        arrivalAt: null,
        volume,
        now: input.now,
      }))
    }
  }
  return rows
}

function makeRow(input: {
  id: string
  spec: StreamSpec
  title: string
  detail: string
  connected: boolean
  collectorAt: Date | null
  collectorError: string | null
  arrivalAt: Date | null
  volume: { accepted: number; staged: number; failed: number }
  now?: number
}): StreamRow {
  return {
    id: input.id,
    spec: input.spec,
    title: input.title,
    detail: input.detail,
    status: classifyStream({
      connected: input.connected,
      collectorAt: input.collectorAt,
      collectorError: input.collectorError,
      arrivalAt: input.arrivalAt,
      staleAfterMs: input.spec.staleAfterMs,
      now: input.now,
    }),
    connected: input.connected,
    collectorAt: input.collectorAt,
    arrivalAt: input.arrivalAt,
    collectorError: input.collectorError,
    accepted24h: input.volume.accepted,
    staged24h: input.volume.staged,
    failed24h: input.volume.failed,
  }
}

export function summarizeStreamRows(rows: readonly StreamRow[]) {
  return {
    streaming: rows.filter(row => row.status === "streaming").length,
    stale: rows.filter(row => row.status === "stale").length,
    error: rows.filter(row => row.status === "error").length,
    silent: rows.filter(row => row.status === "silent").length,
    notConnected: rows.filter(row => row.status === "not_connected").length,
    needsAttention: rows.filter(row => row.status === "stale" || row.status === "error" || row.status === "silent").length,
  }
}

export function describeDatabaseStore(url = process.env.DATABASE_URL) {
  if (!url) return { label: "Unknown store", neon: false }
  let host = ""
  try {
    host = new URL(url).hostname
  } catch {
    return { label: "Invalid DATABASE_URL", neon: false }
  }
  if (host.includes("neon.tech")) return { label: `Neon · ${host}`, neon: true }
  if (host === "localhost" || host === "127.0.0.1") return { label: "PostgreSQL · local", neon: false }
  return { label: `PostgreSQL · ${host}`, neon: false }
}

export const STREAM_STATUS_LABEL: Record<StreamStatus, string> = {
  streaming: "Streaming",
  stale: "Stale",
  error: "Error",
  silent: "Silent",
  not_connected: "Not connected",
}

const STREAM_STATUS_RANK: Record<StreamStatus, number> = {
  error: 0,
  silent: 1,
  stale: 2,
  streaming: 3,
  not_connected: 4,
}

export function sortStreamRows(rows: readonly StreamRow[]) {
  return [...rows].sort((left, right) => {
    const rank = STREAM_STATUS_RANK[left.status] - STREAM_STATUS_RANK[right.status]
    if (rank !== 0) return rank
    return left.title.localeCompare(right.title)
  })
}

export function streamDetailPath(id: string) {
  return `/admin/health/streams/${encodeURIComponent(id)}`
}

export function formatStreamAge(value: Date | null, now = Date.now()) {
  if (!value) return "Never"
  const elapsed = Math.max(0, now - value.getTime())
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
