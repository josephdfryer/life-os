# Cross-Agent Sync

This repo is shared between Claude Code and Codex. The goal is simple: every agent should be able to see what changed while it was idle, read the last handoff, and continue without guessing.

**Linear is the durable handoff record, not `.agent-sync/`.** `.agent-sync/` is gitignored and lives on one machine — it never survives a fresh clone, a different container, or a different agent's separate worktree, so it cannot carry a handoff between sessions on its own. `agent:start` and `agent:finish` now post the same summary/next-step to a comment on the relevant Linear issue automatically (see below); `.agent-sync/` remains as a fast local cache for the git-history parts of the brief (commits, dirty files, divergence) that don't belong in Linear.

## Daily workflow

Run this from the monorepo root before editing:

```bash
npm run agent:start -- --agent codex
npm run agent:start -- --agent claude
```

Use the agent name for the tool you are currently using. The command prints a catch-up brief with:

- current branch and HEAD
- upstream divergence when an upstream is configured
- commits since that agent last checked in
- current dirty worktree files
- the last handoff notes from either agent

Run this before stopping or switching tools:

```bash
npm run agent:finish -- --agent codex --summary "Implemented X, verified Y" --next "Continue with Z"
npm run agent:finish -- --agent claude --summary "Implemented X, verified Y" --next "Continue with Z"
```

Use `npm run agent:status -- --agent codex` any time you want the brief without updating the agent's last-seen state.

Add `--fetch` when you want the command to refresh `origin/*` before comparing local and remote state:

```bash
npm run agent:start -- --agent codex --fetch
```

## Posting handoffs to Linear

`agent:start` (when given `--summary`/`--next`) and `agent:finish` call the Linear API directly — no MCP dependency, so Codex and Cursor get the same durable handoff as Claude:

1. Set `LINEAR_API_KEY` (a personal API key from Linear → Settings → API) in the repo-root `.env.local`, `.env`, or the environment (checked in that order). Without it, the script prints a reason and continues — nothing fails.
2. The comment goes on whichever issue key it finds in the current branch name (`JF-157` out of `codex/jf-157-add-nav`), or the one passed via `--issue JF-157`. Without either, it skips and says so.
3. The comment body is exactly the `--summary`/`--next` you passed — same content that used to go only into `.agent-sync/activity.md`.

This means: always pass `--summary` and `--next` to `agent:finish`, and pass `--issue` explicitly when working on a branch whose name doesn't carry the issue key (e.g. a docs or chore branch).

## What gets committed

The script and this protocol are committed so every clone gets the same workflow.

The live coordination state is stored in `.agent-sync/`, which is ignored by git. That folder is for local machine handoffs: last-seen commits, recent summaries, and current-agent snapshots. If one agent commits or pulls changes, the other agent will still detect that through git history on the next `agent:start`. Treat it as a convenience cache of git state, not the record of what happened — that's Linear now.

## Recommended switching rhythm

1. Before you switch away, run `agent:finish` with a concrete summary and next step.
2. Commit finished work when it is safe to commit.
3. When the other tool starts, run `agent:start` and read the catch-up brief.
4. If the worktree is dirty, inspect those files before editing them.

Do not use this as a replacement for git. It is a quick context layer on top of git, built to make Claude Code and Codex less likely to step on each other.
