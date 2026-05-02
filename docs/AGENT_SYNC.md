# Cross-Agent Sync

This repo is shared between Claude Code and Codex. The goal is simple: every agent should be able to see what changed while it was idle, read the last handoff, and continue without guessing.

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

## What gets committed

The script and this protocol are committed so every clone gets the same workflow.

The live coordination state is stored in `.agent-sync/`, which is ignored by git. That folder is for local machine handoffs: last-seen commits, recent summaries, and current-agent snapshots. If one agent commits or pulls changes, the other agent will still detect that through git history on the next `agent:start`.

## Recommended switching rhythm

1. Before you switch away, run `agent:finish` with a concrete summary and next step.
2. Commit finished work when it is safe to commit.
3. When the other tool starts, run `agent:start` and read the catch-up brief.
4. If the worktree is dirty, inspect those files before editing them.

Do not use this as a replacement for git. It is a quick context layer on top of git, built to make Claude Code and Codex less likely to step on each other.
