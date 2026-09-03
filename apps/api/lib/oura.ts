import { createHmac, randomBytes, timingSafeEqual } from "crypto"

export const OURA_AUTHORIZE_URL = "https://cloud.ouraring.com/oauth/authorize"
export const OURA_TOKEN_URL = "https://api.ouraring.com/oauth/token"
export const OURA_API_BASE = "https://api.ouraring.com"
export const OURA_REVOKE_URL = "https://api.ouraring.com/oauth/revoke"
export const OURA_SCOPE = "daily"
export const OURA_BACKFILL_DAYS = 35

export const OURA_DAILY_COLLECTIONS = ["daily_readiness", "daily_sleep", "daily_activity", "daily_stress"] as const
export type OuraDailyCollection = (typeof OURA_DAILY_COLLECTIONS)[number]

export class OuraError extends Error {
  constructor(message: string, readonly code: "not_configured" | "oauth" | "forbidden" | "revoked" | "scope" | "validation") {
    super(message)
    this.name = "OuraError"
  }
}

export type OuraOAuthState = {
  workspaceId: string
  nonce: string
  returnTo: string
}

export type OuraTokenResponse = {
  token_type: string
  access_token: string
  expires_in: number
  refresh_token: string
}

export type OuraDailyDocument = {
  id?: string
  day?: string
  score?: number | null
  timestamp?: string
  contributors?: Record<string, number | null | undefined>
  stress_high?: number | null
  recovery_high?: number | null
  day_summary?: string | null
}

export type OuraCollectionPage = {
  data?: OuraDailyDocument[]
  next_token?: string | null
}

export function ouraClientId() {
  return process.env.OURA_CLIENT_ID?.trim() || null
}

export function ouraClientSecret() {
  return process.env.OURA_CLIENT_SECRET?.trim() || null
}

export function ouraRedirectUri() {
  const explicit = process.env.OURA_REDIRECT_URI?.trim()
  if (explicit) return explicit
  const base = process.env.HOME_URL?.trim() || process.env.AUTH_URL?.trim() || "https://home.lacollecteur.com"
  return `${base.replace(/\/$/, "")}/admin/connections/oura/callback`
}

export function ouraWebhookCallbackUrl() {
  const explicit = process.env.OURA_WEBHOOK_CALLBACK_URL?.trim()
  if (explicit) return explicit
  const base = process.env.LIFE_OS_API_URL?.trim() || "https://api.lacollecteur.com"
  return `${base.replace(/\/$/, "")}/v1/webhooks/oura`
}

export function ouraWebhookVerificationToken() {
  return process.env.OURA_WEBHOOK_VERIFICATION_TOKEN?.trim() || process.env.AUTH_SECRET?.trim() || null
}

export function requireOuraApp() {
  const clientId = ouraClientId()
  const clientSecret = ouraClientSecret()
  if (!clientId || !clientSecret) {
    throw new OuraError("Oura OAuth is not configured. Set OURA_CLIENT_ID and OURA_CLIENT_SECRET.", "not_configured")
  }
  return { clientId, clientSecret }
}

export function signOuraState(state: OuraOAuthState) {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url")
  const signature = createHmac("sha256", stateSecret()).update(payload).digest("base64url")
  return `${payload}.${signature}`
}

export function verifyOuraState(value: string): OuraOAuthState {
  const [payload, signature] = value.split(".")
  if (!payload || !signature) throw new OuraError("Invalid Oura OAuth state", "validation")
  const expected = createHmac("sha256", stateSecret()).update(payload).digest("base64url")
  if (!safeEqual(signature, expected)) throw new OuraError("Invalid Oura OAuth state signature", "forbidden")
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OuraOAuthState
  if (!parsed.workspaceId || !parsed.nonce) throw new OuraError("Invalid Oura OAuth state", "validation")
  return parsed
}

export function createOuraAuthorizeUrl(workspaceId: string, returnTo = "/admin/connections") {
  const { clientId } = requireOuraApp()
  const state = signOuraState({ workspaceId, nonce: randomBytes(16).toString("hex"), returnTo })
  const url = new URL(OURA_AUTHORIZE_URL)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("redirect_uri", ouraRedirectUri())
  url.searchParams.set("scope", OURA_SCOPE)
  url.searchParams.set("state", state)
  return { url: url.toString(), state }
}

export async function exchangeOuraCode(code: string) {
  return requestOuraToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: ouraRedirectUri(),
  })
}

