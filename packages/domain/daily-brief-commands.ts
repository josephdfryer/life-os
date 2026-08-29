// The three write actions scripts/brief/execute.ts's markdown annotations
// trigger ([x] complete, [follow-up: Name], [note: Name]) — extracted into
// real domain commands and registered via registerReviewCommand so the same
// actions are reachable from both the annotation flow and any future
// ReviewItem-based UI, instead of two ways to do the same three things. See
// docs/ADAPTIVE_DAY_PLAN.md §4.

import {
  registerReviewCommand,
  type ReviewItemActorContext,
  type ReviewItemCommandResult,
} from "./review";
import { createPlan } from "./plans";

export class DailyBriefError extends Error {
  constructor(
    message: string,
    readonly code: "not_found",
  ) {
    super(message);
    this.name = "DailyBriefError";
  }
}

export async function findPersonByName(name: string, workspaceId: string) {
  const { db } = await import("@life-os/db");
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.join(" ");
  return db.person.findFirst({
    where: {
      workspaceId,
      first: { equals: first },
      ...(last ? { last: { equals: last } } : {}),
    },
    select: { id: true },
  });
}

// Matches by substring against the first 40-50 characters, same tolerance
// the original CLI used — action-item text is free-form and rarely copied
// back verbatim into the [x] annotation.
export async function completeActionItemByText(
  description: string,
  workspaceId: string,
) {
  const { db } = await import("@life-os/db");
  const needle = description.toLowerCase().slice(0, 40);
  const interactions = await db.interaction.findMany({
    where: {
      workspaceId,
      actionItems: {
        contains: description.slice(0, 50),
        mode: "insensitive" as const,
      },
    },
    select: { id: true, actionItems: true },
    take: 5,
  });
  let updated = 0;
  for (const interaction of interactions) {
    const items = safeJsonArray<{ description: string; completed?: boolean }>(
      interaction.actionItems,
    );
    let changed = false;
    const next = items.map((item) => {
      if (item.description.toLowerCase().includes(needle)) {
        changed = true;
        return { ...item, completed: true };
      }
      return item;
    });
    if (changed) {
      await db.interaction.update({
        where: { id: interaction.id },
        data: { actionItems: JSON.stringify(next) },
      });
      updated++;
    }
  }
  return { updated };
}

export async function appendPersonNote(
  personId: string,
  noteText: string,
  workspaceId: string,
) {
  const { db } = await import("@life-os/db");
  const person = await db.person.findFirst({
    where: { id: personId, workspaceId },
    select: { notes: true },
  });
  if (!person) throw new DailyBriefError("Person not found", "not_found");
  const existing = person.notes?.trim() ?? "";
  const dated = `[${new Date().toISOString().slice(0, 10)}] ${noteText}`;
  return db.person.update({
    where: { id: personId },
    data: { notes: existing ? `${existing}\n${dated}` : dated },
  });
}

function safeJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

registerReviewCommand(
  "daily_brief.complete_action_item",
  async (
    input,
    ctx: ReviewItemActorContext,
  ): Promise<ReviewItemCommandResult> => {
    const result = await completeActionItemByText(
      input.description as string,
      ctx.workspaceId,
    );
    return {
      resultType: "Interaction",
      resultId: result.updated > 0 ? "updated" : null,
    };
  },
);

registerReviewCommand(
  "daily_brief.create_follow_up_plan",
  async (
    input,
    ctx: ReviewItemActorContext,
  ): Promise<ReviewItemCommandResult> => {
    const plan = await createPlan(
      {
        text: input.text as string,
        personId: (input.personId as string | undefined) ?? undefined,
      },
      ctx.workspaceId,
      ctx.actor,
    );
    return { resultType: "Plan", resultId: plan.id };
  },
);

registerReviewCommand(
  "daily_brief.append_person_note",
  async (
    input,
    ctx: ReviewItemActorContext,
  ): Promise<ReviewItemCommandResult> => {
    const person = await appendPersonNote(
      input.personId as string,
      input.note as string,
      ctx.workspaceId,
    );
    return { resultType: "Person", resultId: person.id };
  },
);
