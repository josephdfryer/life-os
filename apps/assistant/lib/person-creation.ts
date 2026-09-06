import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  createPerson,
  matchContact,
  type MatchableContact,
  type MatchResult,
  type PersonInput,
} from "@life-os/domain";

export type AssistantPersonDraft = {
  first: string;
  last?: string;
  nickname?: string;
  title?: string;
  headline?: string;
  company?: string;
  emails: string[];
  phones: string[];
  birthday?: string;
  closeness: number;
  tags: string[];
  values: string[];
  notes?: string;
  location?: string;
  linkedin?: string;
  twitter?: string;
  website?: string;
  facebook?: string;
  instagram?: string;
};

export type PendingPersonCreation = {
  confirmationId: string;
  draft: AssistantPersonDraft;
  duplicate: Pick<
    MatchResult,
    | "personId"
    | "personName"
    | "personEmail"
    | "personCompany"
    | "score"
    | "reason"
    | "fillableFields"
  >;
};

export type PersonCreationToolResult =
  | {
      status: "confirmation_required";
      message: string;
      confirmation: PendingPersonCreation;
      replacesConfirmationId?: string;
    }
  | {
      status: "created";
      confirmationId?: string;
      personId: string;
      personName: string;
    }
  | {
      status: "existing_selected";
      confirmationId: string;
      personId: string;
      personName: string;
    }
  | { status: "error"; message: string };

type PersonCreationDependencies = {
  // The canonical import matcher, index-backed in production (see
  // packages/domain/contact-lookup.ts); tests substitute an in-memory list.
  match(contact: MatchableContact, workspaceId: string): Promise<MatchResult | null>;
  findPerson(id: string, workspaceId: string): Promise<{ id: string; first: string; last: string } | null>;
  create(draft: AssistantPersonDraft, workspaceId: string): Promise<{ id: string; first: string; last: string }>;
};

const DEFAULT_DEPENDENCIES: PersonCreationDependencies = {
  match(contact, workspaceId) {
    return matchContact(contact, workspaceId);
  },
  findPerson(id, workspaceId) {
    return db.person.findFirst({ where: { id, workspaceId }, select: { id: true, first: true, last: true } });
  },
  create(draft, workspaceId) {
    return createPerson(
      { ...draft, source: "assistant" } satisfies PersonInput,
      workspaceId,
      { type: "assistant", label: "LifeOS Assistant", workspaceId },
    );
  },
};

export async function createPersonFromAssistant(
  input: Record<string, unknown>,
  workspaceId: string,
  pendingConfirmations: PendingPersonCreation[],
  dependencies: PersonCreationDependencies = DEFAULT_DEPENDENCIES,
): Promise<PersonCreationToolResult> {
  const confirmationId = optionalString(input.confirmationId);
  const resolution = optionalString(input.duplicateResolution);

  if (confirmationId) {
    const pending = pendingConfirmations.find(
      (item) => item.confirmationId === confirmationId,
    );
    if (!pending) {
      return {
        status: "error",
        message:
          "That duplicate confirmation is missing or expired. Start the person creation again so I can re-check current People.",
      };
    }
    if (resolution !== "use_existing" && resolution !== "create_separate") {
      return {
        status: "error",
        message:
          "Choose duplicateResolution=use_existing or duplicateResolution=create_separate after the user explicitly decides.",
      };
    }

    const originalCandidate = await dependencies.findPerson(pending.duplicate.personId, workspaceId);
    if (resolution === "use_existing") {
      if (!originalCandidate) {
        return {
          status: "error",
          message:
            "The previously shown Person no longer exists. Start again so I can re-check current People.",
        };
      }
      return {
        status: "existing_selected",
        confirmationId,
        personId: originalCandidate.id,
        personName: displayName(originalCandidate),
      };
    }

    // Re-run the canonical import matcher at confirmation time. If the best
    // candidate changed, the old confirmation cannot authorize a different
    // possible duplicate; show the new candidate and ask again.
    const currentMatch = await dependencies.match(pending.draft, workspaceId);
    if (
      currentMatch &&
      currentMatch.personId !== pending.duplicate.personId
    ) {
      return confirmationRequired(pending.draft, currentMatch, confirmationId);
    }
    return created(
      await dependencies.create(pending.draft, workspaceId),
      confirmationId,
    );
  }

  const normalized = normalizeDraft(input);
  if ("status" in normalized) return normalized;
  const match = await dependencies.match(normalized, workspaceId);
  if (match) return confirmationRequired(normalized, match);
  return created(await dependencies.create(normalized, workspaceId));
}

