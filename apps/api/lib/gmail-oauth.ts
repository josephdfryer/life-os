import type { GmailConnection, Prisma } from "@life-os/db"
import { decryptNullable, encryptNullable } from "@life-os/db/crypto"
import {
  GoogleOAuthError,
  exchangeGoogleCode,
  newOAuthState,
  resolveOAuthBaseUrl,
  signOAuthState,
  verifyOAuthState,
} from "./google-oauth"

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1"
const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
const GOOGLE_CONTACTS_READONLY_SCOPE = "https://www.googleapis.com/auth/contacts.readonly"
const GOOGLE_OTHER_CONTACTS_READONLY_SCOPE = "https://www.googleapis.com/auth/contacts.other.readonly"
export const GMAIL_SCOPE = `${GMAIL_READONLY_SCOPE} ${GOOGLE_CONTACTS_READONLY_SCOPE} ${GOOGLE_OTHER_CONTACTS_READONLY_SCOPE}`

function gmailClientId() {
  return process.env.GOOGLE_GMAIL_CLIENT_ID
    || process.env.GMAIL_GOOGLE_CLIENT_ID
    || process.env.GOOGLE_CLIENT_ID
    || null
}

function gmailClientSecret() {
  return process.env.GOOGLE_GMAIL_CLIENT_SECRET
    || process.env.GMAIL_GOOGLE_CLIENT_SECRET
    || process.env.GOOGLE_CLIENT_SECRET
    || null
}

export function gmailRedirectUri(origin: string | null) {
  const explicit = process.env.GOOGLE_GMAIL_REDIRECT_URI || process.env.GMAIL_REDIRECT_URI
  if (explicit) return explicit
  const base = resolveOAuthBaseUrl(origin)
  if (!base) throw new GoogleOAuthError("Gmail redirect URI could not be resolved", "not_configured")
  return `${base.replace(/\/$/, "")}/admin/connections/google/gmail/callback`
}

export function gmailConfigured() {
  return Boolean(gmailClientId() && gmailClientSecret())
}

export function createGmailAuthorizeUrl(workspaceId: string, userId: string, returnTo: string) {
  const clientId = gmailClientId()
  const clientSecret = gmailClientSecret()
  if (!clientId || !clientSecret) throw new GoogleOAuthError("Gmail OAuth is not configured", "not_configured")

  const state = signOAuthState(newOAuthState(workspaceId, userId, returnTo))
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: gmailRedirectUri(null),
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  })
  return { url: `${GOOGLE_AUTH_URL}?${params.toString()}` }
}

async function mirrorGmailConnection(tx: Prisma.TransactionClient, connection: GmailConnection) {
  const existing = await tx.connection.findFirst({
    where: { workspaceId: connection.workspaceId, sourceTable: "GmailConnection", sourceId: connection.id },
    select: { id: true },
  })
  const data = {
    userId: connection.userId,
    kind: "gmail",
    provider: connection.provider,
    status: connection.status,
    accountEmail: connection.accountEmail,
    accessTokenEncrypted: connection.accessTokenEncrypted,
    refreshTokenEncrypted: connection.refreshTokenEncrypted,
    expiresAt: connection.expiresAt,
    scope: connection.scope,
    lastSyncedAt: connection.lastSyncedAt,
    lastError: connection.lastError,
    metadata: JSON.stringify({ mailboxId: connection.mailboxId, historyId: connection.historyId }),
    sourceTable: "GmailConnection",
    sourceId: connection.id,
  }
  if (existing) await tx.connection.update({ where: { id: existing.id }, data })
  else await tx.connection.create({ data: { workspaceId: connection.workspaceId, ...data } })
}

async function fetchGmailProfile(accessToken: string) {
  const response = await fetch(`${GMAIL_BASE}/users/me/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  })
  if (!response.ok) throw new GoogleOAuthError(`Gmail profile request failed (${response.status})`)
  return await response.json() as { emailAddress?: string }
}

export async function handleGmailOAuthCallback(input: { code: string; state: string; origin?: string | null }) {
  const state = verifyOAuthState(input.state)
  const clientId = gmailClientId()
  const clientSecret = gmailClientSecret()
  if (!clientId || !clientSecret) throw new GoogleOAuthError("Gmail OAuth is not configured", "not_configured")

  const token = await exchangeGoogleCode({
    code: input.code,
    redirectUri: gmailRedirectUri(input.origin ?? null),
    clientId,
    clientSecret,
  })
  if (!token.refresh_token) {
    throw new GoogleOAuthError("Google did not return a refresh token. Reconnect Gmail and approve offline access.")
  }

  const profile = await fetchGmailProfile(token.access_token)
  const accountEmail = profile.emailAddress ?? null
  const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null
  const mailboxId = "me"

  const { db } = await import("@life-os/db")
  const connection = await db.$transaction(async tx => {
    const gmailConnection = await tx.gmailConnection.upsert({
      where: { workspaceId_provider_mailboxId: { workspaceId: state.workspaceId, provider: "google", mailboxId } },
      update: {
        userId: state.userId,
        status: "active",
        accountEmail,
        accessTokenEncrypted: encryptNullable(token.access_token),
        refreshTokenEncrypted: encryptNullable(token.refresh_token),
        expiresAt,
        scope: token.scope ?? GMAIL_SCOPE,
        lastError: null,
      },
      create: {
        workspaceId: state.workspaceId,
        userId: state.userId,
        provider: "google",
        status: "active",
        accountEmail,
        mailboxId,
        accessTokenEncrypted: encryptNullable(token.access_token),
        refreshTokenEncrypted: encryptNullable(token.refresh_token),
        expiresAt,
        scope: token.scope ?? GMAIL_SCOPE,
      },
    })
    await mirrorGmailConnection(tx, gmailConnection)
    return gmailConnection
  })

  return { returnTo: state.returnTo, connectionId: connection.id, accountEmail }
}
