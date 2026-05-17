# Persons Architecture Map

This is the plain-English map of how the Persons app is currently wired.

This is a living document. Codex and Claude should update it whenever the Persons app gains or changes inputs, outputs, APIs, domain command flow, rules/automation behavior, database models, integrations, or deployment/runtime plumbing.

Think of the app as four layers:

1. **Inputs**: places information comes from.
2. **Front doors**: UI pages, APIs, and scripts that receive that information.
3. **Plumbing**: domain commands that decide what should happen.
4. **Memory**: the database tables where Persons stores the result.

## Big Picture

```mermaid
flowchart LR
  subgraph Inputs["Things that come in"]
    Human["You in the browser"]
    IMessages["iMessage chat.db on your Mac"]
    GoogleCalendar["Google Calendar"]
    Gmail["Gmail"]
    Files["Imported files and transcripts"]
    ExternalTools["External scripts, automations, future apps"]
  end

  subgraph FrontDoors["Front doors into Persons"]
    UI["Persons web app"]
    ImportUI["Import screens"]
    AdminUI["Admin screens"]
    PublicAPI["Headless API /api/v1"]
    Watcher["iMessage watcher script"]
    CalendarOAuth["Google Calendar OAuth + sync"]
    GmailOAuth["Gmail OAuth + sync"]
  end

  subgraph Plumbing["Business plumbing"]
    Access["Access check: are you allowed?"]
    Commands["Domain commands: create, merge, import, accept inbox"]
    Rules["Rules engine: if this matches, suggest or change that"]
    Audit["Audit log: what happened and who did it"]
  end

  subgraph Memory["Shared database"]
    People["People"]
    Interactions["Interactions"]
    Events["Events"]
    Plans["Plans"]
    CalendarDB["Calendar connections and event links"]
    GmailDB["Gmail connections and message links"]
    Inbox["Inbox staging"]
    FilesDB["Imported files"]
    AccessDB["Users, roles, API keys"]
    RulesDB["Rules and rule runs"]
    AuditDB["Audit log"]
  end

  Human --> UI
  Human --> ImportUI
  Human --> AdminUI
  IMessages --> Watcher
  GoogleCalendar --> CalendarOAuth
  Gmail --> GmailOAuth
  Files --> ImportUI
  ExternalTools --> PublicAPI

  UI --> Access
  ImportUI --> Access
  AdminUI --> Access
  PublicAPI --> Access
  Watcher --> Commands
  CalendarOAuth --> Commands
  GmailOAuth --> Commands

  Access --> Commands
  Commands --> Rules
  Rules --> Commands
  Commands --> Audit
  Rules --> Audit

  Commands --> People
  Commands --> Interactions
  Commands --> Events
  Commands --> Plans
  Commands --> CalendarDB
  Commands --> GmailDB
  Commands --> Inbox
  Commands --> FilesDB
  Access --> AccessDB
  Rules --> RulesDB
  Audit --> AuditDB
```

## The Main Flows

### 1. You use the app in the browser

```mermaid
sequenceDiagram
  participant You
  participant UI as Persons UI
  participant API as App APIs
  participant Domain as Domain commands
  participant Rules as Rules engine
  participant DB as Database

  You->>UI: Click People, Inbox, Today, Import, Admin
  UI->>API: Ask for data or submit a change
  API->>Domain: Call the right command
  Domain->>DB: Read or write records
  Domain->>Rules: Run relevant rules when records change
  Rules->>DB: Save rule runs and safe staged changes
  Domain->>DB: Save audit log
  API-->>UI: Return updated data
  UI-->>You: Show the result
```

In plain English: the UI does not directly make database decisions. It asks an API, the API calls a command, and the command updates the database.

### 2. iMessage sync

```mermaid
flowchart TD
  ChatDB["Mac Messages database: chat.db"] --> Watcher["scripts/imessage-sync.ts"]
  Watcher --> Watermark["Watermark: last message already seen"]
  Watcher --> Match["Try to match sender to an existing Person"]

  Match --> Known{"Confident match?"}
  Known -->|Yes| DailyInteraction["Append to one daily Interaction"]
  Known -->|No| StagedInbox["Create Inbox staging item (itemType=interaction)"]

  DailyInteraction --> Dedupe["Skip if exact message was already imported"]
  StagedInbox --> Dedupe

  StagedInbox --> Rules["Run ingest.message rules"]
  Rules --> RuleRuns["Save RuleRun records"]
  Rules --> SafeUpdates["Optionally update staged fields"]

  DailyInteraction --> PersonsDB["Persons database"]
  StagedInbox --> PersonsDB
  RuleRuns --> PersonsDB
```

