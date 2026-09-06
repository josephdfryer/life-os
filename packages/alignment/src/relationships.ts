// Relationship gap detection — compares declared closeness against actual
// contact cadence. This is the single definition of "overdue" shared by
// Persons (Today page, Person detail), Home (nudges), the assistant, and the
// canonical API (`GET /v1/people/attention`), so none of them can quietly
// disagree with each other.
//
// DB-touching — do not import from a client component. Client-side callers
// (e.g. Persons' attention.ts) should import the pure formula from ./scoring
// instead.

import type { AlignmentSignal } from "./types";
import { relationshipGapScore, daysSince, isUnreviewedBulkContact, cadenceDaysFor } from "./scoring";

// One overdue relationship, with everything a surface needs to render and act
// on it without another per-person query. Computed, never stored.
export type AttentionQueueItem = {
  personId: string;
  first: string;
  last: string;
  closeness: number;
  // >= 1.0 is overdue; the queue only holds items at or past 1.0.
  score: number;
  cadenceDays: number | null;
  lastInteractionAt: Date | null;
  lastInteractionSummary: string | null;
  daysSinceLast: number | null;
  // Whole days past the cadence; 0 when there is no recorded contact at all.
  daysOverdue: number;
  hasActivePlan: boolean;
  suggestedAction: "first_touch" | "reach_out" | "follow_up_plan";
};

// Every person whose declared cadence has lapsed, most overdue first. Bounded
// at the query (close or plan-linked people only, capped) and at the result.
export async function getAttentionQueue(
  workspaceId: string,
  options: { limit?: number; now?: Date } = {},
): Promise<AttentionQueueItem[]> {
  const { db } = await import("@life-os/db");
  const now = options.now ?? new Date();
  const limit = Math.min(500, Math.max(1, Math.round(options.limit ?? 50)));
  const persons = await db.person.findMany({
    where: {
      workspaceId,
      // Exclude the self Person (tagged "self") — a relationship-gap signal
      // about not having contacted yourself is nonsensical.
      NOT: { tags: { contains: '"self"', mode: "insensitive" as const } },
      OR: [
        { closeness: { gte: 2 } },
        { plans: { some: { status: "active" } } },
      ],
    },
    select: {
      id: true,
      first: true,
      last: true,
      closeness: true,
      source: true,
      interactions: {
        where: { timestamp: { lte: now } },
        orderBy: { timestamp: "desc" },
        take: 1,
        select: { timestamp: true, summary: true },
      },
      plans: { where: { status: "active" }, select: { id: true }, take: 1 },
    },
    // The WHERE clause already restricts this to close/plan-linked people —
    // a small, bounded set for any real workspace — but Home's Intelligence
    // page calls this on every request, not just from a background job, so
    // an explicit cap protects against that changing quietly as the graph
    // grows.
    take: 1_000,
  });

  const items: AttentionQueueItem[] = [];
  for (const p of persons) {
    const lastAt = p.interactions[0]?.timestamp ?? null;
    const hasActivePlan = p.plans.length > 0;
    // Curation, not scoring: an unreviewed bulk-imported row with no history
    // and no plan is noise. Anything with a real interaction behind it, an
    // active plan, or a deliberate origin still scores normally below.
    if (isUnreviewedBulkContact({ source: p.source, lastInteractionAt: lastAt, hasActivePlan }))
      continue;
    const score = relationshipGapScore({
      closeness: p.closeness,
      lastInteractionAt: lastAt,
      hasActivePlan,
    });
    if (score < 1.0) continue;
    const cadenceDays = cadenceDaysFor(p.closeness, hasActivePlan);
    const daysSinceLast = lastAt ? daysSince(lastAt, now) : null;
    items.push({
      personId: p.id,
      first: p.first,
      last: p.last,
      closeness: p.closeness,
      score,
      cadenceDays,
      lastInteractionAt: lastAt,
      lastInteractionSummary: p.interactions[0]?.summary ?? null,
      daysSinceLast,
      daysOverdue:
        daysSinceLast !== null && cadenceDays !== null
          ? Math.max(0, daysSinceLast - cadenceDays)
          : 0,
      hasActivePlan,
      suggestedAction: !lastAt ? "first_touch" : hasActivePlan ? "follow_up_plan" : "reach_out",
    });
  }
  return items.sort((a, b) => b.score - a.score).slice(0, limit);
}

export async function getRelationshipGaps(
  workspaceId: string,
): Promise<AlignmentSignal[]> {
  const queue = await getAttentionQueue(workspaceId, { limit: 500 });
  return queue.map((item) => ({
    kind: "relationship_gap" as const,
    severity: item.score,
    subject: `${item.first} ${item.last}`,
    detail: item.lastInteractionAt
      ? `No recorded contact in ${item.daysSinceLast} days`
      : "No recorded contact yet",
    evidenceSummary: item.lastInteractionSummary,
    personId: item.personId,
  }));
}
