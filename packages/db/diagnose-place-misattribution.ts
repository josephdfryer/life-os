import { createClient } from "@libsql/client";

// Read-only sitewide diagnostic, covering all Places (not just NeNe).
//
// Bug A (fixed at the source in scripts/synthesis/writer.ts): a place merely
// MENTIONED in a call/email/message-thread conversation got written as that
// Event's (and every participant Interaction's) placeId, fabricating a
// "visit" and a "shared visit" with whoever was in the thread. Only
// type: "meeting" ever plausibly implies physical presence — the other
// three synthesis types (call/email_thread/message_thread) should never
// carry a placeId. This query finds every existing row still carrying that
// mistake.
//
// Bug B: real Era card transactions that share an identical merchantName
// with an already-resolved Place never got placeId set, because
// scripts/era/resolve-merchant-places.ts silently skips any row whose
// rawDescription doesn't parse to a known city (see lib/locality.ts). This
// groups the unresolved backlog by merchant so we can see how much of it
// is "same merchant, just never got picked up."

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) { console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN"); process.exit(1); }
  const client = createClient({ url, authToken });

  console.log("=== BUG A: Events mis-attributed a placeId from a text mention ===");
  const badEvents = await client.execute({
    sql: `SELECT e.id, e.name, e.type, e.timestamp, e.placeId, p.name AS placeName
          FROM Event e JOIN Place p ON p.id = e.placeId
          WHERE e.type IN ('message_thread','email_thread','call') AND e.placeId IS NOT NULL
          ORDER BY e.timestamp DESC`,
  });
  console.log(`Total mis-attributed Events: ${badEvents.rows.length}`);
  console.log(JSON.stringify(badEvents.rows.slice(0, 25), null, 2));
  if (badEvents.rows.length > 25) console.log(`...and ${badEvents.rows.length - 25} more`);

  const byPlace = new Map<string, { placeName: string; count: number }>();
  for (const row of badEvents.rows) {
    const key = row.placeId as string;
    const existing = byPlace.get(key);
    if (existing) existing.count++;
    else byPlace.set(key, { placeName: row.placeName as string, count: 1 });
  }
  console.log(`\nAffected Places: ${byPlace.size}`);
  console.log(JSON.stringify([...byPlace.entries()].map(([id, v]) => ({ placeId: id, ...v })).sort((a, b) => b.count - a.count), null, 2));

  if (badEvents.rows.length) {
    const eventIds = badEvents.rows.map(r => r.id as string);
    const placeholders = eventIds.map(() => "?").join(",");
    const badInteractions = await client.execute({
      sql: `SELECT id, eventId, personId, placeId FROM "Interaction" WHERE eventId IN (${placeholders}) AND placeId IS NOT NULL`,
      args: eventIds,
    });
    console.log(`\nInteractions on those Events still carrying placeId: ${badInteractions.rows.length}`);

    const distinctPeople = new Set(badInteractions.rows.map(r => r.personId).filter(Boolean));
    console.log(`Distinct People wrongly shown as "here" via this bug: ${distinctPeople.size}`);
  }

  console.log("\n=== BUG B: unresolved Era transactions, grouped by merchant ===");
  const unresolved = await client.execute({
    sql: `SELECT merchantName, COUNT(*) as cnt, SUM(amount) as totalCents
          FROM "Interaction"
          WHERE type = 'financial' AND source = 'era' AND placeId IS NULL AND merchantName IS NOT NULL
          GROUP BY merchantName ORDER BY cnt DESC LIMIT 40`,
  });
  console.log(`Distinct unresolved merchants (top 40 shown): ${unresolved.rows.length}`);
  console.log(JSON.stringify(unresolved.rows, null, 2));

  const totalUnresolved = await client.execute({
    sql: `SELECT COUNT(*) as cnt, SUM(amount) as totalCents FROM "Interaction" WHERE type = 'financial' AND source = 'era' AND placeId IS NULL AND merchantName IS NOT NULL`,
  });
  console.log("\nTotal unresolved financial interactions with a merchant name:", JSON.stringify(totalUnresolved.rows[0]));

  // Merchants with at least one resolved AND one unresolved row — the
  // NeNe pattern exactly (same merchant, inconsistent resolution).
  const mixed = await client.execute({
    sql: `SELECT merchantName,
            SUM(CASE WHEN placeId IS NULL THEN 1 ELSE 0 END) AS unresolvedCount,
            SUM(CASE WHEN placeId IS NOT NULL THEN 1 ELSE 0 END) AS resolvedCount
          FROM "Interaction"
          WHERE type = 'financial' AND source = 'era' AND merchantName IS NOT NULL
          GROUP BY merchantName
          HAVING unresolvedCount > 0 AND resolvedCount > 0
          ORDER BY unresolvedCount DESC`,
  });
  console.log(`\nMerchants with the exact "NeNe pattern" (some rows resolved, some not): ${mixed.rows.length}`);
  console.log(JSON.stringify(mixed.rows, null, 2));
}

main();
