import assert from "node:assert/strict"
import test from "node:test"
import { authorizeDeviceToken, createDeviceAuthorization, exchangeDeviceAuthorization, pkceChallenge, refreshDeviceCredential, revokeDevice } from "@life-os/access/device"
import { deviceIngestItemContract } from "@life-os/contracts"
import { db } from "@life-os/db"
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
  await revokeDevice(deviceId, workspaceId)
  assert.equal(await authorizeDeviceToken(rotated.accessToken, "device.ingest"), null)
})

test.after(async () => {
  await db.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined)
  await db.user.delete({ where: { id: userId } }).catch(() => undefined)
  await db.$disconnect()
})