Important idea: unmatched iMessages do not create random new people anymore. They go to the Inbox staging area where you can review them.

### 2b. Staging from any external source

Any external script or automation can push items into the inbox via the API. This is the universal staging path — not limited to iMessage.

```mermaid
flowchart TD
  External["External source: script, webhook, future app"] --> APIV1["POST /api/v1/inbox"]
  APIV1 --> Auth["API key + ingest.write scope"]
  Auth --> StageRecord["stageRecord() domain command"]
  StageRecord --> Upsert["Upsert StagedInteraction by source+sourceId"]
  Upsert --> Rules["Run rules (trigger: inbox.stage or caller-specified)"]
  Rules --> RuleRuns["Save RuleRun records"]
  Upsert --> Audit["Write AuditLog inbox.stage"]
  Upsert --> InboxDB["Inbox staging table"]
```

The `itemType` field on the staged record tells the inbox what kind of record to create when accepted (currently `interaction` is the only handled type).

### 3. Import flow

```mermaid
flowchart TD
  ImportHub["/import chooser"] --> PeopleImport["/import/people"]
  ImportHub --> InteractionImport["/import/interactions"]
  LegacyConversation["/import/conversations"] --> InteractionImport
  PeopleFile["vCard or CSV people file"] --> PeopleImport
  GoogleContacts["Google Contacts from connected Gmail"] --> PeopleImport
  GmailMail["Gmail Mail sync"] --> InteractionImport
  File["File, transcript, or API-ingested text"] --> InteractionImport
  InteractionImport --> Analyze["Analyze and extract people/interactions"]
  InteractionImport --> GmailSync["Run Gmail sync with backfill and unmatched mode"]
  PeopleImport --> ParsePeople["Parse and match people records"]
  ParsePeople --> Confirm
  Analyze --> MatchPeople["Match extracted names to existing People"]
  GmailSync --> Interactions
  GmailSync --> Inbox["Optional Inbox staging for unknown email"]
  MatchPeople --> Confirm["Confirm import"]
  Confirm --> People["Create or update People"]
  Confirm --> Events["Create Events"]
  Confirm --> Interactions["Create Interactions"]
  Confirm --> Rules["Run import.person and import.interaction rules"]
  Rules --> RuleRuns["Save RuleRuns"]
  Confirm --> Audit["Write AuditLog"]
```

Plain English: import is a bulk way to turn source material into structured People, Events, and Interactions. `/import` is the chooser, `/import/people` handles vCard/CSV people files plus Google Contacts from the connected Gmail account, and `/import/interactions` handles Gmail Mail, transcripts, notes, and message exports. `/import/conversations` remains as a redirect for older links.

The Google Contacts import does not save records immediately. `/api/import/gmail-contacts` reads the connected Google account through the People API, maps names, emails, phone numbers, organizations, birthdays, addresses, URLs, and notes into the same review shape as a vCard/CSV import, and then the regular People import review decides what to create, update, or skip.

### 3b. Google Calendar sync

```mermaid
flowchart TD
  Admin["Admin Calendar tab"] --> Connect["Connect Google Calendar"]
  Connect --> OAuth["Google OAuth consent"]
  OAuth --> Connection["CalendarConnection stores tokens and sync state"]
  Admin --> Sync["Sync now"]
  Sync --> GoogleEvents["Read Google Calendar events"]
  GoogleEvents --> Link["CalendarEventLink by calendarId + Google event id"]
  Link --> Event["Create or update local Event"]
  GoogleEvents --> Match["Match attendees to People by email"]
  Match --> Interaction["Create Interaction for matched People"]
  Sync --> Audit["Write calendar.sync AuditLog"]
  Admin --> Trace["Review sync trace"]
  Trace --> Link
  Trace --> Interaction
```

Plain English: Google Calendar remains the source of truth. Persons imports calendar entries into local Events and creates Interactions only when an attendee email already matches a Person in the current workspace. Re-running sync is idempotent because `CalendarEventLink` remembers which Google event maps to which local Event.

To keep first-time imports from hogging resources, the Admin Calendar screen asks for a backfill range before syncing. The server fetches Google events in restrained pages and writes them in small batches rather than holding one giant event list in memory. Once Google gives Persons an incremental sync token, later syncs ignore the historical backfill range and only ask Google for changed events.

