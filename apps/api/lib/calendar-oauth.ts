import { encryptNullable } from "@life-os/db/crypto"
import {
  GoogleOAuthError,
  exchangeGoogleCode,
  newOAuthState,
  resolveOAuthBaseUrl,
  signOAuthState,
  verifyOAuthState,
} from "./google-oauth"

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const GOOGLE_CALENDAR_BASE = "https://www.googleapis.com/calendar/v3"
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly"

function calendarClientId() {
  return process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || null
}

function calendarClientSecret() {
  return process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || null
}

function calendarAccountEmail() {
  return process.env.GOOGLE_CALENDAR_ACCOUNT_EMAIL?.trim() || "jdf247@gmail.com"
}

export function calendarRedirectUri(origin: string | null) {
  const explicit = process.env.GOOGLE_CALENDAR_REDIRECT_URI
  if (explicit) return explicit
  const base = resolveOAuthBaseUrl(origin)
  if (!base) throw new GoogleOAuthError("Google Calendar redirect URI could not be resolved", "not_configured")
  return `${base.replace(/\/$/, "")}/admin/connections/google/calendar/callback`
}

export function calendarConfigured() {
  return Boolean(calendarClientId() && calendarClientSecret())
}

export function createCalendarAuthorizeUrl(workspaceId: string, userId: string, returnTo: string) {
  const clientId = calendarClientId()
  const clientSecret = calendarClientSecret()
  if (!clientId || !clientSecret) {
    throw new GoogleOAuthError("Google Calendar OAuth is not configured", "not_configured")
  }

  const state = signOAuthState(newOAuthState(workspaceId, userId, returnTo))
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: calendarRedirectUri(null),
    response_type: "code",
    scope: CALENDAR_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  })
  const expectedEmail = calendarAccountEmail()
  if (expectedEmail) params.set("login_hint", expectedEmail)
  return { url: `${GOOGLE_AUTH_URL}?${params.toString()}` }
}

async function googleFetch(url: string, accessToken: string) {
  return fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" })
}

async function fetchGoogleAccountEmail(accessToken: string) {
  const response = await googleFetch(GOOGLE_USERINFO_URL, accessToken)
  if (!response.ok) return null
  const data = await response.json() as { email?: string }
  return data.email ?? null
}

async function fetchPrimaryCalendar(accessToken: string) {
  const response = await googleFetch(`${GOOGLE_CALENDAR_BASE}/calendars/primary`, accessToken)
  if (!response.ok) return {}
  return await response.json() as { summary?: string }
}

function assertExpectedCalendarAccount(accountEmail: string | null) {
  const expected = calendarAccountEmail()
  if (expected && accountEmail && accountEmail.toLowerCase() !== expected.toLowerCase()) {
    throw new GoogleOAuthError(`Connect with ${expected}. Google returned ${accountEmail}.`)
  }
}

async function syncCalendarConnectionMirror(connectionId: string) {
  const { db } = await import("@life-os/db")
  const connection = await db.calendarConnection.findUnique({ where: { id: connectionId } })
  if (!connection) return
  const data = {
    workspaceId: connection.workspaceId,
    userId: connection.userId,
    kind: "calendar",
    provider: connection.provider,
    status: connection.status,
    accountEmail: connection.accountEmail,
    label: connection.calendarSummary,
    accessTokenEncrypted: connection.accessTokenEncrypted,
    refreshTokenEncrypted: connection.refreshTokenEncrypted,
    expiresAt: connection.expiresAt,
    scope: connection.scope,
    lastSyncedAt: connection.lastSyncedAt,
    lastError: connection.lastError,
    metadata: JSON.stringify({ calendarId: connection.calendarId, calendarSummary: connection.calendarSummary }),
    sourceTable: "CalendarConnection",
    sourceId: connection.id,
  }
  const mirror = await db.connection.findFirst({
    where: { workspaceId: connection.workspaceId, sourceTable: "CalendarConnection", sourceId: connection.id },
    select: { id: true },
  })
  if (mirror) await db.connection.update({ where: { id: mirror.id }, data })
  else await db.connection.create({ data })
}

async function syncCalendarConnectionMirrors(workspaceId: string) {
  const { db } = await import("@life-os/db")
  const connections = await db.calendarConnection.findMany({
    where: { workspaceId, provider: "google" },
    select: { id: true },
  })
  for (const connection of connections) await syncCalendarConnectionMirror(connection.id)
}

export async function handleCalendarOAuthCallback(input: { code: string; state: string; origin?: string | null }) {
  const state = verifyOAuthState(input.state)
  const clientId = calendarClientId()
  const clientSecret = calendarClientSecret()
  if (!clientId || !clientSecret) {
    throw new GoogleOAuthError("Google Calendar OAuth is not configured", "not_configured")
  }

  const token = await exchangeGoogleCode({
    code: input.code,
    redirectUri: calendarRedirectUri(input.origin ?? null),
    clientId,
    clientSecret,
  })
  if (!token.refresh_token) {
    throw new GoogleOAuthError("Google did not return a refresh token. Reconnect Calendar and approve offline access.")
  }

  const accountEmail = await fetchGoogleAccountEmail(token.access_token)
  assertExpectedCalendarAccount(accountEmail)
  const calendar = await fetchPrimaryCalendar(token.access_token)
  const calendarId = "primary"
  const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null

  const { db } = await import("@life-os/db")
  const connection = await db.calendarConnection.upsert({
    where: { workspaceId_provider_calendarId: { workspaceId: state.workspaceId, provider: "google", calendarId } },
    update: {
      userId: state.userId,
      status: "active",
      accountEmail,
      calendarSummary: calendar.summary ?? accountEmail,
      accessTokenEncrypted: encryptNullable(token.access_token),
      refreshTokenEncrypted: encryptNullable(token.refresh_token),
      expiresAt,
      scope: token.scope ?? CALENDAR_SCOPE,
      lastError: null,
    },
    create: {
      workspaceId: state.workspaceId,
      userId: state.userId,
      provider: "google",
      status: "active",
      accountEmail,
      calendarId,
      calendarSummary: calendar.summary ?? accountEmail,
      accessTokenEncrypted: encryptNullable(token.access_token),
      refreshTokenEncrypted: encryptNullable(token.refresh_token),
      expiresAt,
      scope: token.scope ?? CALENDAR_SCOPE,
    },
  })

  await db.calendarConnection.updateMany({
    where: { workspaceId: state.workspaceId, provider: "google", id: { not: connection.id } },
    data: {
      userId: state.userId,
      accountEmail,
      accessTokenEncrypted: encryptNullable(token.access_token),
      refreshTokenEncrypted: encryptNullable(token.refresh_token),
      expiresAt,
      scope: token.scope ?? CALENDAR_SCOPE,
      lastError: null,
    },
  })
  await syncCalendarConnectionMirrors(state.workspaceId)

  return { returnTo: state.returnTo, connectionId: connection.id, accountEmail }
}
