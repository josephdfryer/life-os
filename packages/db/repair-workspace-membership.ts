import { db } from "./index"

// Repairs the one thing that makes every workspace-scoped surface — Places,
// Persons' Today, Events, the assistant — go simultaneously blank while the
// underlying rows sit untouched: which workspace a sign-in resolves to.
//
// resolveWorkspace (packages/access/index.ts) requires the user to have
// EXACTLY ONE active WorkspaceMember row pointing at an active Workspace.
//   - two or more  -> throws 400 "Multiple workspace memberships"
//   - zero         -> falls through to buildWorkspace, which can silently
//                     provision a BRAND NEW, EMPTY workspace. That is the
//                     shape of "all my data vanished" when nothing was
//                     actually deleted.
//
// This script makes one user resolve to one named workspace, and nothing else.
// It only ever flips WorkspaceMember.status (and inserts a membership row if
// none exists). It never deletes anything, never touches Place/Person/Event
// rows, and never modifies a Workspace. Every change is reversible, and the
// exact rollback is printed before it is made.
//
// Dry run by default — it prints the plan and changes nothing. Add --apply to
// actually write.
//
//   npx tsx packages/db/repair-workspace-membership.ts \
//     --email=you@example.com --workspace=default-workspace
//
//   ... then re-run the same command with --apply once the plan looks right.
//
// Run diagnose-empty-places.ts FIRST to learn which workspaceId actually holds
// your data — that is the value to pass to --workspace.

type Args = { email?: string; workspace?: string; role?: string; apply: boolean }

const VALID_ROLES = ["owner", "admin", "member", "viewer"] as const
type Role = (typeof VALID_ROLES)[number]

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false }
  for (const raw of argv) {
    if (raw === "--apply") { args.apply = true; continue }
    const match = /^--([^=]+)=(.*)$/.exec(raw)
    if (!match) continue
    const [, key, value] = match
    if (key === "email") args.email = value.toLowerCase().trim()
    else if (key === "workspace") args.workspace = value.trim()
    else if (key === "role") args.role = value.trim()
  }
  return args
}

