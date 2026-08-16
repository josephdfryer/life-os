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

  // No match at all: never auto-created, always staged for review.
  const stranger = deviceIngestItemContract.parse({
    deviceId: contactsDeviceId, source: "contacts", sourceId: "cn-stranger",
    schemaVersion: 1, observedAt: new Date().toISOString(),
    record: { type: "contact.person", givenName: "Grace", familyName: "Hopper", organizationName: null, jobTitle: null, emails: ["grace@example.test"], phones: [] },
  })
  const strangerResult = await ingestDeviceItem(stranger, contactsWorkspaceId)
  assert.equal(strangerResult.status, "accepted")
  assert.equal(strangerResult.resultType, "ReviewItem")
  const reviewItem = await db.reviewItem.findFirstOrThrow({ where: { workspaceId: contactsWorkspaceId, source: "contact_import", sourceId: strangerResult.resultId! } })
  assert.equal(reviewItem.status, "pending")
  assert.equal(await db.person.count({ where: { workspaceId: contactsWorkspaceId, first: "Grace" } }), 0)

  // Accepting the review item is what actually creates the Person.
  const resolved = await resolveReviewItem({ id: reviewItem.id, action: "accept", workspaceId: contactsWorkspaceId })
  assert.equal(resolved.status, "accepted")
  assert.equal(resolved.resultType, "Person")
  const created = await db.person.findUniqueOrThrow({ where: { id: resolved.resultId! } })
  assert.equal(created.first, "Grace")
  assert.equal(created.source, "ios_contacts")

  // edit_and_accept merges corrections before the command runs.
  const stranger2 = deviceIngestItemContract.parse({
    deviceId: contactsDeviceId, source: "contacts", sourceId: "cn-stranger-2",
    schemaVersion: 1, observedAt: new Date().toISOString(),
    record: { type: "contact.person", givenName: "Grase", familyName: "Hoper", organizationName: null, jobTitle: null, emails: [], phones: [] },
  })
  const stranger2Result = await ingestDeviceItem(stranger2, contactsWorkspaceId)
  const reviewItem2 = await db.reviewItem.findFirstOrThrow({ where: { workspaceId: contactsWorkspaceId, source: "contact_import", sourceId: stranger2Result.resultId! } })
  const editResolved = await resolveReviewItem({ id: reviewItem2.id, action: "edit_and_accept", editedInput: { first: "Grace", last: "Hopper" }, workspaceId: contactsWorkspaceId })
  const editedPerson = await db.person.findUniqueOrThrow({ where: { id: editResolved.resultId! } })
  assert.equal(editedPerson.first, "Grace")
  assert.equal(editedPerson.last, "Hopper")
})

test.after(async () => {
  await db.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined)
  await db.user.delete({ where: { id: userId } }).catch(() => undefined)
  await db.workspace.delete({ where: { id: contactsWorkspaceId } }).catch(() => undefined)
  await db.$disconnect()
})
