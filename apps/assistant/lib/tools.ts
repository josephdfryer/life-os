import { db } from "@/lib/db";
import { centsToDollars } from "@life-os/db";
import {
  addMember,
  captureNote as createCapturedNote,
  createGroup,
  getOrganizationDossier,
  listRelationshipOrganizations,
  createInteraction,
  createItem,
  createPlaceNote,
  createPlan,
  updatePerson,
} from "@life-os/domain";
import {
  getSpendBreakdown,
  getPlaceSpend as placeSpend,
  type SpendBreakdownInput,
} from "@/lib/finance";
import {
  getPersonFileEvidence,
  searchFileChunks as searchIndexedFileChunks,
} from "@life-os/files";
import {
  createPersonFromAssistant,
  type PendingPersonCreation,
} from "@/lib/person-creation";

const TZ = "America/Los_Angeles";

// ── Tool schemas (provider-neutral JSON Schema) ───────────────────

// Capability is REQUIRED, and deliberately has no default. The guard that stops
// untrusted file content from inducing graph writes keys off this value, and its
// previous form named the two write tools that existed — so every tool added
// afterwards was permitted by default. Making this a required field turns
// "forgot to classify a new tool" into a type error instead of a silent hole.
//
//   read        — no side effects
//   write       — creates or mutates graph data
//   destructive — deletes or merges; never executed, proposed for review instead
export type ToolCapability = "read" | "write" | "destructive";

export type AssistantToolDefinition = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  capability: ToolCapability;
  requiredScope: string;
};

