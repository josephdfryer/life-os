# Life OS Agent Instructions

## Cross-Agent Sync

Claude Code and Codex share this repository. At the start of any session, run this from the monorepo root:

```bash
npm run agent:start -- --agent claude
```

Use `--agent codex` when the active agent is Codex. Read the catch-up brief before editing. It reports commits, worktree changes, upstream divergence, and the last local handoff left by the other agent.

At the end of a session, leave a handoff:

```bash
npm run agent:finish -- --agent claude --summary "What changed and why" --next "Best next step"
```

The local state lives in `.agent-sync/` and is intentionally ignored by git. See `docs/AGENT_SYNC.md` for the full protocol.

## App-Specific Notes

Read the nearest app-level `AGENTS.md` or `CLAUDE.md` before editing app code. For the persons CRM, start with `apps/persons/AGENTS.md`.
