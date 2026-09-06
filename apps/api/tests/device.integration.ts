import assert from "node:assert/strict"
import test from "node:test"
import { authorizeDeviceToken, createDeviceAuthorization, exchangeDeviceAuthorization, pkceChallenge, refreshDeviceCredential, revokeDevice } from "@life-os/access/device"
import { deviceIngestItemContract } from "@life-os/contracts"
import { db } from "@life-os/db"
import { resolveReviewItem } from "@life-os/domain"
import { ingestDeviceItem } from "@/lib/device-ingest"

const suffix = Date.now().toString(36)
const workspaceId = `device-test-${suffix}`
let userId = "", deviceId = "", accessToken = "", refreshToken = ""

test("device authorization, replay receipt, rotation, and revocation", async () => {
  await db.workspace.create({ data: { id: workspaceId, name: "Device test", slug: workspaceId } })
  const person = await db.person.create({ data: { workspaceId, first: "Device", last: "Owner" } })
  const user = await db.user.create({ data: { email: `${suffix}@example.test`, personId: person.id, workspaceMemberships: { create: { workspaceId, role: "owner" } } } })
  userId = user.id
  await db.workspace.update({ where: { id: workspaceId }, data: { ownerUserId: user.id } })

  const verifier = "v".repeat(64)
  const grant = await createDeviceAuthorization({ workspaceId, userId, platform: "macos", displayName: "Test Mac", appVersion: "1.0", redirectUri: "lifeos-companion://auth/callback", codeChallenge: pkceChallenge(verifier) })
  deviceId = grant.deviceId
  const pair = await exchangeDeviceAuthorization({ code: grant.code, codeVerifier: verifier, deviceId })
  accessToken = pair.accessToken; refreshToken = pair.refreshToken
  assert.equal((await authorizeDeviceToken(accessToken, "device.ingest"))?.workspaceId, workspaceId)
  assert.equal((await authorizeDeviceToken(accessToken, "people.read"))?.workspaceId, workspaceId)
  assert.equal(await authorizeDeviceToken(accessToken, "people.write"), null)

  const item = deviceIngestItemContract.parse({ deviceId, source: "voice_journal", sourceId: "voice-1", schemaVersion: 1, observedAt: new Date().toISOString(), record: { type: "voice.transcript", recordedAt: new Date().toISOString(), durationSeconds: 10, transcript: "A durable, normalized thought." } })
  assert.equal((await ingestDeviceItem(item, workspaceId)).status, "accepted")
  assert.equal((await ingestDeviceItem(item, workspaceId)).status, "duplicate")
  assert.equal(item.record.type, "voice.transcript")
  const changed = deviceIngestItemContract.parse({ ...item, record: { type: "voice.transcript", recordedAt: new Date().toISOString(), durationSeconds: 10, transcript: "Different content" } })
  assert.equal((await ingestDeviceItem(changed, workspaceId)).errorCode, "source_id_conflict")
  assert.equal(await db.note.count({ where: { workspaceId } }), 1)

  const rotated = await refreshDeviceCredential(refreshToken)
  assert.equal(await authorizeDeviceToken(accessToken, "device.ingest"), null)
  assert.ok(await authorizeDeviceToken(rotated.accessToken, "device.ingest"))

  // Simulate the installed iPhone: rotation succeeded on the server, the new
  // pair was never persisted or used, and the next tap still sends the old token.
  const unused = await refreshDeviceCredential(rotated.refreshToken)
  const recovered = await refreshDeviceCredential(rotated.refreshToken)
  assert.equal(await authorizeDeviceToken(unused.accessToken, "device.ingest"), null)
  assert.ok(await authorizeDeviceToken(recovered.accessToken, "device.ingest"))
  await assert.rejects(() => refreshDeviceCredential(rotated.refreshToken))

  await revokeDevice(deviceId, workspaceId)
  assert.equal(await authorizeDeviceToken(rotated.accessToken, "device.ingest"), null)

  // Scopes follow the app that registered the redirect: the Persons shell may
  // write people, notes, plans, and review items; the collector above could
  // not. Rotation carries the same set forward rather than re-deriving it.
  const personsVerifier = "p".repeat(64)
  const personsGrant = await createDeviceAuthorization({ workspaceId, userId, platform: "ios", displayName: "Persons on iPhone", appVersion: "1.0", redirectUri: "persons://auth/callback", codeChallenge: pkceChallenge(personsVerifier) })
  const personsPair = await exchangeDeviceAuthorization({ code: personsGrant.code, codeVerifier: personsVerifier, deviceId: personsGrant.deviceId })
  for (const scope of ["people.read", "people.write", "interactions.write", "notes.write", "plans.write", "review.write"]) {
    assert.equal((await authorizeDeviceToken(personsPair.accessToken, scope))?.workspaceId, workspaceId, `persons device must hold ${scope}`)
  }
  assert.equal(await authorizeDeviceToken(personsPair.accessToken, "workout.write"), null)
  const personsRotated = await refreshDeviceCredential(personsPair.refreshToken)
  assert.equal((await authorizeDeviceToken(personsRotated.accessToken, "people.write"))?.workspaceId, workspaceId, "rotation must preserve the app's scopes")
  assert.deepEqual([...personsRotated.scopes].sort(), [...personsPair.scopes].sort())

  const levelupVerifier = "l".repeat(64)
  const levelupGrant = await createDeviceAuthorization({ workspaceId, userId, platform: "ios", displayName: "Level Up on iPhone", appVersion: "1.0", redirectUri: "levelup://auth/callback", codeChallenge: pkceChallenge(levelupVerifier) })
  const levelupPair = await exchangeDeviceAuthorization({ code: levelupGrant.code, codeVerifier: levelupVerifier, deviceId: levelupGrant.deviceId })
  assert.ok(await authorizeDeviceToken(levelupPair.accessToken, "workout.write"))
  assert.equal(await authorizeDeviceToken(levelupPair.accessToken, "people.read"), null, "Level Up never reads people")
})

