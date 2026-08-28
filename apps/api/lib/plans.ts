import {
  plansPageContract,
  planResourceContract,
  planStatusContract,
  type PlanResource,
} from "@life-os/contracts";
import { db } from "@life-os/db";

export class PlansApiError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "validation",
  ) {
    super(message);
    this.name = "PlansApiError";
  }
}

export type ListPlansParams = {
  cursor?: string | null;
  limit?: number;
  personId?: string | null;
  status?: string | null;
  q?: string | null;
};

type PlanRow = Awaited<ReturnType<typeof db.plan.findFirstOrThrow>>;

export async function listPlans(params: ListPlansParams, workspaceId: string) {
  const limit = boundedLimit(params.limit);
  const q = params.q?.trim() || null;
  if (q && q.length > 500)
    throw new PlansApiError("q must be 500 characters or fewer", "validation");
  const status = params.status
    ? planStatusContract.safeParse(params.status)
    : null;
  if (status && !status.success)
    throw new PlansApiError("status is invalid", "validation");

  const and: Record<string, unknown>[] = [];
  if (q) and.push({ text: { contains: q, mode: "insensitive" as const } });
  if (params.cursor) {
    const { createdAt, id } = decodePlansCursor(params.cursor);
    and.push({
      OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }],
    });
  }

  const rows = await db.plan.findMany({
    where: {
      workspaceId,
      ...(params.personId ? { personId: params.personId } : {}),
      ...(status?.success ? { status: status.data } : {}),
      ...(and.length ? { AND: and } : {}),
    } as never,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);
  return plansPageContract.parse({
    data: page.map(formatPlanResource),
    nextCursor:
      hasMore && last ? encodePlansCursor(last.createdAt, last.id) : null,
    hasMore,
    limit,
  });
}

export async function getPlanResource(id: string, workspaceId: string) {
  const plan = await db.plan.findFirst({ where: { id, workspaceId } });
  if (!plan) throw new PlansApiError("Plan not found", "not_found");
  return formatPlanResource(plan);
}

export function formatPlanResource(plan: PlanRow): PlanResource {
  return planResourceContract.parse({
    id: plan.id,
    createdAt: plan.createdAt.toISOString(),
    personId: plan.personId,
    text: plan.text,
    timescale: plan.timescale,
    successSignals: storedStringList(plan.successSignals),
    status: plan.status,
    dueOn: plan.dueOn?.toISOString() ?? null,
    deferCount: plan.deferCount,
    completedAt: plan.completedAt?.toISOString() ?? null,
    parentId: plan.parentId,
    scheduledStart: plan.scheduledStart?.toISOString() ?? null,
    scheduledEnd: plan.scheduledEnd?.toISOString() ?? null,
    placeId: plan.placeId,
    externalSource: plan.externalSource,
    externalInstanceId: plan.externalInstanceId,
    reconciliationStatus: plan.reconciliationStatus,
    reconciledAt: plan.reconciledAt?.toISOString() ?? null,
    sourceNoteId: plan.sourceNoteId,
  });
}

function boundedLimit(value: number | undefined) {
  if (value !== undefined && !Number.isFinite(value))
    throw new PlansApiError("limit must be a number", "validation");
  return Math.min(500, Math.max(1, Math.round(value ?? 100)));
}

function storedStringList(raw: string | null): string[] {
  if (!raw) return [];
  if (!raw.trim().startsWith("[")) return splitLegacyValue(raw);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .flatMap(splitLegacyValue);
  } catch {
    return [];
  }
}

function splitLegacyValue(value: string) {
  return value
    .split(" ::: ")
    .map((item) => item.trim())
    .filter(Boolean);
}

function encodePlansCursor(createdAt: Date, id: string) {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString(
    "base64url",
  );
}

function decodePlansCursor(cursor: string) {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new PlansApiError("cursor is not valid base64url", "validation");
  }
  const separator = decoded.indexOf("|");
  if (separator <= 0)
    throw new PlansApiError("cursor is malformed", "validation");
  const createdAt = new Date(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (Number.isNaN(createdAt.getTime()) || !id)
    throw new PlansApiError("cursor is malformed", "validation");
  return { createdAt, id };
}
