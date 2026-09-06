import assert from "node:assert/strict";
import test from "node:test";
import { findMatch, type MatchableContact } from "@life-os/domain";
import {
  collectPendingPersonCreations,
  createPersonFromAssistant,
  inspectPersonCreationResult,
  type AssistantPersonDraft,
  type PendingPersonCreation,
} from "./person-creation";

const ada = storedPerson({
  id: "person-ada",
  first: "Ada",
  last: "Lovelace",
  emails: JSON.stringify(["ada@gmail.com"]),
  company: "Analytical Engines",
});

test("creates immediately when the import matcher finds no possible duplicate", async () => {
  const createdDrafts: AssistantPersonDraft[] = [];
  const result = await createPersonFromAssistant(
    { first: "Grace", last: "Hopper", email: "grace@example.com" },
    "workspace-a",
    [],
    dependencies([], createdDrafts),
  );

  assert.equal(result.status, "created");
  assert.equal(result.personName, "Grace Hopper");
  assert.equal(createdDrafts.length, 1);
  assert.equal(createdDrafts[0].closeness, 1);
  assert.deepEqual(createdDrafts[0].emails, ["grace@example.com"]);
});

test("a possible import-style match pauses without writing and shows the candidate", async () => {
  const createdDrafts: AssistantPersonDraft[] = [];
  const result = await createPersonFromAssistant(
    { first: "Ada", last: "Lovelace", email: "a.da+home@gmail.com" },
    "workspace-a",
    [],
    dependencies([ada], createdDrafts),
  );

  assert.equal(result.status, "confirmation_required");
  assert.equal(result.confirmation.duplicate.personId, ada.id);
  assert.equal(result.confirmation.duplicate.reason, "Same email address");
  assert.equal(createdDrafts.length, 0);
});

test("a confirmation cannot be resolved inside the proposing turn", async () => {
  const proposed = await proposalForAda();
  const result = await createPersonFromAssistant(
    {
      confirmationId: proposed.confirmationId,
      duplicateResolution: "create_separate",
    },
    "workspace-a",
    [],
    dependencies([ada], []),
  );
  assert.deepEqual(result, {
    status: "error",
    message:
      "That duplicate confirmation is missing or expired. Start the person creation again so I can re-check current People.",
  });
});

test("the next turn can choose the existing Person without creating anything", async () => {
  const proposed = await proposalForAda();
  const createdDrafts: AssistantPersonDraft[] = [];
  const result = await createPersonFromAssistant(
    {
      confirmationId: proposed.confirmationId,
      duplicateResolution: "use_existing",
    },
    "workspace-a",
    [proposed],
    dependencies([ada], createdDrafts),
  );

  assert.equal(result.status, "existing_selected");
  assert.equal(result.personId, ada.id);
  assert.equal(createdDrafts.length, 0);
});

test("the next turn can explicitly create a separate Person", async () => {
  const proposed = await proposalForAda();
  const createdDrafts: AssistantPersonDraft[] = [];
  const result = await createPersonFromAssistant(
    {
      confirmationId: proposed.confirmationId,
      duplicateResolution: "create_separate",
    },
    "workspace-a",
    [proposed],
    dependencies([ada], createdDrafts),
  );

  assert.equal(result.status, "created");
  assert.equal(result.confirmationId, proposed.confirmationId);
  assert.equal(createdDrafts.length, 1);
});

test("a changed best candidate invalidates the old confirmation and asks again", async () => {
  const proposed = await proposalForAda();
  const strongerCandidate = storedPerson({
    id: "person-ada-email",
    first: "Ada",
    last: "Byron",
    emails: JSON.stringify(["ada@example.com"]),
  });
  proposed.draft.emails = ["ada@example.com"];

  const result = await createPersonFromAssistant(
    {
      confirmationId: proposed.confirmationId,
      duplicateResolution: "create_separate",
    },
    "workspace-a",
    [proposed],
    dependencies([strongerCandidate, ada], []),
  );

  assert.equal(result.status, "confirmation_required");
  assert.equal(result.replacesConfirmationId, proposed.confirmationId);
  assert.equal(result.confirmation.duplicate.personId, strongerCandidate.id);
  assert.equal(
    inspectPersonCreationResult(JSON.stringify(result)).resolvedConfirmationId,
    proposed.confirmationId,
  );
});

test("conversation metadata carries pending confirmations and removes resolved ones", async () => {
  const proposed = await proposalForAda();
  const pendingOutput = JSON.stringify({
    status: "confirmation_required",
    message: "Possible duplicate",
    confirmation: proposed,
  });
  assert.equal(
    inspectPersonCreationResult(pendingOutput).pending?.confirmationId,
    proposed.confirmationId,
  );

  const active = collectPendingPersonCreations([
    assistantMetadata({ pendingPersonCreations: [proposed] }),
  ]);
  assert.deepEqual(active, [proposed]);

  const resolved = collectPendingPersonCreations([
    assistantMetadata({ pendingPersonCreations: [proposed] }),
    assistantMetadata({
      resolvedPersonConfirmationIds: [proposed.confirmationId],
    }),
  ]);
  assert.deepEqual(resolved, []);
});

async function proposalForAda(): Promise<PendingPersonCreation> {
  const result = await createPersonFromAssistant(
    { first: "Ada", last: "Lovelace" },
    "workspace-a",
    [],
    dependencies([ada], []),
  );
  assert.equal(result.status, "confirmation_required");
  return result.confirmation;
}

function dependencies(
  people: ReturnType<typeof storedPerson>[],
  createdDrafts: AssistantPersonDraft[],
) {
  // Same scorer production uses, over the in-memory fixture list, so these
  // tests pin the confirmation flow rather than the index plumbing (which has
  // its own integration test in apps/api).
  const matchable = people.map((person) => ({
    ...person,
    emails: JSON.parse(person.emails) as string[],
    phones: JSON.parse(person.phones) as string[],
  }));
  return {
    async match(contact: MatchableContact) {
      return findMatch(contact, matchable);
    },
    async findPerson(id: string) {
      const person = people.find((candidate) => candidate.id === id);
      return person ? { id: person.id, first: person.first, last: person.last } : null;
    },
    async create(draft: AssistantPersonDraft) {
      createdDrafts.push(draft);
      return { id: `created-${createdDrafts.length}`, first: draft.first, last: draft.last ?? "" };
    },
  };
}

function storedPerson(
  overrides: Partial<{
    id: string;
    first: string;
    last: string;
    company: string | null;
    title: string | null;
    headline: string | null;
    birthday: string | null;
    location: string | null;
    linkedin: string | null;
    twitter: string | null;
    website: string | null;
    facebook: string | null;
    instagram: string | null;
    notes: string | null;
    emails: string;
    phones: string;
  }> = {},
) {
  return {
    id: "person-1",
    first: "Person",
    last: "One",
    company: null,
    title: null,
    headline: null,
    birthday: null,
    location: null,
    linkedin: null,
    twitter: null,
    website: null,
    facebook: null,
    instagram: null,
    notes: null,
    emails: "[]",
    phones: "[]",
    ...overrides,
  };
}

function assistantMetadata(metadata: Record<string, unknown>) {
  return { role: "assistant", metadata: JSON.stringify(metadata) };
}
