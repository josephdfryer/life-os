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
    Files["Imported files and transcripts"]
    ExternalTools["External scripts, automations, future apps"]
  end

  subgraph FrontDoors["Front doors into Persons"]
    UI["Persons web app"]
    ImportUI["Import screens"]
    AdminUI["Admin screens"]
    PublicAPI["Headless API /api/v1"]
    Watcher["iMessage watcher script"]
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
  Files --> ImportUI
  ExternalTools --> PublicAPI

  UI --> Access
  ImportUI --> Access
  AdminUI --> Access
  PublicAPI --> Access
  Watcher --> Commands

  Access --> Commands
  Commands --> Rules
  Rules --> Commands
  Commands --> Audit
  Rules --> Audit

  Commands --> People
  Commands --> Interactions
  Commands --> Events
  Commands --> Plans
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
  Known -->|No| StagedInbox["Create Inbox staging item"]

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

### 3. Import flow

```mermaid
flowchart TD
  File["File, transcript, or API-ingested text"] --> Analyze["Analyze and extract people/interactions"]
  Analyze --> MatchPeople["Match extracted names to existing People"]
  MatchPeople --> Confirm["Confirm import"]
  Confirm --> People["Create or update People"]
  Confirm --> Events["Create Events"]
  Confirm --> Interactions["Create Interactions"]
  Confirm --> Rules["Run import.person and import.interaction rules"]
  Rules --> RuleRuns["Save RuleRuns"]
  Confirm --> Audit["Write AuditLog"]
```

Plain English: import is a bulk way to turn messy text into structured People, Events, and Interactions.

### 4. Inbox review flow

```mermaid
flowchart TD
  Inbox["Inbox staging item"] --> Review["You review and edit"]
  Review --> Trace["Automation trace shows matched rules"]
  Trace --> Choice{"Decision"}
  Choice -->|Accept| Person["Attach to correct Person"]
  Choice -->|Dismiss| Dismissed["Mark dismissed"]
  Choice -->|Update| Pending["Keep pending with edits"]
  Choice -->|Return to Review| Pending

  Person --> DailyInteraction["Append/create daily Interaction"]
  DailyInteraction --> Rules["Run inbox.accept and interaction rules"]
  Rules --> RuleRuns["Save RuleRuns"]
  DailyInteraction --> Audit["Write AuditLog"]
```

Plain English: Inbox is the human filter between automation and your real CRM memory.

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

  V1 --> Contacts["contacts.read/write"]
  V1 --> Files["files.read"]
  V1 --> Ingest["ingest.write"]
  V1 --> Interactions["interactions.read/write"]
```

Plain English: the headless API is how Persons can become programmable. Anything the UI can do should eventually have an API-shaped path too.

## Access Control

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

- `contacts.read`: can read People.
- `contacts.write`: can create or edit People.
- `ingest.write`: can run import/ingest flows.
- `rules.manage`: can create or edit rules.
- `audit.read`: can view the audit log.
- `*`: owner-level access.

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

  User ||--o{ ApiKey : creates
  User ||--o{ AuditLog : causes
  User ||--o{ Rule : creates
  Role ||--o{ RolePermission : includes
  Permission ||--o{ RolePermission : grants
  ApiKey ||--o{ ApiKeyScope : has
  Rule ||--o{ RuleRun : records
```

Plain English version:

- **Person**: a human in your CRM.
- **Interaction**: a thing that happened with a person.
- **Event**: a grouping around an interaction, such as a message day, meeting, call, dinner, or imported event.
- **Plan**: what you want to do next with a person.
- **StagedInteraction**: automation inbox item waiting for review.
- **ImportedFile**: source material that was uploaded or ingested.
- **Rule**: an automation decision you configured.
- **RuleRun**: a receipt showing whether a rule matched.
- **AuditLog**: a receipt showing who or what changed something.
- **User, Role, Permission, ApiKey**: access-control system.

## Outputs

```mermaid
flowchart LR
  DB["Persons database"] --> UI["Web app views"]
  DB --> Today["Today dashboard"]
  DB --> People["People pages"]
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
  P1["Phase 1: Domain/API foundation"] --> P2["Phase 2: Access, audit, RBAC"]
  P2 --> P3["Phase 3: Rules engine"]
  P3 --> P4["Phase 4: Trust and control"]
  P4 --> P5["Phase 5: Broader automation engine"]

  P1 --> Done1["Done"]
  P2 --> Done2["Done"]
  P3 --> Done3["Done"]
  P4 --> Now["Current"]
  P5 --> Future["Future"]
```

### Done

- Core writes now move through domain commands instead of scattered UI/database calls.
- API keys, roles, permissions, and audit logs exist.
- Rules can be created, tested, run, and recorded.
- iMessage, import, interaction, and inbox acceptance paths now trigger rule evaluation.
- Admin is hidden under the profile menu, and the architecture map is a living document.

### Current

This phase is about trust and control:

- Rules should be easier to create with templates and known triggers.
- Inbox review should show why automation did something.
- Rule runs should act like receipts beside the records they affected.
- Low-confidence automation should stay reviewable instead of silently creating canonical records.
- Admins can filter rule-run history by rule, trigger, outcome, and status.
- Blocked Inbox records can be dismissed or returned to normal review after edits.

### Future

The next larger step is the broader automation engine:

- Scheduled jobs and event triggers.
- Notifications or digests.
- Safer action approval flows.
- More rule actions beyond staged inbox fields.
- APIs for every meaningful UI operation.