const contactsWorkspaceId = `device-contacts-test-${suffix}`

test("contact.person ingest: auto-apply on exact match, review queue otherwise", async () => {
  await db.workspace.create({ data: { id: contactsWorkspaceId, name: "Contacts device test", slug: contactsWorkspaceId } })
  const known = await db.person.create({ data: { workspaceId: contactsWorkspaceId, first: "Ada", last: "Lovelace", emails: JSON.stringify(["ada@example.test"]) } })
  const contactsDevice = await db.device.create({ data: { workspaceId: contactsWorkspaceId, platform: "ios", displayName: "Test Persons iPhone", appVersion: "1.0" } })
  const contactsDeviceId = contactsDevice.id

  // Exact email match: auto-applies as a fillable-fields-only update, no review item.
  const matched = deviceIngestItemContract.parse({
    deviceId: contactsDeviceId, source: "contacts", sourceId: "cn-ada",
    schemaVersion: 1, observedAt: new Date().toISOString(),
    record: { type: "contact.person", givenName: "Ada", familyName: "Lovelace", organizationName: "Analytical Engines", jobTitle: null, emails: ["ada@example.test"], phones: ["+1 555-0100"] },
  })
  const matchedResult = await ingestDeviceItem(matched, contactsWorkspaceId)
  assert.equal(matchedResult.status, "accepted")
  assert.equal(matchedResult.resultType, "Person")
  assert.equal(matchedResult.resultId, known.id)
  const updatedKnown = await db.person.findUniqueOrThrow({ where: { id: known.id } })
  assert.equal(updatedKnown.company, "Analytical Engines") // was empty, now filled
  assert.equal(JSON.parse(updatedKnown.phones)[0], "+1 555-0100") // was empty, now filled
  assert.equal(await db.reviewItem.count({ where: { workspaceId: contactsWorkspaceId } }), 0)

  // Re-syncing the same contact unchanged is idempotent at the receipt layer.
  assert.equal((await ingestDeviceItem(matched, contactsWorkspaceId)).status, "duplicate")
  const conflicting = deviceIngestItemContract.parse({ ...matched, record: { ...matched.record, jobTitle: "Countess" } })
  assert.equal((await ingestDeviceItem(conflicting, contactsWorkspaceId)).errorCode, "source_id_conflict")

  // No match at all: created immediately, no review needed — the device's
  // own address book is a list the person already chose to save, not an
  // arbitrary bulk file, so this is the low-touch path.
  const stranger = deviceIngestItemContract.parse({
    deviceId: contactsDeviceId, source: "contacts", sourceId: "cn-stranger",
    schemaVersion: 1, observedAt: new Date().toISOString(),
    record: { type: "contact.person", givenName: "Grace", familyName: "Hopper", organizationName: null, jobTitle: null, emails: ["grace@example.test"], phones: [] },
  })
  const strangerResult = await ingestDeviceItem(stranger, contactsWorkspaceId)
  assert.equal(strangerResult.status, "accepted")
  assert.equal(strangerResult.resultType, "Person")
  assert.equal(await db.reviewItem.count({ where: { workspaceId: contactsWorkspaceId } }), 0)
  const created = await db.person.findUniqueOrThrow({ where: { id: strangerResult.resultId! } })
  assert.equal(created.first, "Grace")
  assert.equal(created.source, "ios_contacts")
  assert.equal(created.closeness, 1, "new device contacts start without an ambient follow-up cadence")

  // A fuzzy-but-not-confident match against that just-created person still
  // goes to review: auto-creating here risks a silent duplicate, and
  // auto-applying risks silently attaching to the wrong person — this is the
  // one case that stays human-gated. edit_and_accept merges corrections
  // before the command runs.
  const stranger2 = deviceIngestItemContract.parse({
    deviceId: contactsDeviceId, source: "contacts", sourceId: "cn-stranger-2",
    schemaVersion: 1, observedAt: new Date().toISOString(),
    record: { type: "contact.person", givenName: "Grase", familyName: "Hoper", organizationName: null, jobTitle: null, emails: [], phones: [] },
  })
  const stranger2Result = await ingestDeviceItem(stranger2, contactsWorkspaceId)
  assert.equal(stranger2Result.resultType, "ReviewItem")
  const reviewItem2 = await db.reviewItem.findFirstOrThrow({ where: { workspaceId: contactsWorkspaceId, source: "contact_import", sourceId: stranger2Result.resultId! } })
  const editResolved = await resolveReviewItem({ id: reviewItem2.id, action: "edit_and_accept", editedInput: { first: "Grace", last: "Hopper" }, workspaceId: contactsWorkspaceId })
  const editedPerson = await db.person.findUniqueOrThrow({ where: { id: editResolved.resultId! } })
  assert.equal(editedPerson.first, "Grace")
  assert.equal(editedPerson.last, "Hopper")

  // A non-curated source (a scraped Facebook friend list) with no match must
  // NOT be auto-created, even with a perfectly good name: it carries no
  // email or phone, and the user never chose to save this person. It goes to
  // review with the source recorded in its evidence.
  const peopleBefore = await db.person.count({ where: { workspaceId: contactsWorkspaceId } })
  const fbFriend = deviceIngestItemContract.parse({
    deviceId: contactsDeviceId, source: "facebook", sourceId: "fb-1001",
    schemaVersion: 1, observedAt: new Date().toISOString(),
    record: { type: "contact.person", givenName: "Linus", familyName: "Torvalds", organizationName: null, jobTitle: null, emails: [], phones: [], profileUrl: "https://www.facebook.com/linus.example" },
  })
  const fbResult = await ingestDeviceItem(fbFriend, contactsWorkspaceId)
  assert.equal(fbResult.status, "accepted")
  assert.equal(fbResult.resultType, "ReviewItem", "an unmatched Facebook friend must be reviewed, never auto-created")
  assert.equal(await db.person.count({ where: { workspaceId: contactsWorkspaceId } }), peopleBefore, "no Person row may be created from a Facebook record")
  const fbReview = await db.reviewItem.findFirstOrThrow({ where: { workspaceId: contactsWorkspaceId, source: "contact_import", sourceId: fbResult.resultId! } })
  assert.equal(JSON.parse(fbReview.evidence ?? "{}").source, "facebook")

  // A curated source other than the phone's address book still auto-creates,
  // and records where it came from instead of the legacy "ios_contacts".
  const gContact = deviceIngestItemContract.parse({
    deviceId: contactsDeviceId, source: "google_contacts", sourceId: "gc-1",
    schemaVersion: 1, observedAt: new Date().toISOString(),
    record: { type: "contact.person", givenName: "Margaret", familyName: "Hamilton", organizationName: "MIT", jobTitle: null, emails: ["margaret@example.test"], phones: [] },
  })
  const gResult = await ingestDeviceItem(gContact, contactsWorkspaceId)
  assert.equal(gResult.resultType, "Person")
  const gPerson = await db.person.findUniqueOrThrow({ where: { id: gResult.resultId! } })
  assert.equal(gPerson.source, "google_contacts")
})

test.after(async () => {
  await db.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined)
  await db.user.delete({ where: { id: userId } }).catch(() => undefined)
  await db.workspace.delete({ where: { id: contactsWorkspaceId } }).catch(() => undefined)
  await db.$disconnect()
})
