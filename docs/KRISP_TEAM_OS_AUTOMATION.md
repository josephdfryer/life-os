# Krisp to Team OS Automation

This local automation polls Krisp once per minute, maps completed meetings to
Google Calendar events already imported into LifeOS, and writes structured
meeting files into the local Team OS repository.

## Flow

1. Krisp MCP returns meetings completed since the last successful run.
2. `scripts/krisp/sync.ts` retrieves each full transcript.
3. The transcript time, title, speakers, and attendees are scored against Google
   Calendar, selected Apple Calendar calendars, and the exported work-calendar
   `.ics` archive when present.
4. Claude splits mixed meetings into customer-specific and internal segments.
5. Customer segments go to `team-os/customers/{slug}/meetings/`.
6. Internal segments go to `team-os/personal-drawer/meetings/`.
7. Uncertain mappings go to `team-os/personal-drawer/meeting-review/`.
8. The raw transcript is archived privately in
   `team-os/personal-drawer/krisp-transcripts/` and attached to the matched Life
   OS Event.
9. Every written meeting output is indexed in
   `team-os/personal-drawer/meeting-ledger.md` for later report generation.

The processor never invents customer folders. Customer mappings below 75%
confidence are held for review.

## Commands

```bash
npm run krisp:sync -- --dry-run --backfill-days 2
npm run krisp:sync -- --dry-run --reprocess --backfill-days 2 --limit 1
npm run krisp:sync -- --dry-run --reprocess --meeting-id 019ebd6e08fd75d8878e80d16c88dc32
npm run krisp:sync -- --rebuild-ledger
npm run krisp:sync
npm run scheduler:install
```

State is stored at `~/.life-os/krisp-team-os-state.json`. Krisp OAuth tokens are
managed by `mcp-remote` under `~/.mcp-auth/`.

The script loads the private Vercel production environment from
`apps/persons/.env.production.local`. Refresh it after OAuth secret changes with:

```bash
vercel env pull apps/persons/.env.production.local --environment=production --yes
```

Calendar OAuth connection state is read from the local LifeOS SQLite database;
the worker pins this to `apps/persons/persons.db` and deliberately does not use
the production Turso dataset.

Set `TEAM_OS_ROOT` if the Team OS clone moves from
`/Users/josephfryer/team-os`.

Set `KRISP_APPLE_CALENDARS` to a comma-separated list of Calendar.app calendar
names if work events are synced there. The default is `Joseph Fryer,Calendar`.
When no reliable event exists, the meeting is still processed and is explicitly
marked as unmatched.

Set `KRISP_ICS_EXPORT_PATH` to point at a Google Calendar `.ics` or `.ical.zip`
export when OAuth/local calendar sync does not have the work calendar. If unset,
the worker looks for `/Users/josephfryer/Downloads/jfryer@sightmachine.com.ical.zip`.
This is currently the strongest source for work meeting titles such as client
syncs and account-specific prep blocks.

The ledger is a Markdown table with one row per written segment. Mixed meetings
therefore show multiple rows sharing the same Krisp link but pointing at
different customer or private files.
