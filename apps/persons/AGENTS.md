<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:cross-agent-sync -->
# Cross-Agent Sync

Claude Code and Codex share this repository. At the start of any session, run this from the monorepo root:

```bash
npm run agent:start -- --agent claude
```

Use `--agent codex` when the active agent is Codex. Read the catch-up brief before editing. It reports commits, worktree changes, and the last local handoff left by the other agent.

At the end of a session, leave a handoff:

```bash
npm run agent:finish -- --agent claude --summary "What changed and why" --next "Best next step"
```

The local state lives in `.agent-sync/` and is intentionally ignored by git.
<!-- END:cross-agent-sync -->

<!-- BEGIN:still-design-system -->
# Design System

UI work in Persons (and all LifeOS apps) follows **Still v2**. Read `docs/STILL_DESIGN_SYSTEM.md` before changing layout, styling, or components. Visual reference: `docs/ui-preview/still-direction-v2.html`.
<!-- END:still-design-system -->

<!-- BEGIN:persons-architecture-doc -->
# Living Persons Architecture Map

`docs/PERSONS_ARCHITECTURE.md` is the shared plain-English architecture map for the Persons app. Codex and Claude must keep it current whenever a change affects how data enters the app, moves through APIs/domain commands/rules, lands in the database, or leaves through UI/API outputs.

Prefer accessible language and Mermaid diagrams over code-heavy explanations. If implementation names are useful, include them as supporting labels rather than making the doc require code knowledge.
<!-- END:persons-architecture-doc -->

<!-- BEGIN:vercel-managed-output -->
# Managed Vercel output

Persons is deployed through Vercel's managed Next.js builder. Keep `outputFileTracingRoot` for monorepo tracing, but do not set Next.js `output: "standalone"`; that output mode is for self-hosted servers and breaks Vercel's managed output finalization.
<!-- END:vercel-managed-output -->
