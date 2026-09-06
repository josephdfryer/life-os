# Linear workflow — agents as workers

Linear is the queue for all LifeOS work as of 2026-09-06. Workspace:
<https://linear.app/josephfryer>, team **Joseph Fryer** (key `JF`). The
consolidated plan is `docs/ROADMAP.md`; this file is the operating protocol.

## Structure

| Linear object | Meaning here |
|---|---|
| Project `LifeOS · …` | One workstream (Ops & Platform, Level Up Skills Web, Persons iOS Parity, Social Scans, Persons Web & Daily Use, iOS Platform) |
| Milestone | A phase with an exit gate (P0/P1…, S0/S1…, Phase 1/2/3) |
| Issue | One unit of work with a "Done when" section |
| Label `Agent/Claude`, `Agent/Codex`, `Agent/Cursor`, `Agent/Joseph` | **Who is doing it.** Agents are not Linear users, so the label is the assignment. `Agent/Joseph` issues are also assigned to Joseph. |
| Status | `Backlog` (not ready) → `Todo` (ready to pick up) → `In Progress` → `Done`; `Canceled`/`Duplicate` as needed |
| Blocked by | Real dependencies only. If an issue is blocked, do the blocker first or pick a different `Todo`. |

## Rules for every agent

1. **No issue, no work.** If a request arrives outside Linear, create the issue
   first (Claude can via MCP; Codex and Cursor ask Joseph or Claude to file it,
   then reference it).
2. **Pick only your label.** `Agent/Claude` for the spine and Swift,
   `Agent/Codex` for surfaces and the Vercel lane, `Agent/Cursor` for small
   bounded UI fixes. Do not work an issue with another agent's label without
   an explicit hand-off comment.
3. **Branch name = Linear's suggested branch.** Every issue has a
   `gitBranchName` (e.g. `josephdfryer/jf-157-add-plans-to-level-up-nav…`).
   Use it, or at minimum put the issue key in the branch: `codex/jf-157-…`,
   `cursor/jf-141-…`. This is what makes work traceable to a worker.
4. **Issue key in every commit subject and PR title.** `feat(level-up): add
   Plans nav (JF-157)`. Docs-only and low-risk changes may still push straight
   to master per the ship-to-prod process; the key still goes in the subject.
5. **Move the status yourself when you start.** `Todo` → `In Progress` the
   moment you branch. Claude does this via MCP; Codex and Cursor say
   "Starting JF-157" in their `agent:start`/`agent:finish` summaries and Claude
   mirrors it to Linear at its next session start.
6. **Close with evidence.** A closing comment says what shipped (commit or PR
   link), how it was verified, and any deviation from the issue's "Done when".
   Then `Done`. If the "Done when" was not fully met, leave it open and say
   what is missing.
7. **Hand-offs are comments, not chat.** When Claude finishes step 1 of a
   two-step issue pair (e.g. JF-143 → JF-148), the hand-off goes as a comment
   on the next issue, so the record survives sessions and crashes.
8. **`agent:finish` references issue keys.** The existing
   `npm run agent:finish -- --agent <name> --summary "JF-157 done: …" --next "JF-158"`
   protocol stays; Linear is the durable ledger, `.agent-sync/` is the local
   catch-up brief.

## Claude's extra duty: scribe

Claude is the only agent with Linear MCP access, so at the start of each
session Claude:

- runs `npm run agent:start -- --agent claude`,
- reads the last Codex/Cursor handoffs and recent commits,
- mirrors any "Starting JF-…" / "Done JF-…" statements into Linear statuses
  and comments,
- files new issues for bugs or follow-ups those handoffs mention.

## Plan docs vs Linear

`docs/*_PLAN.md` files are specs. When a phase ships: tick the phase in the
doc, close the milestone's issues, and update the row in `docs/ROADMAP.md`
§1. When a plan is superseded, mark it there and move it to `docs/archive/`
(JF-145).