function die(message: string): never {
  console.error(`\n✗ ${message}`)
  process.exit(1)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.email || !args.workspace) {
    die("Usage: --email=<email> --workspace=<workspaceId> [--role=<owner|admin|member|viewer>] [--apply]")
  }
  if (args.role && !VALID_ROLES.includes(args.role as Role)) {
    die(`--role must be one of: ${VALID_ROLES.join(", ")}`)
  }

  const mode = args.apply ? "APPLY (will write)" : "DRY RUN (no changes)"
  console.log(`\n=== repair-workspace-membership — ${mode} ===`)
  console.log(`user:      ${args.email}`)
  console.log(`workspace: ${args.workspace}\n`)

  const user = await db.user.findUnique({
    where: { email: args.email },
    select: { id: true, email: true, status: true },
  })
  if (!user) die(`No User row with email ${args.email}. Nothing to repair — check the address.`)
  if (user.status !== "active") {
    console.log(`! User.status is "${user.status}" — requireAccess rejects non-active users outright.`)
    console.log("  Fix that separately; this script does not change account status.\n")
  }

  const workspace = await db.workspace.findUnique({
    where: { id: args.workspace },
    select: { id: true, name: true, status: true, ownerUserId: true },
  })
  if (!workspace) die(`No Workspace with id "${args.workspace}". Run diagnose-empty-places.ts to list real ids.`)
  if (workspace.status !== "active") {
    die(`Workspace "${workspace.id}" has status "${workspace.status}". resolveWorkspace ignores non-active workspaces, so pointing at it would not help. Reactivate it first.`)
  }

  // Show what is actually in the target workspace, so a wrong id is obvious
  // before anything is written rather than after.
  const [places, persons, events] = await Promise.all([
    db.place.count({ where: { workspaceId: workspace.id } }),
    db.person.count({ where: { workspaceId: workspace.id } }),
    db.event.count({ where: { workspaceId: workspace.id } }),
  ])
  console.log(`Target workspace: "${workspace.name}" (${workspace.id})`)
  console.log(`  places=${places}  persons=${persons}  events=${events}`)
  if (places === 0 && persons === 0 && events === 0) {
    console.log("  ! This workspace is EMPTY. If you expected data here, you have the wrong id —")
    console.log("    re-check diagnose-empty-places.ts section 2 before applying.")
  }
  console.log()

  const memberships = await db.workspaceMember.findMany({
    where: { userId: user.id },
    include: { workspace: { select: { id: true, name: true, status: true } } },
    orderBy: { createdAt: "asc" },
  })

  console.log("Current memberships for this user:")
  if (!memberships.length) console.log("  (none)")
  for (const m of memberships) {
    const effective = m.status === "active" && m.workspace.status === "active"
    console.log(`  - ${m.workspace.id} (${m.workspace.name}) member=${m.status} workspace=${m.workspace.status} role=${m.role}${effective ? "   <- counts toward resolveWorkspace" : ""}`)
  }

  const effectiveNow = memberships.filter(m => m.status === "active" && m.workspace.status === "active")
  console.log(`\nresolveWorkspace today: ${describeVerdict(effectiveNow.map(m => m.workspace.id))}\n`)

  const target = memberships.find(m => m.workspaceId === workspace.id)
  const toDeactivate = memberships.filter(m => m.workspaceId !== workspace.id && m.status === "active")

  let roleForCreate: Role | null = null
  if (!target) {
    if (args.role) roleForCreate = args.role as Role
    else if (workspace.ownerUserId === user.id) roleForCreate = "owner"
    else {
      die(`No membership row exists for this user in "${workspace.id}", and they are not its ownerUserId, so the correct role is not inferable. Re-run with an explicit --role=<${VALID_ROLES.join("|")}>.`)
    }
  }

  console.log("Planned changes:")
  const plan: string[] = []
  if (!target) plan.push(`CREATE membership ${user.email} -> ${workspace.id} (role=${roleForCreate}, status=active)`)
  else if (target.status !== "active") plan.push(`UPDATE membership ${target.id} (${workspace.id}) status "${target.status}" -> "active"`)
  for (const m of toDeactivate) plan.push(`UPDATE membership ${m.id} (${m.workspaceId}) status "active" -> "inactive"`)
  if (!plan.length) {
    console.log("  (nothing to change — this user already resolves to exactly this workspace)")
    console.log("\nIf surfaces are still blank, the cause is not workspace resolution. Stop here and")
    console.log("re-read diagnose-empty-places.ts sections 1-3 before changing anything else.\n")
    return
  }
  for (const line of plan) console.log(`  ${line}`)

  console.log("\nRollback if this is wrong (nothing is deleted, so it is a status flip back):")
  if (target) console.log(`  membership ${target.id} -> status "${target.status}"`)
  else console.log(`  delete the membership row created for ${user.email} in ${workspace.id}`)
  for (const m of toDeactivate) console.log(`  membership ${m.id} -> status "active"`)

  if (!args.apply) {
    console.log("\nDRY RUN — nothing was written. Re-run with --apply to make these changes.\n")
    return
  }

  await db.$transaction(async tx => {
    if (!target) {
      await tx.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: user.id, role: roleForCreate as Role, status: "active" },
      })
    } else if (target.status !== "active") {
      await tx.workspaceMember.update({ where: { id: target.id }, data: { status: "active" } })
    }
    for (const m of toDeactivate) {
      await tx.workspaceMember.update({ where: { id: m.id }, data: { status: "inactive" } })
    }
  })

  const after = await db.workspaceMember.findMany({
    where: { userId: user.id },
    include: { workspace: { select: { id: true, name: true, status: true } } },
    orderBy: { createdAt: "asc" },
  })
  const effectiveAfter = after.filter(m => m.status === "active" && m.workspace.status === "active")

  console.log("\n✓ Applied. Memberships now:")
  for (const m of after) {
    console.log(`  - ${m.workspace.id} member=${m.status} workspace=${m.workspace.status} role=${m.role}`)
  }
  console.log(`\nresolveWorkspace now: ${describeVerdict(effectiveAfter.map(m => m.workspace.id))}`)
  console.log("\nrequireAccess caches the resolved actor for 60s per instance, so give it a")
  console.log("minute (or just reload twice) before judging whether the apps came back.\n")
}

function describeVerdict(activeWorkspaceIds: string[]): string {
  if (activeWorkspaceIds.length === 1) return `resolves to ${activeWorkspaceIds[0]} — correct (exactly one)`
  if (activeWorkspaceIds.length === 0) {
    return "NO active membership — falls through to buildWorkspace, which can provision a brand-new EMPTY workspace (this is the 'everything vanished' case)"
  }
  return `${activeWorkspaceIds.length} active memberships (${activeWorkspaceIds.join(", ")}) — throws 400 "Multiple workspace memberships"`
}

main()
  .catch(error => { console.error(error); process.exit(1) })
  .finally(() => void db.$disconnect())