export const TOOLS: AssistantToolDefinition[] = [
  {
    name: "search_people",
    capability: "read",
    requiredScope: "people.read",
    description:
      "Search this workspace's people by name, company, or email fragment. Returns compact matches with ids for use in other tools.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Name, company, or email fragment",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_person",
    capability: "read",
    requiredScope: "people.read",
    description:
      "Full detail for one person: profile, recent interactions, active plans. Use the id from search_people.",
    input_schema: {
      type: "object",
      properties: { personId: { type: "string" } },
      required: ["personId"],
    },
  },
  {
    name: "create_person",
    capability: "write",
    requiredScope: "people.write",
    description:
      "Create a Person in LifeOS. On a new request, pass the known identity/profile fields; the tool runs the canonical contact-import duplicate matcher first and creates immediately only when no possible match exists. If it returns confirmation_required, show the candidate and ask whether to use the existing Person or create a separate Person. Only in a later user turn, after their explicit choice, call again with that confirmationId and duplicateResolution. The returned personId can be used immediately for capture_note, log_interaction, create_plan, or add_person_to_group.",
    input_schema: {
      type: "object",
      properties: {
        first: { type: "string", description: "Required for a new request" },
        last: { type: "string" },
        nickname: { type: "string" },
        title: { type: "string" },
        headline: { type: "string" },
        company: { type: "string" },
        email: { type: "string" },
        emails: { type: "array", items: { type: "string" } },
        phone: { type: "string" },
        phones: { type: "array", items: { type: "string" } },
        birthday: {
          type: "string",
          description: "YYYY-MM-DD or MM-DD when the year is unknown",
        },
        closeness: {
          type: "integer",
          enum: [1, 2, 3, 4, 5],
          description:
            "Only pass when the member explicitly states the relationship level; otherwise the safe default is 1 (Acquaintance)",
        },
        tags: { type: "array", items: { type: "string" } },
        values: { type: "array", items: { type: "string" } },
        notes: { type: "string" },
        location: { type: "string" },
        linkedin: { type: "string" },
        twitter: { type: "string" },
        website: { type: "string" },
        facebook: { type: "string" },
        instagram: { type: "string" },
        confirmationId: {
          type: "string",
          description:
            "Only pass from a prior confirmation_required result in this conversation",
        },
        duplicateResolution: {
          type: "string",
          enum: ["use_existing", "create_separate"],
          description:
            "Only pass with confirmationId after the user explicitly chooses",
        },
      },
      required: [],
    },
  },
  {
    name: "update_person",
    capability: "write",
    requiredScope: "people.write",
    description:
      "Edit an existing Person's profile fields, e.g. fixing a misspelled or wrong name the member just noticed. Use the id from search_people or get_person. Only pass the fields that should change — omitted fields are left as-is.",
    input_schema: {
      type: "object",
      properties: {
        personId: { type: "string", description: "From search_people or get_person" },
        first: { type: "string" },
        last: { type: "string" },
        nickname: { type: "string" },
        title: { type: "string" },
        headline: { type: "string" },
        company: { type: "string" },
        email: { type: "string" },
        emails: { type: "array", items: { type: "string" } },
        phone: { type: "string" },
        phones: { type: "array", items: { type: "string" } },
        birthday: {
          type: "string",
          description: "YYYY-MM-DD or MM-DD when the year is unknown",
        },
        closeness: { type: "integer", enum: [1, 2, 3, 4, 5] },
        tags: { type: "array", items: { type: "string" } },
        values: { type: "array", items: { type: "string" } },
        notes: { type: "string" },
        location: { type: "string" },
        linkedin: { type: "string" },
        twitter: { type: "string" },
        website: { type: "string" },
        facebook: { type: "string" },
        instagram: { type: "string" },
      },
      required: ["personId"],
    },
  },
  {
    name: "get_schedule",
    capability: "read",
    requiredScope: "life-events.read",
    description:
      "Events for a specific date (defaults to today, Pacific time). Includes places when known.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD; omit for today" },
      },
      required: [],
    },
  },
  {
    name: "capture_note",
    capability: "write",
    requiredScope: "notes.write",
    description:
      "Capture a raw thought, observation, or declaration as a Note in LifeOS. Use when the member wants to remember, note, or declare something. If it is about a person, place, item, event, plan, group, or state, search first and pass that id so Theory and the rest of the graph can find it. Do not use add_place_note or append to a record's notes blob for this.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string" },
        noteType: {
          type: "string",
          enum: ["thought", "observation", "declaration"],
          description: "Default thought",
        },
        personId: {
          type: "string",
          description: "Who this note is about, from search_people",
        },
        placeId: {
          type: "string",
          description: "Where this note is about, from search_places",
        },
        itemId: {
          type: "string",
          description: "Which belonging this note is about, from search_items",
        },
        eventId: {
          type: "string",
          description: "Which event this note is about, from search_events",
        },
        planId: {
          type: "string",
          description: "Which plan this note is about, from get_plans",
        },
        groupId: {
          type: "string",
          description:
            "Which organization this note is about, from search_organizations",
        },
        stateId: {
          type: "string",
          description: "Which state this note is about, from get_states",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "log_interaction",
    capability: "write",
    requiredScope: "interactions.write",
    description:
      "Log an interaction with a person (call, meeting, message, meal...). Use after confirming which person via search_people.",
    input_schema: {
      type: "object",
      properties: {
        personId: { type: "string" },
        type: {
          type: "string",
          description: "call | meeting | message | meal | activity",
        },
        summary: { type: "string" },
      },
      required: ["personId", "type", "summary"],
    },
  },
  {
    name: "create_item",
    capability: "write",
    requiredScope: "items.write",
    description:
      "Create a new physical belonging in Stuff (a vehicle, appliance, instrument, piece of gear). Use when the member refers to something the workspace owns that search_items cannot find, so receipts, warranties and interactions can be filed against it. Returns the new itemId.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "What it is, e.g. '2021 Volvo XC60'",
        },
        category: {
          type: "string",
          description: "e.g. vehicle, appliance, electronics",
        },
        make: { type: "string", description: "Manufacturer, e.g. Volvo" },
        model: { type: "string" },
        serialNumber: { type: "string", description: "Serial or VIN if known" },
        notes: {
          type: "string",
          description: "Anything worth preserving about it",
        },
        placeId: {
          type: "string",
          description: "Where it lives, from search_places",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "create_plan",
    capability: "write",
    requiredScope: "plans.write",
    description:
      "Record a declared intention or commitment as a Plan. Use when the member states an intention, optionally about a specific person.",
    input_schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The intention, in the member's own words where possible",
        },
        personId: {
          type: "string",
          description: "Who it concerns, from search_people",
        },
        timescale: {
          type: "string",
          description: "e.g. this week, this quarter, someday",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "add_place_note",
    capability: "write",
    requiredScope: "places.write",
    description:
      "Attach a Places-app sidebar note to an existing Place (a mutable PlaceNote row, not a graph Note). For something Theory, Stuff, or the assistant should later retrieve as a Note, use capture_note with placeId instead. Find the placeId with search_places first.",
    input_schema: {
      type: "object",
      properties: {
        placeId: { type: "string", description: "From search_places" },
        body: { type: "string", description: "The note" },
      },
      required: ["placeId", "body"],
    },
  },
  {
    name: "search_organizations",
    capability: "read",
    requiredScope: "groups.read",
    description:
      "Find companies and organizations represented in this workspace. Returns ids for get_organization. Only lists organizations with people or real contact attached, not every merchant in the transaction history.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Name fragment; omit to list all",
        },
      },
      required: [],
    },
  },
  {
    name: "get_organization",
    capability: "read",
    requiredScope: "groups.read",
    description:
      "The full dossier for one organization: every interaction with anyone there (including after they moved on), total spend with them, current and past people, their sites, recorded facts like headcount or market cap, and research notes. Use this whenever the member asks about a company as a whole.",
    input_schema: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "From search_organizations" },
      },
      required: ["groupId"],
    },
  },
  {
    name: "create_group",
    capability: "write",
    requiredScope: "groups.write",
    description:
      "Create an organization or group — a company, family, or team. Search first so an existing one is extended rather than duplicated.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        groupType: {
          type: "string",
          description:
            "corporation, employer, family, friend_group, sports_team, community, or other",
        },
        notes: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "add_person_to_group",
    capability: "write",
    requiredScope: "groups.write",
    description:
      "Record that a person belongs to an organization, with their role. This is how the company's people list gets built, so do it whenever the member mentions where someone works.",
    input_schema: {
      type: "object",
      properties: {
        groupId: { type: "string", description: "From search_organizations" },
        personId: { type: "string", description: "From search_people" },
        role: { type: "string", description: "Their title or role there" },
      },
      required: ["groupId", "personId"],
    },
  },
  {
    name: "query_finance",
    capability: "read",
    requiredScope: "interactions.read",
    description:
      "Compatibility spending summary over the last N days. Prefer get_spend_breakdown for exact dates, named periods, and breakdown questions.",
    input_schema: {
      type: "object",
      properties: {
        sinceDays: {
          type: "number",
          description: "Lookback window in days, default 30",
        },
        merchant: {
          type: "string",
          description: "Filter: merchant name contains",
        },
        category: {
          type: "string",
          description:
            "Filter: category name contains (e.g. Groceries, Dining out)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_spend_breakdown",
    capability: "read",
    requiredScope: "interactions.read",
    description:
      "Read-only spend total and breakdown for a specific date or range. Use for questions like 'how much did I spend yesterday?', 'break it down by category', or 'what did I spend at restaurants last week?'.",
    input_schema: {
      type: "object",
      properties: {
        dateExpression: {
          type: "string",
          description:
            "Natural period: today, yesterday, this week, last week, this month, last month, last 7 days, YYYY-MM-DD, YYYY-MM, or July 2026. Default last 30 days.",
        },
        startDate: {
          type: "string",
          description:
            "YYYY-MM-DD inclusive. Use with endDate for a custom range.",
        },
        endDate: {
          type: "string",
          description:
            "YYYY-MM-DD inclusive. Optional when startDate is one day.",
        },
        merchant: {
          type: "string",
          description: "Filter: merchant name contains",
        },
        category: {
          type: "string",
          description:
            "Filter: category name contains, e.g. Groceries or Dining out",
        },
        placeName: {
          type: "string",
          description: "Filter: matched physical place name contains",
        },
        who: {
          type: "string",
          description:
            "Whose spending: a person's name for their own accounts, or 'us'/'family' for the whole household (members' personal spend plus joint accounts). Omit for everything.",
        },
        limit: {
          type: "number",
          description: "Number of rows per breakdown, default 10",
        },
      },
      required: [],
    },
  },
  {
    name: "get_place_spend",
    capability: "read",
    requiredScope: "interactions.read",
    description:
      "Spending grouped by physical place (from location-matched transactions). Optionally filter by place name.",
    input_schema: {
      type: "object",
      properties: { placeName: { type: "string" } },
      required: [],
    },
  },
  {
    name: "search_notes",
    capability: "read",
    requiredScope: "notes.read",
    description:
      "Search this workspace's captured Notes (thoughts, observations, declarations). Optionally filter to notes about a person, place, or item.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        personId: {
          type: "string",
          description: "Only notes about this person, from search_people",
        },
        placeId: {
          type: "string",
          description: "Only notes about this place, from search_places",
        },
        itemId: {
          type: "string",
          description: "Only notes about this item, from search_items",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_inbox",
    capability: "read",
    requiredScope: "review.read",
    description:
      "Preview pending review-inbox items (unmatched communications awaiting triage). Read-only.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "number", description: "Default 5" } },
      required: [],
    },
  },
  {
    name: "search_places",
    capability: "read",
    requiredScope: "places.read",
    description:
      "Search this workspace's places by name, address, or type (city, home, room, shelf, etc). Returns compact matches with ids for use in get_place.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Name, address, or type fragment",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_place",
    capability: "read",
    requiredScope: "places.read",
    description:
      "Full detail for one place: hierarchy, meaning, recent notes, items stored there, recent events there. Use the id from search_places.",
    input_schema: {
      type: "object",
      properties: { placeId: { type: "string" } },
      required: ["placeId"],
    },
  },
  {
    name: "search_items",
    capability: "read",
    requiredScope: "items.read",
    description:
      "Search this workspace's physical belongings (Stuff app) by name, category, make/model, or asset id. Returns compact matches with ids for use in get_item.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Name, category, make, model, or asset id fragment",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_item",
    capability: "read",
    requiredScope: "items.read",
    description:
      "Full detail for one physical item: location, owner, purchase/warranty info, and assembly (what it's inside, what's inside it). Use the id from search_items.",
    input_schema: {
      type: "object",
      properties: { itemId: { type: "string" } },
      required: ["itemId"],
    },
  },
  {
    name: "search_events",
    capability: "read",
    requiredScope: "life-events.read",
    description:
      "Keyword search over this workspace's events/calendar within a lookback window — use for 'when did I last...' or finding a specific past/future event by name, unlike get_schedule which only covers one day.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Event name/notes fragment" },
        sinceDays: {
          type: "number",
          description: "Lookback window in days, default 90",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_theory",
    capability: "read",
    requiredScope: "intelligence.read",
    description:
      "This workspace's current 'theory of mind' synthesis for a person — a standing derived read on who they are, patterns, and context, built from their notes/interactions/events over time. Use the id from search_people.",
    input_schema: {
      type: "object",
      properties: { personId: { type: "string" } },
      required: ["personId"],
    },
  },
  {
    name: "get_alignment_signals",
    capability: "read",
    requiredScope: "intelligence.read",
    description:
      "Compare the workspace's declared intentions against recorded behavior to surface where they've drifted apart — relationships going cold relative to declared closeness, and person-linked goals with no follow-through since they were declared. Use when the member asks what's being neglected, what needs attention, or wants a check-in on stated priorities.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    // The reason the graph exists: one stream, not one page per person.
    name: "get_interactions",
    capability: "read",
    requiredScope: "interactions.read",
    description:
      "The workspace's unified interaction stream — every logged thing in one continuous list, newest first: calls, meals, meetings, messages, emails, calendar events and financial transactions. Use for 'what have I been doing', 'what happened last week', or any question that spans more than one person. Filter by type, person, place, merchant or date. This is the general feed; use get_spend_breakdown for money totals.",
    input_schema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description:
            "Filter: financial | calendar | message | email | call | meeting. Omit for everything.",
        },
        personName: {
          type: "string",
          description: "Filter: only interactions involving this person",
        },
        merchant: {
          type: "string",
          description: "Filter: merchant or counterparty name contains",
        },
        sinceDays: {
          type: "number",
          description: "Lookback window in days, default 14",
        },
        limit: {
          type: "number",
          description: "Max rows, default 25 (max 100)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_plans",
    capability: "read",
    requiredScope: "plans.read",
    description:
      "The workspace's declared intentions — goals, commitments and plans, with status and due dates. These are stated intentions, as opposed to what the interaction log shows happened. Use for 'what am I committed to', 'what's overdue', or to check a goal before advising.",
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description:
            "draft | active | blocked | completed | abandoned. Default active.",
        },
        personName: {
          type: "string",
          description: "Filter: plans tied to this person",
        },
        overdueOnly: {
          type: "boolean",
          description: "Only plans past their due date",
        },
        limit: { type: "number", description: "Default 20" },
      },
      required: [],
    },
  },
  {
    name: "get_states",
    capability: "read",
    requiredScope: "states.read",
    description:
      "Point-in-time conditions recorded on people, places or projects — health readings, relationship phases, project status. Each is a timestamped fact, never overwritten, so this shows how something has changed. Use for 'how has my sleep been', 'what's the state of X', or trend questions.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Filter: state type or value contains, e.g. sleep, weight, mood",
        },
        entityType: {
          type: "string",
          description: "Person | Place | Plan | Item",
        },
        sinceDays: {
          type: "number",
          description: "Lookback window, default 30",
        },
        limit: { type: "number", description: "Default 30" },
      },
      required: [],
    },
  },
  {
    name: "search_groups",
    capability: "read",
    requiredScope: "groups.read",
    description:
      "Collectives in this workspace's graph: household/family, employers, and merchants represented as companies. Use to find who a group's members are, or to get total spend with a company across all time.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Name fragment, e.g. Amazon, Fryer, Uber",
        },
        groupType: {
          type: "string",
          description:
            "family | employer | corporation | friend_group | community",
        },
        limit: { type: "number", description: "Default 15" },
      },
      required: [],
    },
  },
  {
    name: "search_file_chunks",
    capability: "read",
    requiredScope: "files.read",
    description:
      "Search faithful extracted file passages. Returns chunk IDs and exact locators that may be cited as [chunk:ID].",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "number" } },
      required: ["query"],
    },
  },
  {
    name: "get_file_context",
    capability: "read",
    requiredScope: "files.read",
    description:
      "Get metadata and a keyset-paginated page of latest-version extracted chunks for one workspace-owned file. Follow nextCursor when more context is needed.",
    input_schema: {
      type: "object",
      properties: {
        fileId: { type: "string" },
        cursor: { type: "string" },
        limit: { type: "number", description: "Default 40, max 80" },
      },
      required: ["fileId"],
    },
  },
  {
    name: "list_file_claims",
    capability: "read",
    requiredScope: "files.read",
    description:
      "List cited explicit and inferred evidence claims for one file.",
    input_schema: {
      type: "object",
      properties: { fileId: { type: "string" } },
      required: ["fileId"],
    },
  },
  {
    name: "list_file_people",
    capability: "read",
    requiredScope: "files.read",
    description:
      "List every Person mention and its role, confidence, and resolution status for one file.",
    input_schema: {
      type: "object",
      properties: { fileId: { type: "string" } },
      required: ["fileId"],
    },
  },
  {
    name: "get_person_file_evidence",
    capability: "read",
    requiredScope: "files.read",
    description: "Get cited file evidence connected to a resolved Person.",
    input_schema: {
      type: "object",
      properties: { personId: { type: "string" } },
      required: ["personId"],
    },
  },
];

