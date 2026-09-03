import { createHmac, randomBytes } from "node:crypto"

export type OAuthState = {
  workspaceId: string
  userId: string
  nonce: string
  returnTo: string
}

export class GoogleOAuthError extends Error {
  constructor(message: string, readonly code: string = "oauth_error") {
    super(message)
    this.name = "GoogleOAuthError"
  }
}

export function stateSecret() {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "dev-google-oauth-state-secret"
}

export function signOAuthState(state: OAuthState) {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url")
  const signature = createHmac("sha256", stateSecret()).update(payload).digest("base64url")
  return `${payload}.${signature}`
}

export function verifyOAuthState(value: string) {
  const [payload, signature] = value.split(".")
  if (!payload || !signature) throw new GoogleOAuthError("Invalid OAuth state")
  const expected = createHmac("sha256", stateSecret()).update(payload).digest("base64url")
  if (signature !== expected) throw new GoogleOAuthError("Invalid OAuth state signature", "forbidden")
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState
}

export function newOAuthState(workspaceId: string, userId: string, returnTo: string): OAuthState {
  return { workspaceId, userId, nonce: randomBytes(12).toString("hex"), returnTo }
}

export function resolveOAuthBaseUrl(origin: string | null) {
  return process.env.AUTH_URL
    || process.env.NEXTAUTH_URL
    || process.env.VERCEL_PROJECT_PRODUCTION_URL?.replace(/^/, "https://")
    || origin
    || null
}

export async function exchangeGoogleCode(input: {
  code: string
  redirectUri: string
  clientId: string
  clientSecret: string
}) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  })
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new GoogleOAuthError(`Google token exchange failed (${response.status}): ${body}`)
  }
  return await response.json() as {
    access_token: string
    expires_in?: number
    refresh_token?: string
    scope?: string
    token_type?: string
  }
}

export async function resolveConnectionUserId(workspaceId: string) {
  const { db } = await import("@life-os/db")
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      ownerUserId: true,
      members: {
        where: { status: "active" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { userId: true },
      },
    },
  })
  return workspace?.ownerUserId ?? workspace?.members[0]?.userId ?? null
}