The Admin Calendar tab also has a sync trace. It reads recent `calendar.sync` audit rows plus the actual `CalendarEventLink`, `Event`, and `Interaction` records so an operator can see which Google events landed locally and which People were linked.

Runtime configuration:

- `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET`, or the existing `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` if that OAuth client has Calendar API access.
- The Google OAuth redirect URI must include `/api/calendar/google/callback` on the deployed app origin.
- `GOOGLE_CALENDAR_REDIRECT_URI` can pin the callback to one exact production URL, avoiding mismatches when someone opens a preview deployment or alternate Vercel alias.
- The first sync reads the selected bounded window around the present; later syncs use Google's sync token when available.

### 3c. Gmail sync

```mermaid
flowchart TD
  Admin["Admin Gmail tab"] --> Connect["Connect Gmail"]
  Connect --> OAuth["Google OAuth consent"]
  OAuth --> Connection["GmailConnection stores tokens and Gmail historyId"]
  Admin --> Sync["Sync now"]
  Sync --> GmailMessages["Read Gmail messages"]
  GmailMessages --> Link["GmailMessageLink by mailbox + Gmail message id"]
  GmailMessages --> Match["Match senders and recipients to People by email"]
  Match -->|Known Person| Interaction["Create or append email Interaction"]
  Match -->|No Person match, default| Skip["Skip unknown email"]
  Match -->|No Person match, opt in| Inbox["Stage email in Inbox for review"]
  Sync --> Audit["Write gmail.sync AuditLog"]
  Admin --> Trace["Review sync trace"]
  Trace --> Link
  Trace --> Interaction
  Trace --> Inbox
```

Plain English: Gmail remains read-only. Persons imports messages into Interactions when a sender or recipient already matches a Person email in the current workspace. The default sync mode is "Known People only": unknown senders and recipients are skipped and do not enter Inbox. The user can explicitly switch to "Stage unmatched in Inbox" when they want to review unknown emails and attach or create People later. First-time sync uses the selected Admin backfill range, defaults to 30 days, includes an all-time option, and processes messages in small batches. Later syncs use Gmail's history API via `GmailConnection.historyId`; if Gmail says that history cursor is too old, Persons falls back to a bounded full sync.

The Admin Gmail tab includes a sync trace. It combines recent `gmail.sync` audit rows with `GmailMessageLink`, email Interactions, and staged Inbox records so an operator can see whether each message matched a Person, was staged for review, was skipped by Known People only mode, or was marked deleted.

The same Gmail sync can also be launched from `/import/interactions` as "Import Gmail Mail." That screen keeps the same conservative default as Admin: a 30-day backfill and Known People only mode, with an opt-in control to stage unmatched email in Inbox.

Runtime configuration:

- `GOOGLE_GMAIL_CLIENT_ID` and `GOOGLE_GMAIL_CLIENT_SECRET`, or the existing `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` if that OAuth client has Gmail API access.
- The Google OAuth redirect URI must include `/api/gmail/google/callback` on the deployed app origin.
- `GOOGLE_GMAIL_REDIRECT_URI` can pin the callback to one exact production URL.
- People import from Google Contacts uses the same Gmail connection but also needs the Google People API enabled and the `https://www.googleapis.com/auth/contacts.readonly` scope. Older Gmail connections that only granted Gmail read access must reconnect before `/import/people` can pull Google Contacts.

### 4. Inbox review flow

```mermaid
flowchart TD
  Inbox["Inbox staging item"] --> Review["You review and edit"]
  Review --> Trace["Automation trace shows matched rules"]
  Trace --> Choice{"Decision"}
  Choice -->|Accept| Person["Attach to correct Person"]
  Choice -->|Create + Accept| NewPerson["Create a new Person and attach it"]
  Choice -->|Dismiss| Dismissed["Mark dismissed"]
  Choice -->|Update| Pending["Keep pending with edits"]
  Choice -->|Return to Review| Pending

  Person --> DailyInteraction["Append/create daily Interaction"]
  NewPerson --> DailyInteraction
  DailyInteraction --> Rules["Run inbox.accept and interaction rules"]
  Rules --> RuleRuns["Save RuleRuns"]
  DailyInteraction --> Audit["Write AuditLog"]
```

Plain English: Inbox is the human filter between automation and your real CRM memory. If an incoming interaction belongs to someone who is not in People yet, the Inbox can create the Person from the staged name, email, or phone and accept the interaction in the same review step.

### 5. Data cleaning view