export async function refreshOuraTokens(refreshToken: string) {
  return requestOuraToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  })
}

export async function revokeOuraToken(accessToken: string) {
  const url = new URL(OURA_REVOKE_URL)
  url.searchParams.set("access_token", accessToken)
  const response = await fetch(url, { method: "GET", cache: "no-store" })
  if (!response.ok && response.status !== 404) {
    throw new OuraError(`Oura revoke failed (${response.status})`, "oauth")
  }
}

export async function fetchOuraCollection(
  accessToken: string,
  collection: OuraDailyCollection,
  startDate: string,
  endDate: string,
) {
  const documents: OuraDailyDocument[] = []
  let nextToken: string | null = null
  do {
    const url = new URL(`${OURA_API_BASE}/v2/usercollection/${collection}`)
    url.searchParams.set("start_date", startDate)
    url.searchParams.set("end_date", endDate)
    if (nextToken) url.searchParams.set("next_token", nextToken)
    const page = await ouraJson<OuraCollectionPage>(accessToken, url)
    documents.push(...(page.data ?? []))
    nextToken = page.next_token ?? null
  } while (nextToken)
  return documents
}

export async function fetchOuraDocument(accessToken: string, collection: OuraDailyCollection, objectId: string) {
  const url = new URL(`${OURA_API_BASE}/v2/usercollection/${collection}/${encodeURIComponent(objectId)}`)
  return ouraJson<OuraDailyDocument>(accessToken, url)
}

export function verifyOuraWebhookSignature(signature: string | null, timestamp: string | null, rawBody: string) {
  const secret = ouraClientSecret()
  if (!secret || !signature || !timestamp) return false
  const expected = createHmac("sha256", secret).update(timestamp + rawBody).digest("hex").toUpperCase()
  return safeEqual(signature, expected)
}

export async function listOuraWebhookSubscriptions() {
  const { clientId, clientSecret } = requireOuraApp()
  const response = await fetch(`${OURA_API_BASE}/v2/webhook/subscription`, {
    headers: { "x-client-id": clientId, "x-client-secret": clientSecret, accept: "application/json" },
    cache: "no-store",
  })
  if (!response.ok) throw new OuraError(`Oura webhook list failed (${response.status})`, "oauth")
  return (await response.json()) as Array<{ id: string; callback_url: string; data_type: string; event_type: string }>
}

export async function createOuraWebhookSubscription(dataType: string, eventType: "create" | "update") {
  const { clientId, clientSecret } = requireOuraApp()
  const verificationToken = ouraWebhookVerificationToken()
  if (!verificationToken) throw new OuraError("OURA_WEBHOOK_VERIFICATION_TOKEN is not set", "not_configured")
  const response = await fetch(`${OURA_API_BASE}/v2/webhook/subscription`, {
    method: "POST",
    headers: {
      "x-client-id": clientId,
      "x-client-secret": clientSecret,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      callback_url: ouraWebhookCallbackUrl(),
      verification_token: verificationToken,
      event_type: eventType,
      data_type: dataType,
    }),
    cache: "no-store",
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new OuraError(`Oura webhook subscribe failed (${response.status}) ${detail}`.trim(), "oauth")
  }
  return response.json() as Promise<{ id: string }>
}

export function grantedScopeIncludesDaily(scope: string | null | undefined) {
  const granted = (scope ?? "").split(/[+\s]+/).filter(Boolean)
  return granted.includes("daily")
}

function stateSecret() {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "dev-oura-state-secret"
}

async function requestOuraToken(fields: Record<string, string>) {
  const { clientId, clientSecret } = requireOuraApp()
  const body = new URLSearchParams({ ...fields, client_id: clientId, client_secret: clientSecret })
  const response = await fetch(OURA_TOKEN_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    const code = response.status === 401 ? "revoked" : "oauth"
    throw new OuraError(`Oura token exchange failed (${response.status}) ${detail}`.trim(), code)
  }
  const tokens = (await response.json()) as OuraTokenResponse
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new OuraError("Oura token response was missing access or refresh token", "oauth")
  }
  return tokens
}

async function ouraJson<T>(accessToken: string, url: URL): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  })
  if (response.status === 401) throw new OuraError("Oura access token was rejected", "revoked")
  if (response.status === 403) throw new OuraError(`Oura denied ${url.pathname}`, "forbidden")
  if (!response.ok) throw new OuraError(`Oura request failed (${response.status}) for ${url.pathname}`, "oauth")
  return response.json() as Promise<T>
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}
