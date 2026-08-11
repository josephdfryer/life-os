import { createClient } from "@libsql/client";

// One-time correction for NeNe Japanese Contemporary Bistro (Place
// cmrgsw1xb00c5d913eb1vnawe):
//
// 1. Event cmrip6cnc0001i6cid7y4xqlr ("AI Investment News Discussion with
//    Kanna Portharlanka") is an iMessage-derived message_thread event
//    (source: imessage, type: message_thread) — not a real visit. Its
//    placeId got set to NeNe even though nothing about it is in-person.
//    Null out the Event's placeId and the matching Interaction's placeId
//    so this stops counting as a "visit" and stops attributing Kanna as
//    someone Joseph shared a visit here with.
// 2. Interaction cmscigtdk005rjhci9x5l09pa is a real Era transaction
//    ($164.51, Jul 10 2026) already correctly resolved to this Place via
//    placeId, but has no eventId — it was invisible in totalSpend before
//    the places.ts derivation fix (now fixed in code). No data change
//    needed for this one; included here only as a readback check.
// 3. Interaction cmschot2w0063keci789llpr5 is a real Era transaction
//    ($220.00, May 2 2026) with merchantName "Nene Japanese Contemlas" but
//    placeId/eventId both null — never resolved to the Place at all. Set
//    its placeId so it's counted too.
//
// Idempotent: every UPDATE is scoped by id and checks current value first.

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) { console.error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN"); process.exit(1); }
  const client = createClient({ url, authToken });

  const placeId = "cmrgsw1xb00c5d913eb1vnawe";
  const messageThreadEventId = "cmrip6cnc0001i6cid7y4xqlr";
  const messageThreadInteractionId = "cmrip6cq50002i6cimosqxryn";
  const unresolvedTransactionId = "cmschot2w0063keci789llpr5";

  const event = await client.execute({ sql: `SELECT id, placeId, type FROM Event WHERE id = ?`, args: [messageThreadEventId] });
  console.log("BEFORE — event:", JSON.stringify(event.rows));
  if (event.rows[0]?.placeId === placeId) {
    await client.execute({ sql: `UPDATE Event SET placeId = NULL WHERE id = ?`, args: [messageThreadEventId] });
    console.log("Cleared Event.placeId for the message_thread event.");
  } else {
    console.log("Event.placeId already not NeNe — skipping.");
  }

  const interaction = await client.execute({ sql: `SELECT id, placeId FROM "Interaction" WHERE id = ?`, args: [messageThreadInteractionId] });
  console.log("BEFORE — interaction:", JSON.stringify(interaction.rows));
  if (interaction.rows[0]?.placeId === placeId) {
    await client.execute({ sql: `UPDATE "Interaction" SET placeId = NULL WHERE id = ?`, args: [messageThreadInteractionId] });
    console.log("Cleared Interaction.placeId for the message_thread interaction.");
  } else {
    console.log("Interaction.placeId already not NeNe — skipping.");
  }

  const tx = await client.execute({ sql: `SELECT id, placeId, merchantName, amount FROM "Interaction" WHERE id = ?`, args: [unresolvedTransactionId] });
  console.log("BEFORE — $220 transaction:", JSON.stringify(tx.rows));
  if (tx.rows[0] && tx.rows[0].placeId === null) {
    await client.execute({ sql: `UPDATE "Interaction" SET placeId = ? WHERE id = ?`, args: [placeId, unresolvedTransactionId] });
    console.log("Linked the $220.00 May 2 transaction to NeNe's Place record.");
  } else {
    console.log("$220 transaction already has a placeId — skipping.");
  }

  const after = await client.execute({
    sql: `SELECT id, placeId, eventId, amount, merchantName FROM "Interaction" WHERE placeId = ? OR id IN (?, ?)`,
    args: [placeId, messageThreadInteractionId, unresolvedTransactionId],
  });
  console.log("AFTER — all interactions touching this place:", JSON.stringify(after.rows, null, 2));
}

main();
