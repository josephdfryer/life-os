import { createClient } from "@libsql/client";

// Read-only diagnostic for "Places is empty".
//
// Places renders "No places yet" whenever getPlacesForMap returns zero rows
// for the workspace requireAccess resolved — and it renders that same empty
// state whether the Place rows are genuinely gone or merely sitting under a
// workspaceId the current session no longer resolves to. Production logs
// can't tell those apart: both are a clean 200 with no error. This script
// separates them, and touches nothing (every statement is a SELECT).
//
// What each section answers:
//   1. Do Place rows still exist at all, anywhere in the database?
//   2. If so, under which workspaceId — and is that the workspace the signed-in
//      account actually resolves to?
//   3. Is this Places-specific, or is every primitive empty for that workspace
//      (which would point at workspace resolution, not place data)?
//   4. Which workspace does each user resolve to? resolveWorkspace picks the
//      single active membership, so a user with two active memberships is a
//      400 and a user whose membership moved is a silently different tenant.
//   5. Has anything been recorded against places or workspaces in the audit log?
//
// Run against production with the same credentials the apps use:
//   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npx tsx packages/db/diagnose-empty-places.ts

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) { console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN"); process.exit(1); }
  const client = createClient({ url, authToken });

  console.log("=== 1. Do Place rows exist at all? ===");
  const total = await client.execute({ sql: `SELECT COUNT(*) AS n FROM Place` });
  const placeTotal = Number(total.rows[0]?.n ?? 0);
  console.log(`Total Place rows in the database (all workspaces): ${placeTotal}`);
  if (placeTotal === 0) {
    console.log("!! No Place rows anywhere — this is data loss, not a scoping problem.");
  } else {
    console.log("=> Place data still exists. If the app shows none, it is scoped to another workspace.");
  }

  console.log("\n=== 2. Places grouped by workspaceId ===");
  const byWorkspace = await client.execute({
    sql: `SELECT p.workspaceId, COUNT(*) AS placeCount, w.name AS workspaceName, w.status AS workspaceStatus
          FROM Place p LEFT JOIN Workspace w ON w.id = p.workspaceId
          GROUP BY p.workspaceId ORDER BY placeCount DESC`,
  });
  console.log(JSON.stringify(byWorkspace.rows, null, 2));

  console.log("\n=== 3. Is this Places-specific? Row counts per workspace, per primitive ===");
  // If Persons/Events are populated for the same workspace but Places is zero,
  // the problem is place data. If everything is zero for the workspace the user
  // resolves to, the problem is which workspace they resolve to.
  const perPrimitive = await client.execute({
    sql: `SELECT w.id AS workspaceId, w.name, w.status,
                 (SELECT COUNT(*) FROM Place       WHERE workspaceId = w.id) AS places,
                 (SELECT COUNT(*) FROM Person      WHERE workspaceId = w.id) AS persons,
                 (SELECT COUNT(*) FROM Event       WHERE workspaceId = w.id) AS events,
                 (SELECT COUNT(*) FROM "Interaction" WHERE workspaceId = w.id) AS interactions
          FROM Workspace w ORDER BY places DESC, persons DESC`,
  });
  console.log(JSON.stringify(perPrimitive.rows, null, 2));

  console.log("\n=== 4. Which workspace does each user resolve to? ===");
  // resolveWorkspace (packages/access/index.ts) takes the user's single ACTIVE
  // membership whose workspace is also active. Two active memberships throw a
  // 400; zero send the user through buildWorkspace, which can provision a new,
  // empty workspace — the exact shape of "everything went blank".
  const memberships = await client.execute({
    sql: `SELECT u.email, u.status AS userStatus, m.workspaceId, m.status AS memberStatus,
                 w.name AS workspaceName, w.status AS workspaceStatus, m.createdAt
          FROM User u LEFT JOIN WorkspaceMember m ON m.userId = u.id
          LEFT JOIN Workspace w ON w.id = m.workspaceId
          ORDER BY u.email, m.createdAt`,
  });
  console.log(JSON.stringify(memberships.rows, null, 2));

  const multi = await client.execute({
    sql: `SELECT u.email, COUNT(*) AS activeMemberships
          FROM User u JOIN WorkspaceMember m ON m.userId = u.id
          JOIN Workspace w ON w.id = m.workspaceId
          WHERE m.status = 'active' AND w.status = 'active'
          GROUP BY u.id HAVING COUNT(*) <> 1`,
  });
  console.log(`\nUsers WITHOUT exactly one active membership (these break resolveWorkspace): ${multi.rows.length}`);
  if (multi.rows.length) console.log(JSON.stringify(multi.rows, null, 2));

  console.log("\n=== 5. Audit log: anything touching places or workspaces ===");
  const audit = await client.execute({
    sql: `SELECT createdAt, action, targetType, targetId, workspaceId, actorType, metadata
          FROM AuditLog
          WHERE targetType IN ('place','workspace') OR action LIKE 'place%' OR action LIKE 'workspace%'
          ORDER BY createdAt DESC LIMIT 40`,
  });
  console.log(`Matching audit entries: ${audit.rows.length}`);
  console.log(JSON.stringify(audit.rows, null, 2));

  console.log("\n=== 6. Most recently created Places (is anything still arriving?) ===");
  const recent = await client.execute({
    sql: `SELECT id, name, workspaceId, createdAt FROM Place ORDER BY createdAt DESC LIMIT 15`,
  });
  console.log(JSON.stringify(recent.rows, null, 2));
}

main();