```mermaid
flowchart TD
  PeopleDB["People table"] --> QualityAPI["/api/persons/data-cleaning"]
  QualityAPI --> Checks["Completeness checks"]
  Checks --> MissingEmail["Missing email"]
  Checks --> MissingPhone["Missing phone"]
  Checks --> MissingName["Missing first or last name"]
  Checks --> NameOnly["Name-only people"]
  Checks --> Symbols["Unusual name symbols"]

  QualityAPI --> CleanUI["/people/clean"]
  CleanUI --> Edit["Edit Person"]
  CleanUI --> Delete["Delete Person"]
  Edit --> PersonAPI["/api/persons/:id"]
  Delete --> PersonAPI
  PersonAPI --> PeopleDB
```

Plain English: the Data Cleaning page is a focused People quality view. It counts sparse records, lets you filter and sort by the kind of cleanup needed, and sends edits or deletes through the same Person APIs used by the rest of the app.

## API Plumbing

There are two API families.

### App APIs

These power the web app itself. They are mostly behind your normal login.

```mermaid
flowchart LR
  Browser["Browser UI"] --> AppAPI["/api/..."]
  AppAPI --> Domain["Domain commands"]
  Domain --> DB["Database"]

  AppAPI --> PeopleAPI["/api/persons"]
  AppAPI --> InteractionsAPI["/api/interactions"]
  AppAPI --> PlansAPI["/api/plans"]
  AppAPI --> EventsAPI["/api/events"]
  AppAPI --> InboxAPI["/api/inbox"]
  AppAPI --> ImportAPI["/api/import/*"]
  AppAPI --> AdminAPI["/api/admin/*"]
```

### Headless APIs

These are for scripts, automations, and future apps. They use API keys and scopes.

```mermaid
flowchart LR
  Script["External script or automation"] --> Key["API key"]
  Key --> V1["/api/v1/..."]
  V1 --> Scope["Scope check"]
  Scope --> Domain["Domain commands"]
  Domain --> DB["Database"]

  V1 --> PeopleScope["people.read/write"]
  V1 --> Files["files.read"]
  V1 --> Ingest["ingest.write"]
  V1 --> Interactions["interactions.read/write"]
```

Plain English: the headless API is how Persons can become programmable. Anything the UI can do should eventually have an API-shaped path too.

## Access Control

Browser auth is shared across Life OS apps. Persons keeps a local `apps/persons/auth.ts`
wrapper, but the actual Google sign-in policy now lives in `packages/auth`.
Home, Persons, Places, and Stuff can share the same session when deployed on a
common parent domain and configured with the same `AUTH_SECRET` plus
`AUTH_COOKIE_DOMAIN` or `LIFE_OS_COOKIE_DOMAIN`.

```mermaid
flowchart TD
  Request["Someone asks Persons to do something"] --> AuthType{"How did they arrive?"}
  AuthType -->|Browser| Login["Google login session"]
  AuthType -->|Script| APIKey["API key"]

  Login --> User["User record"]
  APIKey --> KeyRecord["API key record"]

  User --> Roles["Roles"]
  Roles --> Permissions["Permissions / scopes"]
  KeyRecord --> KeyScopes["API key scopes"]

  Permissions --> Allowed{"Allowed?"}
  KeyScopes --> Allowed

  Allowed -->|Yes| Command["Run command"]
  Allowed -->|No| Stop["Reject request"]
```

Examples:

- `people.read`: can read People.
- `people.write`: can create or edit People.
- `ingest.write`: can run import/ingest flows.
- `rules.manage`: can create or edit rules.
- `audit.read`: can view the audit log.
- `*`: owner-level access.

### Workspace tenancy

Persons is moving from "Joseph's private CRM" toward "approved people can each have their own private CRM space."

```mermaid
flowchart TD
  Login["Google login"] --> Gate{"Email approved?"}
  Gate -->|Env owner/allowlist| DefaultWorkspace["Use Joseph's default workspace"]
  Gate -->|ApprovedEmail row| UserWorkspace["Use or create that person's workspace"]
  Gate -->|No| Reject["Reject sign-in"]

  DefaultWorkspace --> Member["WorkspaceMember"]
  UserWorkspace --> Member
  Member --> Scope["Every read/write carries workspaceId"]
  Scope --> PeopleDB["People, Interactions, Inbox, Rules, API keys, Audit"]
```

