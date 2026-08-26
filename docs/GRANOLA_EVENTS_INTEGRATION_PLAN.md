# Granola → Events Integration Plan

**Status:** slice 1 implemented; scheduled reconciliation implemented; production connection pending rotated key and deployment  
**Owner:** LifeOS Events  
**Last reviewed:** 2026-08-14

## Outcome

Every completed Granola meeting becomes part of the shared LifeOS graph:

- one canonical **Event** for the meeting;
- the Granola summary and transcript stored once on that Event;
- known attendees linked through **Interaction** / `InteractionParticipant` edges;
- the source Granola note, update time, and URL retained as auditable provenance;
- relevant company/team **Groups** linked to the Event;
- a Group meeting lens that derives company context across all linked meetings.

This does not add a primitive. It connects Event, Person, Group, and Interaction using the existing model.

## Product shape

### Connect

Events Settings gains a Granola connection card:

1. Paste a Granola API key generated in Granola under **Settings → Connectors → API keys**.
2. Test the key and show the accessible note scopes.
3. Choose **all accessible meetings** or selected Granola folders.
4. Choose whether to backfill all history or start from a selected date.
5. Show connection status, last successful sync, most recent error, and imported meeting count.

The default is all accessible meetings plus a complete historical backfill. Folder filtering is an optional privacy/scope control, not a substitute for pagination.

### Event detail

A Granola-backed Event shows:

- Granola summary;
- full transcript, collapsed initially when long;
- source link opening the exact Granola note;
- meeting owner, organizer, scheduled times, and attendees;
- participant matching state and any unresolved attendees;
- linked company/team Groups;
- source and last-sync provenance.

User-added Event context remains separate from provider-owned content so a later Granola edit cannot overwrite it.

### Company meeting lens

Use the existing **Group** primitive (`employer` or `corporation`). A Group view should derive:

- meeting timeline and cadence;
- last meeting and next calendar-backed Plan, when present;
- known people met, attendee coverage, and relationship recency;
- recurring topics, decisions, open action items, risks, and unresolved questions;
- direct links to the source Events and transcript evidence.

The first slice should ship the deterministic timeline, cadence, people, and unresolved-attendee review. Cross-meeting AI synthesis follows only after the underlying links and provenance are trustworthy. Any synthesis is a refreshable, evidence-backed derived view, not a new primitive or permanent aggregate.

## Canonical mapping

| Granola data | LifeOS destination | Rule |
| --- | --- | --- |
| Meeting note | `Event` | One Event per Granola note, unless it matches an existing calendar Event. |
| Title and scheduled times | `Event.name`, `start`, `end`, `timestamp` | Granola is allowed to fill provider-owned fields; manual overrides win. |
| AI summary | provider-owned Event content | Store once; do not copy onto every participant Interaction. |
| Transcript | `Event.transcript` | Preserve the complete transcript; use Granola's transcript endpoint when inline retrieval is too large. |
| Personal notes | provider-owned Event content | Preserve separately from the generated summary when returned. |
| Owner, organizer, invitees | Person participants | Exact normalized email match only. Unknown or ambiguous identities go to review. Invitees who declined the calendar event are not participants. |
| Company/team association | `Event.groupTags` | Explicit user choice wins; safe inference may link an existing Group. Never create a Group silently. |
| Granola note ID and URL | supporting provenance link | External note ID is the idempotency anchor; source URL opens the exact note. |
| Granola folder | sync scope metadata | May suggest an existing Group but must not become a Group automatically. |

## Deduplication and identity rules

1. Match an existing Event by an existing `CalendarEventLink` when Granola's `calendar_event_id` agrees with the provider event ID or iCal UID.
2. Otherwise match only on a strong compound key: workspace, exact scheduled start, organizer email, and normalized title.
3. If neither match is unique, create a new Event and flag the possible duplicate for review.
4. Upsert the Granola link by `(workspaceId, externalNoteId)` so webhook retries and backfills are harmless.
5. Match attendees through exact normalized email addresses, including the repo's canonical person-email index. Do not create People from display names or email domains.
6. Create one meeting Interaction per matched attendee and dual-write typed participants. Shared summary/transcript remain on the Event.

## Group inference

Company context is derived from facts already in the graph:

- active `PersonGroup` memberships at the meeting time;
- exact attendee email domains when that domain has already been explicitly associated with one Group;
- explicit Event group tags;
- repeated co-occurrence across meetings.

Safe auto-linking is allowed only when one existing Group is unambiguous. Competing Groups, unknown domains, or a proposed new company go to Home review. The system should explain the evidence (for example, “3 of 4 matched attendees were active Acme members”).

