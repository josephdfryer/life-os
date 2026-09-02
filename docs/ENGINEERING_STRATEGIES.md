# Engineering Strategies for Life OS

Synthesized from evaluating two sets of 2025–2026 performance strategies against the Life OS stack: Next.js App Router + React 19 + Postgres via Prisma + Vercel + Claude API. Only what's actually applicable is included. Irrelevant strategies (Iceberg, Wasm, eBPF, Qwik, Astro, GPU pipelines, Svelte) are omitted — they don't apply at this scale or stack and aren't worth revisiting.

---

## Data Layer

### Chunk Large Documents Before Sending to Claude

**When it applies**: Any import that calls Claude to parse content — uploaded conversation files, iMessage exports, email threads, meeting transcripts.

These sources grow without bound. A 300-message iMessage export processed as one prompt will hit context limits, produce lower-quality extractions, and fail silently on long inputs.

**How to apply**:
- Split large inputs into overlapping chunks (e.g., 50 messages with a 10-message overlap for continuity)
- Run Claude on each chunk independently (map): extract Person candidates and Interaction candidates per chunk
- Merge and deduplicate the results (reduce): consolidate by person identifier, merge overlapping interactions by timestamp
- Stage the merged set for human review as normal

Keep it simple — a sliding window with a fixed chunk size is sufficient. No vector DB or embeddings needed. The map/reduce is structural, not semantic.

### Process Deltas Only — Never Re-Scan from the Start

**Already in place**: Gmail and Google Calendar sync use OAuth sync tokens. The iMessage watcher tails `chat.db`. These are correct.

Preserve this pattern for every new integration:
- Store a cursor or sync token after each successful run
- On the next run, start from the cursor
- Make every ingestion job idempotent: the same raw source event ingested twice must produce one staged item, not two. Use source IDs as deduplication keys.

As the Interaction log grows to thousands of entries, re-scanning from scratch corrupts derived metrics (relationship health, attention scores) through duplicates and wastes time.

### Derive Over Store — Index for the Queries That Do the Deriving

The vision is explicit: net worth, relationship health, attention score, and tension are never stored — always computed fresh. Agents must honor this.

What agents must also ensure: the underlying tables are indexed for the query patterns derivations need.

- Last-interaction lookups: index on `(workspaceId, personId, createdAt DESC)`
- Attention gap detection: index on `(closeness, lastInteractionAt)` to scan only the relevant slice
- Never add computed columns to the schema to "speed things up" — that creates a second source of truth and makes the graph dishonest

When a derived query gets slow, the correct fix is an index or a write-time materialized view — not a stored field.

### The Staged Inbox Is a Firewall — Don't Bypass It

`StagedInteraction` is not a queue to be cleared automatically. It is a firewall between raw external data and the committed graph.

Rules engine events (`ingest.message`, `import.person`, `import.interaction`, `inbox.accept`) may auto-apply only to staged records when matched by an explicit, tested rule. Committed graph nodes — Person, Interaction, Event, Item — are mutated only via domain commands with audit entries. Never write directly to committed records from an import or sync job.

---

## Frontend

### Use RSC Intentionally — Don't Add `"use client"` by Default

Next.js App Router makes every component a Server Component unless marked otherwise. This is a free performance win, but only if agents don't reflexively add `"use client"` at the top of pages.

Add `"use client"` only when a component needs browser APIs, event handlers, React state, or effects. Data-fetching pages — person profile, interaction log, staged inbox, rules list — should be Server Components that fetch from the database directly and pass data down as props to small client islands.

Wrap slow-loading sections in `<Suspense fallback={<Skeleton />}>`. Navigation and layout load instantly; heavy content (interaction timeline, relationship graph) streams in.

### Enable the React Compiler — Then Stop Writing Manual Memoization

React 19 includes the React Compiler. Enable it in `next.config.ts`:

```ts
experimental: {
  reactCompiler: true,
}
```

This eliminates the need for manual `useMemo`, `useCallback`, and `React.memo`. Don't add these manually to new code. If a component seems to re-render too often, profile it first — the compiler likely already handles it, or there's a structural issue worth fixing properly.

### Code-Split Heavy Components

Next.js splits at the route level automatically. Also split heavy page-level components that aren't needed on first render:

```ts
const RulesEditor = dynamic(() => import('@/components/RulesEditor'), {
  loading: () => <Skeleton />,
})
```

Components that qualify: anything importing a heavy library (rich text editor, date picker, chart), any modal or drawer not visible on load, and the import wizard.

### Keep Computation Pure So It Can Move to a Worker Later

As Life OS adds derived intelligence — computing relationship health across hundreds of interactions, generating attention gap reports, scoring people by closeness drift — that computation must not block the UI.

Now: write all computation as pure functions (no DOM access, no React state, no side effects). A function that takes interaction records and returns a health score is easy to move.

When it becomes necessary: move those functions into a Web Worker via `comlink`. The component sends data in, receives results out, and the main thread stays free. Don't do this prematurely — profile first.

---

## Compounding Wins

These strategies reinforce each other:

1. **RSC + Suspense** makes every data-heavy page feel instant without extra work
2. **React Compiler** keeps the UI snappy as component and feature count grows
3. **LLM chunking** makes the import pipeline scale to arbitrarily large source files
4. **Incremental sync + idempotent ingestion** keeps the Interaction log clean and queryable
5. **Derive over store + correct indexes** means the graph stays consistent and derived metrics stay fast

The pattern is the same across all of them: minimize what you move, minimize what you recompute, and keep the source of truth singular and immutable.