// ── Executors ────────────────────────────────────────────────────

// workspaceId always comes from the authenticated caller's resolved
// membership (see requireWorkspaceAccess in lib/access.ts) — never from an
// env var or default. Every DB call below is scoped to it.
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  workspaceId: string,
  fileScope: string[] = [],
  context: { pendingPersonCreations?: PendingPersonCreation[] } = {},
): Promise<string> {
  try {
    switch (name) {
      case "search_people":
        return await searchPeople(String(input.query ?? ""), workspaceId);
      case "get_person":
        return await getPerson(String(input.personId ?? ""), workspaceId);
      case "create_person":
        return JSON.stringify(
          await createPersonFromAssistant(
            input,
            workspaceId,
            context.pendingPersonCreations ?? [],
          ),
        );
      case "update_person":
        return await updatePersonTool(input, workspaceId);
      case "get_schedule":
        return await getSchedule(
          workspaceId,
          input.date ? String(input.date) : undefined,
        );
      case "capture_note":
        return await captureNote(input, workspaceId);
      case "log_interaction":
        return await logInteraction(
          String(input.personId ?? ""),
          String(input.type ?? "message"),
          String(input.summary ?? ""),
          workspaceId,
        );
      case "search_organizations":
        return await searchOrganizationsTool(input, workspaceId);
      case "get_organization":
        return await getOrganizationTool(input, workspaceId);
      case "create_group":
        return await createGroupTool(input, workspaceId);
      case "add_person_to_group":
        return await addPersonToGroupTool(input, workspaceId);
      case "create_item":
        return await createItemTool(input, workspaceId);
      case "create_plan":
        return await createPlanTool(input, workspaceId);
      case "add_place_note":
        return await addPlaceNoteTool(input, workspaceId);
      case "query_finance":
        return await queryFinance(
          Number(input.sinceDays ?? 30),
          workspaceId,
          input.merchant ? String(input.merchant) : undefined,
          input.category ? String(input.category) : undefined,
        );
      case "get_spend_breakdown":
        return await spendBreakdown(input, workspaceId);
      case "get_place_spend":
        return await getPlaceSpend(
          workspaceId,
          input.placeName ? String(input.placeName) : undefined,
        );
      case "search_notes":
        return await searchNotes(input, workspaceId);
      case "list_inbox":
        return await listInbox(Number(input.limit ?? 5), workspaceId);
      case "search_places":
        return await searchPlaces(String(input.query ?? ""), workspaceId);
      case "get_place":
        return await getPlace(String(input.placeId ?? ""), workspaceId);
      case "search_items":
        return await searchItems(String(input.query ?? ""), workspaceId);
      case "get_item":
        return await getItem(String(input.itemId ?? ""), workspaceId);
      case "search_events":
        return await searchEvents(
          String(input.query ?? ""),
          Number(input.sinceDays ?? 90),
          workspaceId,
        );
      case "get_theory":
        return await getTheory(String(input.personId ?? ""), workspaceId);
      case "get_alignment_signals":
        return await getAlignmentSignalsTool(workspaceId);
      case "get_interactions":
        return await getInteractionStream(input, workspaceId);
      case "get_plans":
        return await getPlans(input, workspaceId);
      case "get_states":
        return await getStates(input, workspaceId);
      case "search_groups":
        return await searchGroups(input, workspaceId);
      case "search_file_chunks":
        return await searchFileChunksTool(input, workspaceId, fileScope);
      case "get_file_context":
        return await getFileContextTool(input, workspaceId, fileScope);
      case "list_file_claims":
        return await listFileClaimsTool(
          String(input.fileId ?? ""),
          workspaceId,
          fileScope,
        );
      case "list_file_people":
        return await listFilePeopleTool(
          String(input.fileId ?? ""),
          workspaceId,
          fileScope,
        );
      case "get_person_file_evidence":
        return await getPersonFileEvidenceTool(
          String(input.personId ?? ""),
          workspaceId,
          fileScope,
        );
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (error) {
    return `Tool error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function scopedFileWhere(
  fileId: string,
  workspaceId: string,
  fileScope: string[],
) {
  return {
    id: fileId,
    workspaceId,
    archivedAt: null,
    ...(fileScope.length ? { id: { equals: fileId, in: fileScope } } : {}),
  };
}

async function searchFileChunksTool(
  input: Record<string, unknown>,
  workspaceId: string,
  fileScope: string[],
) {
  const rows = await searchIndexedFileChunks({
    workspaceId,
    query: String(input.query ?? ""),
    fileIds: fileScope,
    limit: clampNumber(input.limit, 12, 1, 30),
  });
  return JSON.stringify(
    rows.map((row) => ({
      chunkId: row.id,
      fileId: row.sourceFileId,
      filename: row.filename,
      locator: JSON.parse(row.locator),
      text: row.content,
    })),
  );
}

async function getFileContextTool(
  input: Record<string, unknown>,
  workspaceId: string,
  fileScope: string[],
) {
  const fileId = String(input.fileId ?? "");
  const file = await db.importedFile.findFirst({
    where: scopedFileWhere(fileId, workspaceId, fileScope),
    select: { id: true, filename: true, mimeType: true, processingState: true },
  });
  if (!file) return "File not found";
  const latest = await db.fileChunk.aggregate({
    where: { workspaceId, sourceFileId: fileId },
    _max: { version: true },
  });
  const limit = clampNumber(input.limit, 40, 1, 80);
  const cursor =
    typeof input.cursor === "string" && input.cursor ? input.cursor : undefined;
  const chunks = await db.fileChunk.findMany({
    where: {
      workspaceId,
      sourceFileId: fileId,
      version: latest._max.version ?? 0,
    },
    orderBy: [{ ordinal: "asc" }, { id: "asc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, locator: true, content: true },
  });
  const hasMore = chunks.length > limit;
  const page = hasMore ? chunks.slice(0, limit) : chunks;
  return JSON.stringify({
    ...file,
    chunks: page.map((chunk) => ({
      chunkId: chunk.id,
      locator: JSON.parse(chunk.locator),
      text: chunk.content,
    })),
    nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
  });
}

async function listFileClaimsTool(
  fileId: string,
  workspaceId: string,
  fileScope: string[],
) {
  const file = await db.importedFile.findFirst({
    where: scopedFileWhere(fileId, workspaceId, fileScope),
    select: { id: true },
  });
  if (!file) return "File not found";
  const claims = await db.evidenceClaim.findMany({
    where: {
      workspaceId,
      sourceFileId: fileId,
      status: { notIn: ["dismissed", "superseded", "reversed"] },
    },
    include: {
      chunk: { select: { id: true, locator: true } },
      subjects: {
        include: {
          mention: {
            select: {
              sourceText: true,
              role: true,
              resolutionStatus: true,
              resolvedPersonId: true,
            },
          },
        },
      },
    },
  });
  return JSON.stringify(
    claims.map((claim) => ({
      id: claim.id,
      assertion: claim.assertion,
      classification: claim.classification,
      status: claim.status,
      exactQuote: claim.exactQuote,
      chunkId: claim.chunk.id,
      locator: JSON.parse(claim.chunk.locator),
      subjects: claim.subjects,
    })),
  );
}

async function listFilePeopleTool(
  fileId: string,
  workspaceId: string,
  fileScope: string[],
) {
  const file = await db.importedFile.findFirst({
    where: scopedFileWhere(fileId, workspaceId, fileScope),
    select: { id: true },
  });
  if (!file) return "File not found";
  return JSON.stringify(
    await db.fileEntityMention.findMany({
      where: { workspaceId, sourceFileId: fileId, entityType: "Person" },
      select: {
        id: true,
        sourceText: true,
        role: true,
        exactQuote: true,
        confidence: true,
        resolutionStatus: true,
        resolutionLevel: true,
        resolvedPerson: { select: { id: true, first: true, last: true } },
        chunkId: true,
      },
    }),
  );
}

async function getPersonFileEvidenceTool(
  personId: string,
  workspaceId: string,
  fileScope: string[],
) {
  const evidence = await getPersonFileEvidence(personId, workspaceId);
  const scoped = fileScope.length
    ? evidence.filter((claim) => fileScope.includes(claim.sourceFileId))
    : evidence;
  return JSON.stringify(
    scoped.map((claim) => ({
      id: claim.id,
      assertion: claim.assertion,
      classification: claim.classification,
      status: claim.status,
      exactQuote: claim.exactQuote,
      chunkId: claim.chunk.id,
      locator: JSON.parse(claim.chunk.locator),
      filename: claim.sourceFile.filename,
    })),
  );
}

async function searchPeople(query: string, workspaceId: string) {
  if (!query.trim()) return "Empty query";
  const q = query.trim();
  const now = new Date();
  const parts = q.split(/\s+/);

  // Build OR clauses — also handle "First Last" full-name queries by matching parts individually
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orClauses: any[] = [
    { first: { contains: q, mode: "insensitive" as const } },
    { last: { contains: q, mode: "insensitive" as const } },
    { company: { contains: q, mode: "insensitive" as const } },
    {
      emailSearch: { contains: q.toLowerCase(), mode: "insensitive" as const },
    },
    { nickname: { contains: q, mode: "insensitive" as const } },
  ];
  if (parts.length >= 2) {
    // "Joseph Fryer" → first contains "Joseph" AND last contains "Fryer"
    orClauses.push({
      AND: [
        { first: { contains: parts[0], mode: "insensitive" as const } },
        {
          last: {
            contains: parts[parts.length - 1],
            mode: "insensitive" as const,
          },
        },
      ],
    });
  }

  const people = await db.person.findMany({
    where: { workspaceId, OR: orClauses },
    select: {
      id: true,
      first: true,
      last: true,
      nickname: true,
      company: true,
      closeness: true,
      interactions: {
        where: { timestamp: { lte: now } },
        select: { timestamp: true },
        orderBy: { timestamp: "desc" },
        take: 1,
      },
    },
    take: 6,
  });
  if (!people.length) return `No people matching "${q}"`;
  return people
    .map((p) => {
      const last = p.interactions[0]?.timestamp;
      return `${p.first} ${p.last}${p.nickname ? ` "${p.nickname}"` : ""} · id=${p.id} · ${p.company ?? "no company"} · closeness ${p.closeness} · last contact ${last ? daysAgo(last) : "never"}`;
    })
    .join("\n");
}

async function updatePersonTool(
  input: Record<string, unknown>,
  workspaceId: string,
) {
  const personId = String(input.personId ?? "").trim();
  if (!personId) return "personId is required — search_people first";
  const { personId: _personId, ...patch } = input;
  const updated = await updatePerson(personId, patch, workspaceId, {
    type: "assistant",
    label: "LifeOS Assistant",
    workspaceId,
  });
  return `Updated ${updated.first} ${updated.last}.`.trim();
}

async function getPerson(personId: string, workspaceId: string) {
  const now = new Date();
  const [p, recentStates, aboutNotes] = await Promise.all([
    db.person.findFirst({
      where: { id: personId, workspaceId },
      include: {
        interactions: {
          where: { timestamp: { lte: now } },
          orderBy: { timestamp: "desc" },
          take: 5,
          select: { type: true, timestamp: true, summary: true },
        },
        plans: {
          where: { status: "active" },
          take: 5,
          select: { text: true, timescale: true },
        },
      },
    }),
    // Fetch most recent state per type (health metrics, capacity, etc.)
    db.state.findMany({
      where: { entityId: personId, workspaceId },
      include: { definition: { select: { type: true, value: true } } },
      orderBy: { recordedAt: "desc" },
      take: 30,
    }),
    db.note.findMany({
      where: { workspaceId, aboutPersonId: personId },
      orderBy: { timestamp: "desc" },
      take: 5,
      select: { type: true, timestamp: true, content: true, metadata: true },
    }),
  ]);
  if (!p) return "Person not found";

  // Dedupe states — keep most recent per (type, value) pair
  const latestByType = new Map<
    string,
    { value: string; severity: number | null; recordedAt: Date }
  >();
  for (const s of recentStates) {
    const key = s.definition.type;
    if (!latestByType.has(key)) {
      latestByType.set(key, {
        value: s.definition.value,
        severity: s.severity,
        recordedAt: s.recordedAt,
      });
    }
  }

  const stateLines = [...latestByType.entries()].map(([type, s]) => {
    const val = s.severity !== null ? `${s.value} (${s.severity})` : s.value;
    return `  ${type}: ${val} as of ${s.recordedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  });

  const lines = [
    `${p.first} ${p.last}${p.nickname ? ` "${p.nickname}"` : ""}`,
    [p.title, p.company, p.location].filter(Boolean).join(" · "),
    p.birthday ? `Birthday: ${p.birthday}` : "",
    p.notes ? `Notes blob: ${p.notes.slice(0, 300)}` : "",
    aboutNotes.length ? "\nNotes about them:" : "",
    ...aboutNotes.map(
      (n) => `  - [${n.type} · ${daysAgo(n.timestamp)}] ${formatNoteBody(n)}`,
    ),
    stateLines.length ? "\nCurrent state data:" : "",
    ...stateLines,
    p.interactions.length ? "\nRecent interactions:" : "",
    ...p.interactions.map(
      (ix) =>
        `  - ${ix.type} ${daysAgo(ix.timestamp)}: ${(ix.summary ?? "").slice(0, 120)}`,
    ),
    p.plans.length ? "\nActive plans:" : "",
    ...p.plans.map(
      (plan) =>
        `  - ${plan.text}${plan.timescale ? ` (${plan.timescale})` : ""}`,
    ),
  ];
  return lines.filter(Boolean).join("\n");
}

async function getSchedule(workspaceId: string, date?: string) {
  const day =
    date ??
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const start = zonedMidnight(day, TZ);
  const end = zonedMidnight(shiftDay(day, 1), TZ);
  // Confirmed Events aren't the whole picture — anything synced from Google
  // Calendar but not yet promoted to an Event still lives as an active,
  // scheduled Plan (same union Home's own Schedule widget shows), so a
  // meeting that's only on the calendar was previously invisible here.
  const [events, plans] = await Promise.all([
    db.event.findMany({
      where: { workspaceId, start: { gte: start, lt: end } },
      select: { name: true, start: true, place: { select: { name: true } } },
      orderBy: { start: "asc" },
      take: 20,
    }),
    db.plan.findMany({
      where: {
        workspaceId,
        externalSource: "google-calendar",
        status: "active",
        scheduledStart: { gte: start, lt: end },
      },
      select: {
        text: true,
        scheduledStart: true,
        place: { select: { name: true } },
      },
      orderBy: { scheduledStart: "asc" },
      take: 20,
    }),
  ]);
  const items = [
    ...events.map((e) => ({ name: e.name, start: e.start, place: e.place })),
    ...plans.flatMap((p) =>
      p.scheduledStart
        ? [{ name: p.text, start: p.scheduledStart, place: p.place }]
        : [],
    ),
  ].sort((a, b) => a.start.getTime() - b.start.getTime());
  if (!items.length) return `No events on ${day}`;
  return items
    .map((i) => {
      const time = i.start.toLocaleTimeString("en-US", {
        timeZone: TZ,
        hour: "numeric",
        minute: "2-digit",
      });
      return `${time} ${i.name}${i.place ? ` @ ${i.place.name}` : ""}`;
    })
    .join("\n");
}

function shiftDay(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Pacific is -07:00 during PDT and -08:00 during PST — a hardcoded offset
// (the previous version of this function) is wrong for roughly half the
// year. This resolves the real offset for the given day instead.
function zonedMidnight(value: string, timeZone: string) {
  const utcMidnight = new Date(`${value}T00:00:00Z`);
  const offsetName = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  })
    .formatToParts(utcMidnight)
    .find((part) => part.type === "timeZoneName")?.value;
  const match = offsetName?.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  if (!match) return utcMidnight;
  const minutes =
    (Number(match[2]) * 60 + Number(match[3])) * (match[1] === "+" ? 1 : -1);
  return new Date(utcMidnight.getTime() - minutes * 60_000);
}

async function captureNote(
  input: Record<string, unknown>,
  workspaceId: string,
) {
  const { note } = await createCapturedNote({
    workspaceId,
    content: String(input.content ?? ""),
    type: input.noteType ? String(input.noteType) : "thought",
    source: "assistant",
    aboutPersonId: optionalString(input.personId),
    aboutPlaceId: optionalString(input.placeId),
    aboutItemId: optionalString(input.itemId),
    aboutEventId: optionalString(input.eventId),
    aboutPlanId: optionalString(input.planId),
    aboutGroupId: optionalString(input.groupId),
    aboutStateId: optionalString(input.stateId),
  });
  const subjects = [
    note.aboutPersonId ? `person ${note.aboutPersonId}` : null,
    note.aboutPlaceId ? `place ${note.aboutPlaceId}` : null,
    note.aboutItemId ? `item ${note.aboutItemId}` : null,
    note.aboutEventId ? `event ${note.aboutEventId}` : null,
    note.aboutPlanId ? `plan ${note.aboutPlanId}` : null,
    note.aboutGroupId ? `group ${note.aboutGroupId}` : null,
    note.aboutStateId ? `state ${note.aboutStateId}` : null,
  ].filter(Boolean);
  return `Captured ${note.type} (${note.id})${subjects.length ? ` about ${subjects.join(", ")}` : ""}. It will flow into synthesis.`;
}

// Every assistant write goes through a domain command rather than db.* directly,
// so it publishes a GraphEvent carrying the assistant actor and is therefore
// attributable and undoable. This one previously called db.interaction.create()
// and produced no audit trail at all.
const ASSISTANT_ACTOR = {
  type: "assistant" as const,
  label: "LifeOS Assistant",
};

async function logInteraction(
  personId: string,
  type: string,
  summary: string,
  workspaceId: string,
) {
  const person = await db.person.findFirst({
    where: { id: personId, workspaceId },
    select: { id: true, first: true, last: true },
  });
  if (!person) return "Person not found — search_people first";
  await createInteraction(
    { personId, type, summary, timestamp: new Date().toISOString() },
    workspaceId,
    ASSISTANT_ACTOR,
  );
  return `Logged ${type} with ${person.first} ${person.last}: ${summary}`;
}

async function searchOrganizationsTool(
  input: Record<string, unknown>,
  workspaceId: string,
) {
  const query = optionalString(input.query)?.toLowerCase();
  const orgs = await listRelationshipOrganizations(workspaceId, 40);
  const matched = query
    ? orgs.filter((o) => o.name.toLowerCase().includes(query))
    : orgs;
  if (!matched.length)
    return "No organizations with relationships recorded yet. create_group adds one.";
  return matched.map((o) => `${o.id} — ${o.name} (${o.groupType})`).join("\n");
}

async function getOrganizationTool(
  input: Record<string, unknown>,
  workspaceId: string,
) {
  const groupId = String(input.groupId ?? "").trim();
  if (!groupId) return "A groupId is required — search_organizations first";
  const dossier = await getOrganizationDossier(groupId, workspaceId);
  if (!dossier) return "Organization not found";
  const lines = [`${dossier.group.name} (${dossier.group.groupType})`];
  const i = dossier.interactions;
  lines.push(
    `Interactions: ${i.total}${i.total ? ` — ${i.byType.map((t) => `${t.count} ${t.type}`).join(", ")}` : ""}`,
  );
  if (i.firstAt)
    lines.push(
      `History: ${i.firstAt.toISOString().slice(0, 10)} to ${i.lastAt?.toISOString().slice(0, 10)}`,
    );
  if (dossier.spend.count)
    lines.push(
      `Spend: ${centsToDollars(dossier.spend.total)} across ${dossier.spend.count} transactions`,
    );
  if (dossier.people.length) {
    lines.push(
      `People: ${dossier.people.map((p) => `${p.name}${p.role ? ` (${p.role})` : ""}${p.current ? "" : " [former]"}`).join(", ")}`,
    );
  }
  if (dossier.places.length)
    lines.push(
      `Sites: ${dossier.places.map((p) => `${p.name} (${p.relationshipType})`).join(", ")}`,
    );
  if (dossier.facts.length)
    lines.push(
      `Facts: ${dossier.facts.map((f) => `${f.type}=${f.value} as of ${f.recordedAt.toISOString().slice(0, 10)}`).join("; ")}`,
    );
  if (dossier.notes.length)
    lines.push(
      `Notes:\n${dossier.notes.map((n) => `  [${n.timestamp.toISOString().slice(0, 10)}] ${n.content.slice(0, 200)}`).join("\n")}`,
    );
  return lines.join("\n");
}

async function createGroupTool(
  input: Record<string, unknown>,
  workspaceId: string,
) {
  const name = String(input.name ?? "").trim();
  if (!name) return "An organization needs a name";
  const group = await createGroup(
    {
      name,
      groupType: optionalString(input.groupType) ?? "corporation",
      notes: optionalString(input.notes),
    },
    workspaceId,
    ASSISTANT_ACTOR,
  );
  return `Created ${group.name} (${group.id}). Use it as groupId in other tools.`;
}

async function addPersonToGroupTool(
  input: Record<string, unknown>,
  workspaceId: string,
) {
  const groupId = String(input.groupId ?? "").trim();
  const personId = String(input.personId ?? "").trim();
  if (!groupId || !personId)
    return "Both groupId and personId are required — search first";
  await addMember(
    groupId,
    { personId, role: optionalString(input.role) },
    workspaceId,
    ASSISTANT_ACTOR,
  );
  return `Recorded membership in ${groupId} for person ${personId}.`;
}

async function createItemTool(
  input: Record<string, unknown>,
  workspaceId: string,
) {
  const name = String(input.name ?? "").trim();
  if (!name) return "An item needs a name";
  // No `as never` here. The cast that was here suppressed exactly the two errors
  // that mattered: assetId is required, and the column is `make`, not `brand`.
  // assetId is now generated by the domain layer when omitted.
  const item = await createItem(
    {
      name,
      ...(optionalString(input.category)
        ? { category: optionalString(input.category)! }
        : {}),
      ...(optionalString(input.make)
        ? { make: optionalString(input.make)! }
        : {}),
      ...(optionalString(input.model)
        ? { model: optionalString(input.model)! }
        : {}),
      ...(optionalString(input.serialNumber)
        ? { serialNumber: optionalString(input.serialNumber)! }
        : {}),
      ...(optionalString(input.notes)
        ? { notes: optionalString(input.notes)! }
        : {}),
      ...(optionalString(input.placeId)
        ? { placeId: optionalString(input.placeId)! }
        : {}),
    },
    workspaceId,
    ASSISTANT_ACTOR,
  );
  return `Created item ${item.id} (${item.assetId}): ${item.name}. Use ${item.id} as itemId in other tools.`;
}

async function createPlanTool(
  input: Record<string, unknown>,
  workspaceId: string,
) {
  const text = String(input.text ?? "").trim();
  if (!text) return "A plan needs text";
  const plan = await createPlan(
    {
      text,
      personId: optionalString(input.personId),
      timescale: optionalString(input.timescale),
    },
    workspaceId,
    ASSISTANT_ACTOR,
  );
  return `Created plan ${plan.id}: ${plan.text}`;
}

async function addPlaceNoteTool(
  input: Record<string, unknown>,
  workspaceId: string,
) {
  const placeId = String(input.placeId ?? "").trim();
  const body = String(input.body ?? "").trim();
  if (!placeId || !body)
    return "A place note needs placeId and body — search_places first";
  const note = await createPlaceNote(placeId, workspaceId, body, {
    actor: ASSISTANT_ACTOR,
  });
  return `Added note to place ${placeId} (${note.id})`;
}

async function queryFinance(
  sinceDays: number,
  workspaceId: string,
  merchant?: string,
  category?: string,
) {
  const days = Math.min(
    365,
    Math.max(1, Math.round(Number.isFinite(sinceDays) ? sinceDays : 30)),
  );
  return formatSpendBreakdown(
    await getSpendBreakdown(
      { dateExpression: `last ${days} days`, merchant, category, limit: 8 },
      workspaceId,
    ),
  );
}

async function spendBreakdown(
  input: Record<string, unknown>,
  workspaceId: string,
) {
  const query: SpendBreakdownInput = {
    dateExpression: optionalString(input.dateExpression),
    startDate: optionalString(input.startDate),
    endDate: optionalString(input.endDate),
    merchant: optionalString(input.merchant),
    category: optionalString(input.category),
    placeName: optionalString(input.placeName),
    limit: typeof input.limit === "number" ? input.limit : undefined,
  };

  // "whose money" scoping — resolve a name to a person, or to the household.
  const who = optionalString(input.who);
  let scopeLabel = "";
  if (who) {
    const scope = await resolveSpendScope(who, workspaceId);
    if (!scope) return `No person or household matching "${who}"`;
    if (scope.kind === "person") query.actorPersonId = scope.id;
    else query.groupId = scope.id;
    scopeLabel = `\nScope: ${scope.label}`;
  }

  return (
    formatSpendBreakdown(await getSpendBreakdown(query, workspaceId)) +
    scopeLabel
  );
}

/**
 * "us"/"we"/"family" resolves to the household Group; a name resolves to that
 * person. Household scope covers members' personal spend plus joint spend on
 * shared accounts, which no single actorPersonId can express.
 */
async function resolveSpendScope(who: string, workspaceId: string) {
  const q = who.trim().toLowerCase();
  if (
    ["us", "we", "our", "ours", "family", "household", "the family"].includes(q)
  ) {
    const group = await db.group.findFirst({
      where: { workspaceId, groupType: "family" },
      select: { id: true, name: true },
    });
    return group
      ? { kind: "group" as const, id: group.id, label: group.name }
      : null;
  }

  const person = await db.person.findFirst({
    where: {
      workspaceId,
      OR: [
        { first: { contains: who, mode: "insensitive" as const } },
        { last: { contains: who, mode: "insensitive" as const } },
        { nickname: { contains: who, mode: "insensitive" as const } },
      ],
      // Only people who actually own an account can be a spend actor.
      ownedEraAccounts: { some: {} },
    },
    select: { id: true, first: true, last: true },
  });
  return person
    ? {
        kind: "person" as const,
        id: person.id,
        label: `${person.first} ${person.last}`,
      }
    : null;
}

type SpendBreakdownResult = Awaited<ReturnType<typeof getSpendBreakdown>>;

function formatSpendBreakdown(result: SpendBreakdownResult) {
  const filters = [
    result.filters.merchant ? `merchant~"${result.filters.merchant}"` : "",
    result.filters.category ? `category~"${result.filters.category}"` : "",
    result.filters.placeName ? `place~"${result.filters.placeName}"` : "",
  ].filter(Boolean);

  const heading = `Spend breakdown for ${result.range.label} (${result.range.startDate}${result.range.endDate !== result.range.startDate ? ` through ${result.range.endDate}` : ""}, ${result.range.timezone})${filters.length ? ` · ${filters.join(" · ")}` : ""}`;
  if (!result.transactionCount)
    return `${heading}\nNo paid transactions found.`;

  return [
    heading,
    `Total paid: ${currency(result.total)} across ${result.transactionCount} transaction${result.transactionCount === 1 ? "" : "s"}`,
    formatGroup("By category", result.byCategory),
    formatGroup("By merchant", result.byMerchant),
    result.byPlace.length ? formatGroup("By place", result.byPlace) : "",
    formatTransactions("Largest transactions", result.largestTransactions),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function formatGroup(
  title: string,
  rows: Array<{ name: string; total: number; count: number }>,
) {
  if (!rows.length) return `${title}: none`;
  return [
    `${title}:`,
    ...rows.map(
      (row) => `- ${row.name}: ${currency(row.total)} (${row.count}x)`,
    ),
  ].join("\n");
}

function formatTransactions(
  title: string,
  rows: SpendBreakdownResult["largestTransactions"],
) {
  if (!rows.length) return "";
  return [
    `${title}:`,
    ...rows.map((row) => {
      const suffix = [row.category, row.place].filter(Boolean).join(" · ");
      return `- ${row.date} ${row.merchant}: ${currency(row.amount)}${suffix ? ` (${suffix})` : ""}`;
    }),
  ].join("\n");
}

function currency(value: number) {
  return `$${value.toFixed(2)}`;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function getPlaceSpend(workspaceId: string, placeName?: string) {
  // Place links live on Interaction.placeId, attached by the enrichment
  // reconciler — so this grows on its own as location data arrives.
  const result = await placeSpend(workspaceId, placeName);
  if (!result.places.length)
    return placeName
      ? `No place-matched spend for "${placeName}"`
      : "No place-matched spend yet";
  return [
    `Spend by place (${result.range.label}):`,
    ...result.places.map(
      (row) => `- ${row.name}: ${currency(row.total)} (${row.count}x)`,
    ),
  ].join("\n");
}

async function searchNotes(
  input: Record<string, unknown>,
  workspaceId: string,
) {
  const query = String(input.query ?? "").trim();
  if (!query) return "Empty query";
  const notes = await db.note.findMany({
    where: {
      workspaceId,
      content: { contains: query, mode: "insensitive" as const },
      ...(optionalString(input.personId)
        ? { aboutPersonId: optionalString(input.personId) }
        : {}),
      ...(optionalString(input.placeId)
        ? { aboutPlaceId: optionalString(input.placeId) }
        : {}),
      ...(optionalString(input.itemId)
        ? { aboutItemId: optionalString(input.itemId) }
        : {}),
    },
    orderBy: { timestamp: "desc" },
    take: 5,
    select: {
      type: true,
      timestamp: true,
      content: true,
      metadata: true,
      aboutPersonId: true,
      aboutPlaceId: true,
      aboutItemId: true,
    },
  });
  if (!notes.length) return `No notes matching "${query}"`;
  return notes
    .map((n) => {
      const about = [
        n.aboutPersonId ? `person=${n.aboutPersonId}` : null,
        n.aboutPlaceId ? `place=${n.aboutPlaceId}` : null,
        n.aboutItemId ? `item=${n.aboutItemId}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return `[${n.type} · ${daysAgo(n.timestamp)}${about ? ` · ${about}` : ""}] ${formatNoteBody(n)}`;
    })
    .join("\n---\n");
}

// Long captured Notes (documents, voice transcripts, photo digests) get a
// lightweight LLM fact extraction pass (scripts/synthesis/note-facts.ts) that
// lands in metadata.extraction — prefer that compact form over dumping the
// first 200 characters of, say, a 200,000-character lease agreement.
function formatNoteBody(note: {
  content: string;
  metadata: string | null;
}): string {
  const extraction = parseExtraction(note.metadata);
  if (!extraction) return note.content.slice(0, 200);

  const factsLine = extraction.facts
    .map((f) => `${f.key}: ${f.value}`)
    .join(" · ");
  return [extraction.summary, factsLine].filter(Boolean).join("\n  ");
}

function parseExtraction(
  metadata: string | null,
): { summary: string; facts: Array<{ key: string; value: string }> } | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as {
      extraction?: {
        summary?: string;
        facts?: Array<{ key: string; value: string }>;
      };
    };
    if (!parsed.extraction?.summary) return null;
    return {
      summary: parsed.extraction.summary,
      facts: parsed.extraction.facts ?? [],
    };
  } catch {
    return null;
  }
}

async function listInbox(limit: number, workspaceId: string) {
  const items = await db.stagedInteraction.findMany({
    where: { workspaceId, status: "pending", type: { not: "financial" } },
    orderBy: { createdAt: "desc" },
    take: Math.min(10, Math.max(1, limit)),
    select: {
      contactName: true,
      contactEmail: true,
      summary: true,
      source: true,
      timestamp: true,
    },
  });
  const total = await db.stagedInteraction.count({
    where: { workspaceId, status: "pending", type: { not: "financial" } },
  });
  if (!total) return "Inbox is clear";
  return [
    `${total} pending items. Most recent:`,
    ...items.map(
      (i) =>
        `- [${i.source}] ${i.contactName ?? i.contactEmail ?? "unknown"} ${daysAgo(i.timestamp)}: ${(i.summary ?? "").slice(0, 100)}`,
    ),
  ].join("\n");
}

async function searchPlaces(query: string, workspaceId: string) {
  if (!query.trim()) return "Empty query";
  const q = query.trim();
  const places = await db.place.findMany({
    where: {
      workspaceId,
      OR: [
        { name: { contains: q, mode: "insensitive" as const } },
        { address: { contains: q, mode: "insensitive" as const } },
        { type: { contains: q, mode: "insensitive" as const } },
      ],
    },
    select: {
      id: true,
      name: true,
      type: true,
      address: true,
      favorite: true,
      parentPlace: { select: { name: true } },
    },
    take: 8,
  });
  if (!places.length) return `No places matching "${q}"`;
  return places
    .map(
      (p) =>
        `${p.name}${p.favorite ? " ★" : ""} · id=${p.id} · ${p.type ?? "unknown type"}${p.parentPlace ? ` · in ${p.parentPlace.name}` : ""}${p.address ? ` · ${p.address}` : ""}`,
    )
    .join("\n");
}

async function getPlace(placeId: string, workspaceId: string) {
  const place = await db.place.findFirst({
    where: { id: placeId, workspaceId },
    include: {
      parentPlace: { select: { name: true } },
      childPlaces: { select: { name: true }, take: 10 },
      notes: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { body: true, createdAt: true },
      },
      aboutNotes: {
        orderBy: { timestamp: "desc" },
        take: 5,
        select: { type: true, timestamp: true, content: true, metadata: true },
      },
      items: { select: { name: true, category: true }, take: 15 },
      events: {
        orderBy: { start: "desc" },
        take: 5,
        select: { name: true, start: true },
      },
    },
  });
  if (!place) return "Place not found";

  const lines = [
    `${place.name}${place.favorite ? " ★ favorite" : ""}`,
    [place.type, place.address].filter(Boolean).join(" · "),
    place.meaning ? `Meaning: ${place.meaning}` : "",
    place.parentPlace ? `In: ${place.parentPlace.name}` : "",
    place.childPlaces.length
      ? `Contains: ${place.childPlaces.map((c) => c.name).join(", ")}`
      : "",
    place.items.length ? "\nItems here:" : "",
    ...place.items.map(
      (i) => `  - ${i.name}${i.category ? ` (${i.category})` : ""}`,
    ),
    place.notes.length ? "\nPlace notes:" : "",
    ...place.notes.map(
      (n) => `  - ${daysAgo(n.createdAt)}: ${n.body.slice(0, 150)}`,
    ),
    place.aboutNotes.length ? "\nGraph notes about this place:" : "",
    ...place.aboutNotes.map(
      (n) => `  - [${n.type} · ${daysAgo(n.timestamp)}] ${formatNoteBody(n)}`,
    ),
    place.events.length ? "\nRecent events here:" : "",
    ...place.events.map((e) => `  - ${e.name} (${daysAgo(e.start)})`),
  ];
  return lines.filter(Boolean).join("\n");
}

async function searchItems(query: string, workspaceId: string) {
  if (!query.trim()) return "Empty query";
  const q = query.trim();
  const items = await db.item.findMany({
    where: {
      workspaceId,
      OR: [
        { name: { contains: q, mode: "insensitive" as const } },
        { category: { contains: q, mode: "insensitive" as const } },
        { make: { contains: q, mode: "insensitive" as const } },
        { model: { contains: q, mode: "insensitive" as const } },
        { assetId: { contains: q, mode: "insensitive" as const } },
      ],
    },
    select: {
      id: true,
      name: true,
      category: true,
      assetId: true,
      place: { select: { name: true } },
    },
    take: 8,
  });
  if (!items.length) return `No items matching "${q}"`;
  return items
    .map(
      (i) =>
        `${i.name} · id=${i.id} · ${i.assetId}${i.category ? ` · ${i.category}` : ""}${i.place ? ` · at ${i.place.name}` : " · no location set"}`,
    )
    .join("\n");
}

async function getItem(itemId: string, workspaceId: string) {
  const item = await db.item.findFirst({
    where: { id: itemId, workspaceId },
    include: {
      place: { select: { name: true } },
      ownedBy: { select: { first: true, last: true } },
      components: {
        where: { disassembledAt: null },
        select: { childItem: { select: { name: true } } },
      },
      assembledInto: {
        where: { disassembledAt: null },
        select: { parentItem: { select: { name: true } } },
      },
      aboutNotes: {
        orderBy: { timestamp: "desc" },
        take: 5,
        select: { type: true, timestamp: true, content: true, metadata: true },
      },
    },
  });
  if (!item) return "Item not found";

  const lines = [
    `${item.name} (${item.assetId})`,
    [item.category, item.make, item.model].filter(Boolean).join(" · "),
    item.serialNumber ? `Serial: ${item.serialNumber}` : "",
    item.assembledInto.length
      ? `Currently inside: ${item.assembledInto.map((a) => a.parentItem.name).join(", ")}`
      : item.place
        ? `Location: ${item.place.name}`
        : "Location: not set",
    item.ownedBy ? `Owner: ${item.ownedBy.first} ${item.ownedBy.last}` : "",
    item.components.length
      ? `Contains: ${item.components.map((c) => c.childItem.name).join(", ")}`
      : "",
    item.purchaseDate
      ? `Purchased: ${item.purchaseDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}${item.purchasePrice ? ` for $${centsToDollars(item.purchasePrice)}` : ""}${item.purchaseFrom ? ` from ${item.purchaseFrom}` : ""}`
      : "",
    item.lifetimeWarranty
      ? "Warranty: lifetime"
      : item.warrantyExpires
        ? `Warranty until ${item.warrantyExpires.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
        : "",
    item.notes ? `Notes blob: ${item.notes.slice(0, 300)}` : "",
    item.aboutNotes.length ? "Notes about it:" : "",
    ...item.aboutNotes.map(
      (n) => `  - [${n.type} · ${daysAgo(n.timestamp)}] ${formatNoteBody(n)}`,
    ),
  ];
  return lines.filter(Boolean).join("\n");
}

async function searchEvents(
  query: string,
  sinceDays: number,
  workspaceId: string,
) {
  if (!query.trim()) return "Empty query";
  const q = query.trim();
  const days = Math.min(
    730,
    Math.max(1, Math.round(Number.isFinite(sinceDays) ? sinceDays : 90)),
  );
  const since = new Date(Date.now() - days * 86400000);
  const events = await db.event.findMany({
    where: {
      workspaceId,
      start: { gte: since },
      OR: [
        { name: { contains: q, mode: "insensitive" as const } },
        { notes: { contains: q, mode: "insensitive" as const } },
      ],
    },
    select: {
      name: true,
      type: true,
      start: true,
      place: { select: { name: true } },
    },
    orderBy: { start: "desc" },
    take: 10,
  });
  if (!events.length)
    return `No events matching "${q}" in the last ${days} days`;
  return events
    .map((e) => {
      const when = e.start.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      return `${when} · ${e.name}${e.place ? ` @ ${e.place.name}` : ""}`;
    })
    .join("\n");
}

async function getTheory(personId: string, workspaceId: string) {
  const theory = await db.theorySnapshot.findFirst({
    where: { subjectPersonId: personId, workspaceId, status: "current" },
    orderBy: { version: "desc" },
    select: {
      title: true,
      summary: true,
      markdownBody: true,
      confidence: true,
      synthesizedAt: true,
    },
  });
  if (!theory) return "No theory synthesized for this person yet";
  return [
    `${theory.title}${theory.confidence != null ? ` (confidence ${Math.round(theory.confidence * 100)}%)` : ""}`,
    `Synthesized ${daysAgo(theory.synthesizedAt)}`,
    "",
    theory.summary,
    "",
    theory.markdownBody.slice(0, 1500),
  ].join("\n");
}

async function getAlignmentSignalsTool(workspaceId: string) {
  const { getAlignmentSignals } = await import("@life-os/alignment");
  const signals = await getAlignmentSignals(workspaceId);
  if (!signals.length)
    return "No gaps detected — relationships and person-linked plans are all on track.";
  return signals
    .map(
      (s) =>
        `[${s.kind}] ${s.subject}: ${s.detail} (${s.severity.toFixed(1)}x threshold)`,
    )
    .join("\n");
}

function daysAgo(date: Date) {
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

// ── The unified stream and the remaining primitives ──────────────
//
// Person, Place, Item, Event and Note already had tools. Plan, Group and State
// had none, and interactions were only reachable one person at a time — which
// is the exact limitation the graph was built to remove.

async function getInteractionStream(
  input: Record<string, unknown>,
  workspaceId: string,
) {
  const days = clampNumber(input.sinceDays, 14, 1, 3650);
  const limit = clampNumber(input.limit, 25, 1, 100);
  const since = new Date(Date.now() - days * 86_400_000);

  const personName = optionalString(input.personName);
  const person = personName
    ? await db.person.findFirst({
        where: {
          workspaceId,
          OR: [
            { first: { contains: personName, mode: "insensitive" as const } },
            { last: { contains: personName, mode: "insensitive" as const } },
            {
              nickname: { contains: personName, mode: "insensitive" as const },
            },
          ],
        },
        select: { id: true, first: true, last: true },
      })
    : null;
  if (personName && !person) return `No person matching "${personName}"`;

  const merchant = optionalString(input.merchant);
  const rows = await db.interaction.findMany({
    where: {
      workspaceId,
      // Bounded at both ends. Calendar entries run years ahead, and ordering by
      // timestamp desc without an upper bound puts 2027 reservations at the top
      // of "what have I been doing lately".
      timestamp: { gte: since, lte: new Date() },
      ...(optionalString(input.type)
        ? { type: optionalString(input.type) }
        : {}),
      ...(person
        ? { OR: [{ personId: person.id }, { actorPersonId: person.id }] }
        : {}),
      ...(merchant
        ? {
            OR: [
              {
                merchantName: {
                  contains: merchant,
                  mode: "insensitive" as const,
                },
              },
              { summary: { contains: merchant, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { timestamp: "desc" },
    take: limit,
    select: {
      timestamp: true,
      type: true,
      subtype: true,
      summary: true,
      merchantName: true,
      amount: true,
      direction: true,
      category: true,
      person: { select: { first: true, last: true } },
      place: { select: { name: true } },
      event: { select: { name: true } },
    },
  });
  if (!rows.length)
    return `No interactions in the last ${days} days matching that filter.`;

  const scope = [
    person ? `${person.first} ${person.last}` : "",
    merchant ? `merchant~"${merchant}"` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return [
    `Interaction stream — last ${days} days${scope ? ` · ${scope}` : ""} (${rows.length} shown, newest first):`,
    ...rows.map((row) => {
      const money =
        row.amount !== null
          ? ` ${row.direction === "received" ? "+" : "-"}${currency(centsToDollars(row.amount) ?? 0)}`
          : "";
      const who = row.person
        ? ` w/ ${row.person.first} ${row.person.last}`
        : "";
      const context = [row.place?.name, row.event?.name, row.category]
        .filter(Boolean)
        .join(" · ");
      const label = row.merchantName ?? row.summary ?? row.subtype ?? row.type;
      return `- ${localDate(row.timestamp)} [${row.type}]${money} ${label}${who}${context ? ` (${context})` : ""}`;
    }),
  ].join("\n");
}

async function getPlans(input: Record<string, unknown>, workspaceId: string) {
  const limit = clampNumber(input.limit, 20, 1, 100);
  const status = optionalString(input.status) ?? "active";
  const personName = optionalString(input.personName);
  const person = personName
    ? await db.person.findFirst({
        where: {
          workspaceId,
          OR: [
            { first: { contains: personName, mode: "insensitive" as const } },
            { last: { contains: personName, mode: "insensitive" as const } },
          ],
        },
        select: { id: true },
      })
    : null;

  const rows = await db.plan.findMany({
    where: {
      workspaceId,
      ...(status === "any" ? {} : { status: status as never }),
      ...(person ? { personId: person.id } : {}),
      ...(input.overdueOnly === true
        ? { dueOn: { lt: new Date() }, completedAt: null }
        : {}),
    },
    orderBy: [{ dueOn: "asc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      text: true,
      status: true,
      timescale: true,
      dueOn: true,
      completedAt: true,
      successSignals: true,
      person: { select: { first: true, last: true } },
    },
  });
  if (!rows.length)
    return `No ${status} plans${person ? " for that person" : ""}.`;

  const now = Date.now();
  return [
    `Declared plans (${status}, ${rows.length}):`,
    ...rows.map((row) => {
      const due = row.dueOn
        ? ` · due ${localDate(row.dueOn)}${row.dueOn.getTime() < now && !row.completedAt ? " OVERDUE" : ""}`
        : "";
      const who = row.person ? ` · ${row.person.first} ${row.person.last}` : "";
      // successSignals doubles as a provenance blob on calendar-derived plans;
      // a wall of sync JSON buries the plan text it is attached to.
      const signal = readableSignal(row.successSignals);
      return `- ${row.text}${due}${who}${row.timescale ? ` · ${row.timescale}` : ""}${signal}`;
    }),
  ].join("\n");
}

async function getStates(input: Record<string, unknown>, workspaceId: string) {
  const days = clampNumber(input.sinceDays, 30, 1, 3650);
  const limit = clampNumber(input.limit, 30, 1, 100);
  const query = optionalString(input.query);
  const rows = await db.state.findMany({
    where: {
      workspaceId,
      recordedAt: { gte: new Date(Date.now() - days * 86_400_000) },
      ...(optionalString(input.entityType)
        ? { entityType: optionalString(input.entityType) }
        : {}),
      ...(query
        ? {
            definition: {
              OR: [
                { type: { contains: query, mode: "insensitive" as const } },
                { value: { contains: query, mode: "insensitive" as const } },
              ],
            },
          }
        : {}),
    },
    orderBy: { recordedAt: "desc" },
    take: limit,
    select: {
      recordedAt: true,
      entityType: true,
      severity: true,
      source: true,
      definition: { select: { type: true, value: true, description: true } },
    },
  });
  if (!rows.length)
    return `No states recorded in the last ${days} days${query ? ` matching "${query}"` : ""}.`;

  return [
    `Recorded states — last ${days} days (${rows.length}, newest first):`,
    ...rows.map((row) => {
      const severity = row.severity !== null ? ` (${row.severity})` : "";
      return `- ${localDate(row.recordedAt)} ${row.definition.type}: ${row.definition.value}${severity} [${row.entityType}]`;
    }),
  ].join("\n");
}

async function searchGroups(
  input: Record<string, unknown>,
  workspaceId: string,
) {
  const limit = clampNumber(input.limit, 15, 1, 50);
  const query = optionalString(input.query);
  const groups = await db.group.findMany({
    where: {
      workspaceId,
      ...(query
        ? { name: { contains: query, mode: "insensitive" as const } }
        : {}),
      ...(optionalString(input.groupType)
        ? { groupType: optionalString(input.groupType) as never }
        : {}),
    },
    take: limit,
    select: {
      id: true,
      name: true,
      groupType: true,
      personMembers: {
        select: { role: true, person: { select: { first: true, last: true } } },
        take: 10,
      },
    },
  });
  if (!groups.length) return `No groups matching "${query ?? "any"}"`;

  // Spend with a merchant is the counterparty edge, aggregated.
  const totals = await db.interactionParticipant.groupBy({
    by: ["entityId"],
    where: {
      workspaceId,
      entityType: "Group",
      role: "counterparty",
      entityId: { in: groups.map((g) => g.id) },
    },
    _count: true,
  });
  const countById = new Map(totals.map((t) => [t.entityId, t._count]));

  return [
    `Groups (${groups.length}):`,
    ...groups.map((group) => {
      const members = group.personMembers.length
        ? ` · members: ${group.personMembers.map((m) => `${m.person.first} ${m.person.last}${m.role ? ` (${m.role})` : ""}`).join(", ")}`
        : "";
      const transactions = countById.get(group.id);
      return `- ${group.name} [${group.groupType}]${transactions ? ` · ${transactions} transactions` : ""}${members}`;
    }),
  ].join("\n");
}

/** Show a success signal only when it is prose a human wrote. */
function readableSignal(value: string | null) {
  if (!value) return "";
  const trimmed = value.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "";
  return ` · success: ${trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed}`;
}

function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  const n =
    typeof value === "number" && Number.isFinite(value)
      ? Math.round(value)
      : fallback;
  return Math.min(max, Math.max(min, n));
}

function localDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// Name → capability, derived from the definitions above so the two can never
// disagree. agent.ts resolves through this and treats an unknown name as
// destructive.
export const TOOL_CAPABILITIES: Record<string, ToolCapability> =
  Object.fromEntries(TOOLS.map((tool) => [tool.name, tool.capability]));

export const TOOL_REQUIRED_SCOPES: Record<string, string> =
  Object.fromEntries(TOOLS.map((tool) => [tool.name, tool.requiredScope]));

export function toolsForScopes(scopes: string[]) {
  return TOOLS.filter(tool => hasScope(scopes, tool.requiredScope))
}

export function hasScope(scopes: string[], requiredScope: string) {
  return scopes.includes("*") || scopes.includes(requiredScope)
}