Plain English: a login is allowed only when the email is in `OWNER_EMAILS`, `ADMIN_EMAILS`, `ALLOWED_EMAILS`, is the first user in an empty database, or has an approved `ApprovedEmail` record. Once allowed, the user gets a `WorkspaceMember` record. All core People memory then belongs to that workspace through `workspaceId`.

The current migration preserves existing data in `default-workspace`. Owner and env-allowlisted emails land there. Future approved emails can be attached to a specific workspace or can create their own clean workspace on first sign-in. API keys also carry `workspaceId`, so headless API calls read and write inside the same boundary as browser users.

## Rules Engine

```mermaid
flowchart TD
  Trigger["Something happens"] --> LoadRules["Find active rules for that trigger"]
  LoadRules --> Check["Check rule conditions"]
  Check --> Match{"Matched?"}

  Match -->|No| SaveSkip["Save skipped RuleRun"]
  Match -->|Yes| Mode{"Rule mode"}

  Mode -->|suggest| Suggest["Record suggested actions only"]
  Mode -->|dry_run| DryRun["Record what would happen"]
  Mode -->|auto| Auto["Apply safe staged-inbox changes"]
  Mode -->|block| Block["Mark staged item blocked when applicable"]

  Suggest --> SaveRun["Save RuleRun"]
  DryRun --> SaveRun
  Auto --> SaveRun
  Block --> SaveRun
  SaveRun --> Audit["Write audit when matched/applied"]
  SaveRun --> AdminHistory["Admin run history filters"]
```

Current triggers include:

- `ingest.message`
- `import.person`
- `import.interaction`
- `interaction.create`
- `interaction.append`
- `inbox.accept`

Current safe auto-apply target:

- Inbox staging items only.

That means rules can safely help triage incoming automation records, without unexpectedly editing your canonical People or Interaction history.

## Database Memory

```mermaid
erDiagram
  Person ||--o{ Interaction : has
  Event ||--o{ Interaction : groups
  Person ||--o{ Plan : has
  Person ||--o{ StagedInteraction : candidate
  ImportedFile ||--o{ Interaction : source

  Workspace ||--o{ WorkspaceMember : has
  Workspace ||--o{ Person : owns
  Workspace ||--o{ Place : owns
  Workspace ||--o{ PlaceNote : owns
  Workspace ||--o{ Interaction : owns
  Workspace ||--o{ StagedInteraction : owns
  Workspace ||--o{ Rule : owns
  Workspace ||--o{ CalendarConnection : owns
  CalendarConnection ||--o{ CalendarEventLink : maps
  Event ||--o{ CalendarEventLink : source
  Place ||--o{ Event : hosts
  Place ||--o{ PlaceNote : remembers
  Event ||--o{ PlaceNote : can_anchor
  Workspace ||--o{ GmailConnection : owns
  GmailConnection ||--o{ GmailMessageLink : maps
  Interaction ||--o{ GmailMessageLink : source
  StagedInteraction ||--o{ GmailMessageLink : reviews
  ApprovedEmail }o--|| Workspace : can_assign_to
  User ||--o{ ApiKey : creates
  User ||--o{ WorkspaceMember : belongs_to
  User ||--o{ AuditLog : causes
  User ||--o{ Rule : creates
  Role ||--o{ RolePermission : includes
  Permission ||--o{ RolePermission : grants
  ApiKey ||--o{ ApiKeyScope : has
  Rule ||--o{ RuleRun : records
```

Plain English version:

- **Person**: a human in your CRM.
- **Place**: a location at any scale, from a city to a room or shelf. Places are shown through `/places` and `/places/[id]`.
- **PlaceNote**: a memory note attached to a Place, optionally anchored to one Event at that Place.
- **Interaction**: a thing that happened with a person.
- **Event**: a grouping around an interaction, such as a message day, meeting, call, dinner, or imported event.
- **Plan**: what you want to do next with a person.
- **StagedInteraction**: universal inbox item waiting for review. Any source can stage a record here. The `itemType` field (`interaction`, `person`, `event`) indicates what kind of record will be created when accepted.
- **ImportedFile**: source material that was uploaded or ingested.
- **Rule**: an automation decision you configured.
- **RuleRun**: a receipt showing whether a rule matched.
- **AuditLog**: a receipt showing who or what changed something.
- **User, Role, Permission, ApiKey**: access-control system.
- **Workspace, WorkspaceMember, ApprovedEmail**: tenancy system. These decide who can sign in and which private workspace their People data belongs to.
- **CalendarConnection, CalendarEventLink**: Google Calendar integration state. Connections store OAuth/sync state; event links make imports repeatable without duplicating Events.
- **GmailConnection, GmailMessageLink**: Gmail integration state. Connections store OAuth/history state; message links make email imports repeatable and tie Gmail messages to Interactions or Inbox items.

