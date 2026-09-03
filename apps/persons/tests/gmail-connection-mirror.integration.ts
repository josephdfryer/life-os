import assert from "node:assert/strict"
import { db } from "@life-os/db"
import { gmailAuthUrl, handleGmailCallback, importGmailContactsPreview, syncGmail } from "@/server/domain/gmail"
import type { AccessActor } from "@/server/domain/access"

const originalFetch = globalThis.fetch

async function main() {
  const workspace = await db.workspace.findFirst({ include: { members: { take: 1, include: { user: true } } } })
  assert.ok(workspace)
  const member = workspace.members[0]
  assert.ok(member)

  const actor: AccessActor = {
    userId: member.userId,
    email: member.user.email,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    scopes: ["gmail.manage"],
    actor: { type: "user", id: member.userId, workspaceId: workspace.id },
  }

  globalThis.fetch = async input => {
    const url = String(input)
    if (url === "https://oauth2.googleapis.com/token") {
      return Response.json({
        access_token: "fixture-access-token",
        refresh_token: "fixture-refresh-token",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/contacts.readonly",
      })
    }
    if (url.endsWith("/gmail/v1/users/me/profile")) {
      return Response.json({ emailAddress: "fixture@example.com", historyId: "100" })
    }
    if (url.includes("/people/me/connections?")) {
      return Response.json({ connections: [] })
    }
    if (url.includes("/gmail/v1/users/me/messages?")) {
      return new Response("fixture sync failure", { status: 500 })
    }
    throw new Error(`Unexpected fixture request: ${url}`)
  }

  const origin = "http://localhost:3100"
  const authUrl = gmailAuthUrl(actor, origin, "/admin/connections")
  const state = new URL(authUrl).searchParams.get("state")
  assert.ok(state)
  const callback = await handleGmailCallback({ code: "fixture-code", state, origin })

  const gmail = await db.gmailConnection.findUnique({ where: { id: callback.connectionId } })
  assert.ok(gmail)
  const mirror = await db.connection.findFirst({
    where: { workspaceId: workspace.id, sourceTable: "GmailConnection", sourceId: gmail.id },
  })
  assert.ok(mirror)
  assert.equal(mirror.kind, "gmail")
  assert.equal(mirror.accountEmail, "fixture@example.com")
  assert.notEqual(mirror.accessTokenEncrypted, "fixture-access-token")
  assert.deepEqual(JSON.parse(mirror.metadata ?? "{}"), { mailboxId: "me", historyId: null })

  await db.gmailConnection.update({ where: { id: gmail.id }, data: { expiresAt: new Date(0) } })
  await importGmailContactsPreview(actor)
  const refreshedMirror = await db.connection.findUnique({ where: { id: mirror.id } })
  assert.ok(refreshedMirror?.expiresAt && refreshedMirror.expiresAt.getTime() > Date.now())
  assert.notEqual(refreshedMirror.accessTokenEncrypted, "fixture-access-token")

  await assert.rejects(() => syncGmail(actor), /Gmail messages request failed \(500\)/)
  const [failedGmail, failedMirror] = await Promise.all([
    db.gmailConnection.findUnique({ where: { id: gmail.id } }),
    db.connection.findUnique({ where: { id: mirror.id } }),
  ])
  assert.equal(failedGmail?.lastError, "Gmail messages request failed (500)")
  assert.equal(failedMirror?.lastError, failedGmail?.lastError)

  console.log("All Gmail connection mirror integration assertions passed.")
}

main()
  .finally(async () => {
    globalThis.fetch = originalFetch
    await db.$disconnect()
  })
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
