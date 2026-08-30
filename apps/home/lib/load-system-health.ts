import { db } from "@life-os/db"

const eventSelect = {
  id: true,
  eventType: true,
  subjectType: true,
  subjectId: true,
  recordedAt: true,
  sourceConnector: true,
  receipts: {
    take: 10,
    orderBy: { createdAt: "asc" as const },
    select: { id: true, consumer: true, status: true, attempts: true, lastError: true, nextRetryAt: true, processedAt: true },
  },
}

export async function loadSystemHealth(workspaceId: string) {
  const [eventCount, recentEvents, receiptGroups, oldestPendingReceipt, pendingReviews, failedReviews, failedRuleRuns] = await Promise.all([
    db.graphEvent.count({ where: { workspaceId } }),
    db.graphEvent.findMany({
      where: { workspaceId },
      orderBy: { recordedAt: "desc" },
      take: 12,
      select: eventSelect,
    }),
    db.graphEventReceipt.groupBy({ by: ["status"], where: { event: { workspaceId } }, _count: { _all: true } }),
    db.graphEventReceipt.findFirst({
      where: { event: { workspaceId }, status: { in: ["pending", "processing", "failed"] } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    db.reviewItem.count({ where: { workspaceId, status: "pending" } }),
    db.reviewItem.count({ where: { workspaceId, status: "failed" } }),
    db.ruleRun.count({ where: { workspaceId, status: { in: ["failed", "error"] } } }),
  ])
  const receipts = Object.fromEntries(receiptGroups.map(group => [group.status, group._count._all]))
  const receiptCount = Object.values(receipts).reduce((sum, count) => sum + count, 0)
  return {
    eventCount,
    recentEvents,
    receiptCount,
    receipts,
    oldestPendingAt: oldestPendingReceipt?.createdAt ?? null,
    pendingReviews,
    failedReviews,
    failedRuleRuns,
  }
}

export async function loadStreamEvents(workspaceId: string, sources: readonly string[]) {
  if (sources.length === 0) return []
  return db.graphEvent.findMany({
    where: { workspaceId, sourceConnector: { in: [...sources] } },
    orderBy: { recordedAt: "desc" },
    take: 8,
    select: eventSelect,
  })
}

export type SystemHealth = Awaited<ReturnType<typeof loadSystemHealth>>
export type StreamEvent = Awaited<ReturnType<typeof loadStreamEvents>>[number]