## Outputs

```mermaid
flowchart LR
  DB["Persons database"] --> UI["Web app views"]
  DB --> Today["Today dashboard"]
  DB --> People["People pages"]
  DB --> Cleanup["Data cleaning"]
  DB --> Inbox["Inbox review"]
  DB --> Admin["Admin tools"]
  DB --> API["Headless API responses"]
  DB --> WatcherState["iMessage watermark and dedupe behavior"]
  DB --> Audit["Audit trail"]
  DB --> RuleHistory["Rule run history"]
```

Plain English: the database is the source of truth. The UI, API, admin screens, audit log, and future automations all read from it.

## Mental Model

If you only remember one thing:

```mermaid
flowchart LR
  Incoming["Incoming stuff"] --> Staging["Review or normalize"]
  Staging --> Rules["Rules decide suggestions/actions"]
  Rules --> Memory["Persons memory"]
  Memory --> Views["UI and API outputs"]
  Memory --> Receipts["Audit and rule-run receipts"]
```

The architecture goal is:

- Automations can bring in lots of data.
- Rules can sort and suggest.
- You stay the filter when confidence is low.
- The database remains clean and traceable.
- APIs make everything programmable later.

## Current Journey

```mermaid
flowchart LR
  P1["Phase 1: Domain/API foundation"] --> P2["Phase 2: Headless API parity"]
  P2 --> P3["Phase 3: RBAC, audit, rules"]
  P3 --> P4["Phase 4: Universal Inbox"]
  P4 --> P5["Phase 5: Broader automation engine"]

  P1 --> Done1["Done"]
  P2 --> Done2["Done"]
  P3 --> Done3["Done"]
  P4 --> Done4["Done"]
  P5 --> Future["Future"]
```

### Done

- Core writes now move through domain commands instead of scattered UI/database calls.
- API keys, roles, permissions, and audit logs exist.
- Rules can be created, tested, run, and recorded.
- iMessage, import, interaction, and inbox acceptance paths now trigger rule evaluation.
- Admin is hidden under the profile menu, and the architecture map is a living document.
- Full headless API parity: all major resources (people, interactions, events, plans, inbox, imports, rules, dedupe, audit) available under `/api/v1/`.
- Universal Inbox: `StagedInteraction` now has an `itemType` field; any external source can stage records via `POST /api/v1/inbox` using the `stageRecord()` domain command. Rules fire automatically on staging.
- Data Cleaning: `/people/clean` highlights People records missing email, phone, names, or broader context, and supports editing or deleting those People from the cleanup view.
- Inbox create-and-accept: an unmatched staged interaction can create a new Person and attach the interaction in one review action.
- Workspace tenancy foundation: approved emails can sign in without inheriting Joseph's data, core browser/API paths carry `workspaceId`, existing data is preserved in `default-workspace`, and API keys are scoped to the workspace that created them.
- Google Calendar foundation: Admin can connect Google Calendar, sync read-only events into Events, and create Interactions for attendees matched to existing People by email.
- Google Calendar traceability: Admin can inspect recent Calendar sync runs, imported events, Google event IDs, attendees, and linked People.
- Gmail foundation: Admin can connect Gmail, sync read-only messages into Interactions for matched People, and stage unmatched emails in Inbox.
- Gmail traceability: Admin can inspect recent Gmail sync runs, message IDs, threads, matched People, staged Inbox records, skipped messages, and deleted markers.
- Google Contacts import: `/import/people` can pull People candidates from the connected Gmail account's Google Contacts and review them with the same create/update/skip flow as vCard and CSV imports.
- Gmail Mail import: `/import/interactions` can launch the same batched Gmail sync from the import area, defaulting to a 30-day Known People only import.

### Future

The next larger step is the broader automation engine:

- Scheduled jobs and event triggers.
- Notifications or digests.
- Safer action approval flows.
- More rule actions beyond staged inbox fields.
- Multiple `itemType` accept handlers (currently only `interaction` is handled on accept).
- Inbox filtering by `source` and `itemType` in the UI.
- Admin UI for approving emails and choosing whether an approved person gets their own workspace or joins an existing one.
- Background/scheduled Google Calendar sync and optional review queue for unmatched calendar attendees.
- Background/scheduled Gmail sync.
