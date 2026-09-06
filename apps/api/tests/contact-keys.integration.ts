import assert from "node:assert/strict"
import test from "node:test"
import { db } from "@life-os/db"
import { matchContact, matchContacts, normalizeEmailForMatch, normalizePhoneForMatch, peopleByEmailKeys } from "@life-os/domain"

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
const workspaceA = `contact-keys-a-${suffix}`
const workspaceB = `contact-keys-b-${suffix}`

// The SQL normalizers in migration 20260906080000 must agree with the TS ones
// in packages/domain/contact-matching.ts on every fixture, or the index and
// the matcher silently disagree about who is the same person.
test("SQL and TS contact normalizers agree", async () => {
  const emails = [
    "Ada.Lovelace+news@Gmail.com", "ada@example.test", " ADA@EXAMPLE.TEST ", "a.d.a@googlemail.com",
    "plus+tag@corp.io", "+lead@corp.io", "nodomain@localhost", "@nobody.test", "trailing@", "", "not an email",
  ]
  const phones = ["+1 (555) 010-0100", "555-0100", "0015550100100", "15550100100", "12345", "+44 20 7946 0958", ""]
  for (const value of emails) {
    const [row] = await db.$queryRaw<{ v: string | null }[]>`SELECT lifeos_normalize_email(${value}) AS v`
    assert.equal(row.v, normalizeEmailForMatch(value), `email ${JSON.stringify(value)}`)
  }
  for (const value of phones) {
    const [row] = await db.$queryRaw<{ v: string | null }[]>`SELECT lifeos_normalize_phone(${value}) AS v`
    assert.equal(row.v, normalizePhoneForMatch(value), `phone ${JSON.stringify(value)}`)
  }
})

test("PersonContact keys follow Person writes through the trigger", async () => {
  await db.workspace.createMany({ data: [
    { id: workspaceA, name: "Keys A", slug: workspaceA },
    { id: workspaceB, name: "Keys B", slug: workspaceB },
  ] })
  const ada = await db.person.create({ data: { workspaceId: workspaceA, first: "Ada", last: "Lovelace", emails: JSON.stringify(["Ada.Lovelace+x@gmail.com", "ada@example.test"]), phones: JSON.stringify(["+1 (555) 010-0100"]) } })
  const keys = await db.personContact.findMany({ where: { personId: ada.id }, orderBy: [{ kind: "asc" }, { normalized: "asc" }] })
  assert.deepEqual(keys.map(k => `${k.kind}:${k.normalized}`), ["email:ada@example.test", "email:adalovelace@gmail.com", "phone:5550100100"])
  assert.ok(keys.every(k => k.workspaceId === workspaceA))

  await db.person.update({ where: { id: ada.id }, data: { emails: JSON.stringify(["countess@example.test"]), phones: "[]" } })
  const after = await db.personContact.findMany({ where: { personId: ada.id } })
  assert.deepEqual(after.map(k => `${k.kind}:${k.normalized}`), ["email:countess@example.test"])

  // Malformed JSON never breaks a write; it just yields no keys.
  const odd = await db.person.create({ data: { workspaceId: workspaceA, first: "Odd", last: "Row", emails: "not json" } })
  assert.equal(await db.personContact.count({ where: { personId: odd.id } }), 0)

  await db.person.delete({ where: { id: odd.id } })
  assert.equal(await db.personContact.count({ where: { personId: odd.id } }), 0, "cascade on delete")
})

test("matchContact finds exact keys and fuzzy names without scanning the workspace", async () => {
  const grace = await db.person.create({ data: { workspaceId: workspaceA, first: "Grace", last: "Hopper", emails: JSON.stringify(["grace@example.test"]), phones: JSON.stringify(["+1 555 020 0200"]) } })
  await db.person.create({ data: { workspaceId: workspaceB, first: "Grace", last: "Hopper", emails: JSON.stringify(["grace@example.test"]) } })

  const byEmail = await matchContact({ first: "G", last: "H", emails: ["GRACE+promo@example.test"] }, workspaceA)
  assert.equal(byEmail?.personId, grace.id)
  assert.equal(byEmail?.score, 1)

  const byPhone = await matchContact({ first: "Someone", last: "Else", phones: ["(555) 020-0200"] }, workspaceA)
  assert.equal(byPhone?.personId, grace.id)
  assert.equal(byPhone?.reason, "Same phone number")

  const fuzzy = await matchContact({ first: "Grase", last: "Hoper" }, workspaceA)
  assert.equal(fuzzy?.personId, grace.id, "a typo'd name still reaches the scorer via trigram retrieval")
  assert.ok((fuzzy?.score ?? 0) >= 0.7 && (fuzzy?.score ?? 1) < 0.95)

  const none = await matchContact({ first: "Zelda", last: "Fitzgerald", emails: ["zelda@example.test"] }, workspaceA)
  assert.equal(none, null)

  const otherWorkspace = await matchContact({ first: "Grace", last: "Hopper", emails: ["grace@example.test"] }, workspaceB)
  assert.notEqual(otherWorkspace?.personId, grace.id, "keys never cross workspaces")

  const batch = await matchContacts([
    { first: "Grace", last: "Hopper", emails: ["grace@example.test"] },
    { first: "Nobody", last: "Known" },
    { phones: ["5550200200"] },
  ], workspaceA)
  assert.deepEqual(batch.map(m => m?.personId ?? null), [grace.id, null, grace.id])

  const index = await peopleByEmailKeys(["Grace+x@Example.test", "missing@example.test"], workspaceA)
  assert.equal(index.get("grace@example.test")?.id, grace.id)
  assert.equal(index.size, 1)
})

test.after(async () => {
  await db.workspace.delete({ where: { id: workspaceA } }).catch(() => undefined)
  await db.workspace.delete({ where: { id: workspaceB } }).catch(() => undefined)
  await db.$disconnect()
})
