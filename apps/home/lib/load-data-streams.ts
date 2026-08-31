import { db } from "@life-os/db"
import {
  assembleStreamRows,
  describeDatabaseStore,
  STREAM_GRAPH_SOURCES,
  summarizeStreamRows,
  type SourceInstant,
  type SourceVolume,
} from "./data-streams"

const DAY_MS = 24 * 60 * 60 * 1000

export async function loadDataStreams(workspaceId: string) {
  const since = new Date(Date.now() - DAY_MS)
  const [
    workspace,
    connections,
    devices,
    interactionLatest,
    stagedLatest,
    ingestLatest,
    stateLatest,
    interactionVolume,
    stagedVolume,
    ingestFailed,
  ] = await Promise.all([
    db.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, name: true, slug: true, ownerUser: { select: { email: true } } },
    }),
    db.connection.findMany({
      where: { workspaceId },
      orderBy: [{ kind: "asc" }, { accountEmail: "asc" }],
      select: {
        id: true,
        kind: true,
        status: true,
        accountEmail: true,
        label: true,
        lastSyncedAt: true,
        lastError: true,
      },
    }),
    db.device.findMany({
      where: { workspaceId },
      orderBy: { displayName: "asc" },
      select: {
        id: true,
        displayName: true,
        revokedAt: true,
        sources: {
          orderBy: { source: "asc" },
          select: {
            source: true,
            enabled: true,
            permissionStatus: true,
            lastSuccessAt: true,
            lastErrorCode: true,
          },
        },
      },
    }),
    db.interaction.groupBy({
      by: ["source"],
      where: { workspaceId, source: { in: [...STREAM_GRAPH_SOURCES] } },
      _max: { createdAt: true },
    }),
    db.stagedInteraction.groupBy({
      by: ["source"],
      where: { workspaceId, source: { in: [...STREAM_GRAPH_SOURCES] } },
      _max: { createdAt: true },
    }),
    db.deviceIngestItem.groupBy({
      by: ["source"],
      where: { workspaceId, source: { in: [...STREAM_GRAPH_SOURCES] } },
      _max: { createdAt: true },
    }),
    db.state.groupBy({
      by: ["source"],
      where: { workspaceId, source: { in: [...STREAM_GRAPH_SOURCES] } },
      _max: { createdAt: true },
    }),
    db.interaction.groupBy({
      by: ["source"],
      where: { workspaceId, source: { in: [...STREAM_GRAPH_SOURCES] }, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    db.stagedInteraction.groupBy({
      by: ["source"],
      where: { workspaceId, source: { in: [...STREAM_GRAPH_SOURCES] }, status: "pending", createdAt: { gte: since } },
      _count: { _all: true },
    }),
    db.deviceIngestItem.groupBy({
      by: ["source"],
      where: { workspaceId, source: { in: [...STREAM_GRAPH_SOURCES] }, status: { in: ["rejected", "retryable"] }, createdAt: { gte: since } },
      _count: { _all: true },
    }),
  ])

  const arrivals = mergeLatest([
    toInstants(interactionLatest),
    toInstants(stagedLatest),
    toInstants(ingestLatest),
    toInstants(stateLatest),
  ])
  const volumes = mergeVolumes(interactionVolume, stagedVolume, ingestFailed)
  const rows = assembleStreamRows({
    connections,
    devices: devices.flatMap(device => device.sources.map(source => ({
      deviceId: device.id,
      deviceName: device.displayName,
      revokedAt: device.revokedAt,
      source: source.source,
      enabled: source.enabled,
      permissionStatus: source.permissionStatus,
      lastSuccessAt: source.lastSuccessAt,
      lastErrorCode: source.lastErrorCode,
    }))),
    arrivals,
    volumes,
  })

  return {
    workspace: {
      id: workspace?.id ?? workspaceId,
      name: workspace?.name ?? workspaceId,
      slug: workspace?.slug ?? workspaceId,
      ownerEmail: workspace?.ownerUser?.email ?? null,
    },
    store: describeDatabaseStore(),
    rows,
    summary: summarizeStreamRows(rows),
  }
}

function toInstants(rows: Array<{ source: string | null; _max: { createdAt: Date | null } }>): SourceInstant[] {
  return rows.flatMap(row => {
    if (!row.source || !row._max.createdAt) return []
    return [{ source: row.source, at: row._max.createdAt }]
  })
}

function mergeLatest(groups: SourceInstant[][]): SourceInstant[] {
  const latest = new Map<string, Date>()
  for (const group of groups) {
    for (const point of group) {
      const current = latest.get(point.source)
      if (!current || point.at.getTime() > current.getTime()) latest.set(point.source, point.at)
    }
  }
  return [...latest.entries()].map(([source, at]) => ({ source, at }))
}

function mergeVolumes(
  accepted: Array<{ source: string | null; _count: { _all: number } }>,
  staged: Array<{ source: string | null; _count: { _all: number } }>,
  failed: Array<{ source: string | null; _count: { _all: number } }>,
): SourceVolume[] {
  const volumes = new Map<string, SourceVolume>()
  const take = (source: string | null) => {
    if (!source) return null
    const existing = volumes.get(source) ?? { source, accepted: 0, staged: 0, failed: 0 }
    volumes.set(source, existing)
    return existing
  }
  for (const row of accepted) {
    const volume = take(row.source)
    if (volume) volume.accepted = row._count._all
  }
  for (const row of staged) {
    const volume = take(row.source)
    if (volume) volume.staged = row._count._all
  }
  for (const row of failed) {
    const volume = take(row.source)
    if (volume) volume.failed = row._count._all
  }
  return [...volumes.values()]
}