export function collectPendingPersonCreations(
  messages: Array<{ role: string; metadata: string | null }>,
): PendingPersonCreation[] {
  const pending = new Map<string, PendingPersonCreation>();
  for (const message of messages) {
    if (message.role !== "assistant" || !message.metadata) continue;
    const metadata = parseMetadata(message.metadata);
    for (const confirmation of metadata.pendingPersonCreations ?? []) {
      if (validPendingConfirmation(confirmation)) {
        pending.set(confirmation.confirmationId, confirmation);
      }
    }
    for (const resolvedId of metadata.resolvedPersonConfirmationIds ?? []) {
      if (typeof resolvedId === "string") pending.delete(resolvedId);
    }
  }
  return [...pending.values()];
}

export function inspectPersonCreationResult(output: string): {
  pending?: PendingPersonCreation;
  resolvedConfirmationId?: string;
} {
  try {
    const result = JSON.parse(output) as PersonCreationToolResult;
    if (result.status === "confirmation_required") {
      return {
        pending: result.confirmation,
        resolvedConfirmationId: result.replacesConfirmationId,
      };
    }
    if (
      (result.status === "created" || result.status === "existing_selected") &&
      result.confirmationId
    ) {
      return { resolvedConfirmationId: result.confirmationId };
    }
  } catch {
    // Other tools deliberately return plain text; they are not confirmations.
  }
  return {};
}

function normalizeDraft(
  input: Record<string, unknown>,
): AssistantPersonDraft | Extract<PersonCreationToolResult, { status: "error" }> {
  const first = optionalString(input.first);
  if (!first) return { status: "error", message: "A Person needs a first name." };
  const closenessValue = input.closeness === undefined ? 1 : Number(input.closeness);
  if (!Number.isInteger(closenessValue) || closenessValue < 1 || closenessValue > 5) {
    return { status: "error", message: "closeness must be an integer from 1 to 5." };
  }
  return {
    first,
    ...optionalField("last", input.last),
    ...optionalField("nickname", input.nickname),
    ...optionalField("title", input.title),
    ...optionalField("headline", input.headline),
    ...optionalField("company", input.company),
    emails: stringList(input.emails, input.email),
    phones: stringList(input.phones, input.phone),
    ...optionalField("birthday", input.birthday),
    closeness: closenessValue,
    tags: stringList(input.tags),
    values: stringList(input.values),
    ...optionalField("notes", input.notes),
    ...optionalField("location", input.location),
    ...optionalField("linkedin", input.linkedin),
    ...optionalField("twitter", input.twitter),
    ...optionalField("website", input.website),
    ...optionalField("facebook", input.facebook),
    ...optionalField("instagram", input.instagram),
  };
}

function confirmationRequired(
  draft: AssistantPersonDraft,
  match: MatchResult,
  replacesConfirmationId?: string,
): Extract<PersonCreationToolResult, { status: "confirmation_required" }> {
  const confirmation: PendingPersonCreation = {
    confirmationId: randomUUID(),
    draft,
    duplicate: {
      personId: match.personId,
      personName: match.personName,
      personEmail: match.personEmail,
      personCompany: match.personCompany,
      score: match.score,
      reason: match.reason,
      fillableFields: match.fillableFields,
    },
  };
  return {
    status: "confirmation_required",
    message:
      "Possible duplicate found. Show this candidate to the user and ask whether to use the existing Person or create a separate Person anyway. Do not resolve it in this turn.",
    confirmation,
    ...(replacesConfirmationId ? { replacesConfirmationId } : {}),
  };
}

function created(
  person: { id: string; first: string; last: string },
  confirmationId?: string,
): Extract<PersonCreationToolResult, { status: "created" }> {
  return {
    status: "created",
    ...(confirmationId ? { confirmationId } : {}),
    personId: person.id,
    personName: displayName(person),
  };
}

function parseMetadata(value: string): {
  pendingPersonCreations?: unknown[];
  resolvedPersonConfirmationIds?: unknown[];
} {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function validPendingConfirmation(value: unknown): value is PendingPersonCreation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PendingPersonCreation>;
  return Boolean(
    candidate.confirmationId &&
      candidate.draft?.first &&
      candidate.duplicate?.personId &&
      candidate.duplicate?.personName,
  );
}

function stringList(arrayValue: unknown, singleValue?: unknown): string[] {
  const values = Array.isArray(arrayValue)
    ? arrayValue
    : typeof arrayValue === "string"
      ? [arrayValue]
      : [];
  if (typeof singleValue === "string") values.push(singleValue);
  return [
    ...new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalField<Key extends keyof AssistantPersonDraft>(
  key: Key,
  value: unknown,
): Partial<Pick<AssistantPersonDraft, Key>> {
  const normalized = optionalString(value);
  return normalized
    ? ({ [key]: normalized } as Partial<Pick<AssistantPersonDraft, Key>>)
    : {};
}

function displayName(person: { first: string; last: string }): string {
  return `${person.first} ${person.last}`.trim();
}