## Connector architecture

### Supporting records

Use supporting records rather than primitives:

- the unified `Connection` model: workspace/user ownership, encrypted API key, status, sync watermark, last success/error, and non-secret run metadata (`kind=meetings`, `provider=granola`).
- `GranolaNoteLink`: external note ID, canonical Event ID, remote update timestamp, exact source URL, content hash, and last sync status.
- webhook delivery receipt or the existing `GraphEventReceipt` pattern keyed by Granola `event_id` for retry deduplication.

Secrets must use the existing encryption utilities and must never be returned to the browser after connection.

### Historical backfill

1. List notes with `page_size=30` and follow every cursor until `hasMore=false`.
2. Fetch each note with `include=transcript`.
3. On `TRANSCRIPT_TOO_LARGE` / HTTP 413, fetch the dedicated transcript endpoint.
4. Upsert the canonical Event, participants, Groups, and provenance link transactionally.
5. Record per-note failures and continue; retry safely from source IDs.
6. Advance the watermark only after all pages in the window are accounted for.

No fixed result cap is acceptable for “all meetings.”

### Ongoing sync

Subscribe to `note.generated`, `note.access_granted`, and `note.edited` webhooks. The receiver must:

- read and verify the signature against the raw request body;
- reject stale timestamps to prevent replay;
- deduplicate on `event_id`;
- acknowledge within Granola's 15-second window;
- fetch the current note from the API and process it asynchronously;
- preserve user-added Event context when provider content changes.

A scheduled incremental reconciliation using `updated_after` remains as repair coverage because disabled webhook endpoints do not replay missed events.

## Safety and automation policy

| Action | Default |
| --- | --- |
| Import/update a note by exact Granola note ID | Automatic |
| Fill transcript, summary, times, and source link | Automatic |
| Match a unique existing calendar Event | Automatic |
| Link an attendee by one exact email match | Automatic |
| Link one unambiguous existing Group | Automatic with recorded evidence |
| Choose between multiple People or Groups | Review required |
| Create a new Person or Group | Review required |
| Overwrite user-authored Event context | Never |
| Delete an Event because Granola access changed | Never; mark source unavailable |

## Delivery slices

### Slice 1 — visible vertical slice (implemented)

- Granola connection/settings UI.
- Complete paginated backfill and manual “Sync now.”
- Canonical Event upsert with summary, full transcript, exact source link, and edit-safe provenance.
- Exact-email attendee matching plus unresolved-attendee review.
- Existing-Group linking and a deterministic Group meeting timeline.
- Integration tests for pagination, idempotency, calendar deduplication, identity ambiguity, and provider edits.

### Slice 2 — durable automation (daily reconciliation implemented; webhooks pending)

- Signed webhook receiver and delivery deduplication.
- Background processing plus scheduled reconciliation.
- Per-note retry/status visibility and operational runbook.

### Slice 3 — company intelligence

- Group meeting dashboard with cadence, people coverage, decisions, themes, and open actions.
- Evidence-backed cross-meeting synthesis with direct links to Event/transcript sources.
- Assistant tools that query the same Group/Event graph rather than a separate Granola silo.

## Prerequisites and blockers

- Granola's API and webhooks currently require a Business or Enterprise plan.
- The user must create a Granola API key with the intended personal/public note scopes.
- The Codex Granola plugin is useful for inspecting real data, but it is not the credential or runtime for automatic LifeOS ingestion.
- Production webhook registration waits until the receiver is deployed at a stable HTTPS URL and its signing secret can be stored immediately; Granola shows that secret only once.
- This work should start on a dedicated `codex/granola-events-integration` branch, not the current `feat/file-intelligence` branch.

## Required documentation updates during implementation

- `docs/PERSONS_ARCHITECTURE.md` for Person/Group inputs and review flow.
- an Events integration/runbook document covering connection, backfill, webhook recovery, secret rotation, and disconnect behavior.
- `apps/events/AGENTS.md` with the Granola routes, models, and verification commands.

## Verification gates

- unit tests for payload parsing, transcript formatting, signature verification, and identity/group inference;
- integration tests proving all cursor pages are reachable and repeated imports are idempotent;
- a fixture where Granola and Google Calendar resolve to one Event;
- a fixture where unknown/ambiguous attendees do not create People;
- a fixture where edited summaries update provider content without overwriting user context;
- local auth via `LIFE_OS_LOCAL_REVIEW=1` with non-production fixture data only;
- production smoke test limited to read-only API access first, then one explicitly chosen note before enabling historical backfill.
