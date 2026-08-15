import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { db, Prisma } from "@life-os/db"

const ACCESS_TTL_MS = 15 * 60 * 1000
const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000
const AUTHORIZATION_TTL_MS = 10 * 60 * 1000
export const DEVICE_SCOPES = [
  "device.ingest",
  "device.heartbeat",
  "device.self",
  "workout.read",
  "workout.write",
  "people.read",
] as const

export type DeviceAuthResult = {
  deviceId: string
  workspaceId: string
  scopes: string[]
}

export type DeviceTokenPair = {
  tokenType: "Bearer"
  accessToken: string
  accessTokenExpiresAt: string
  refreshToken: string
  refreshTokenExpiresAt: string
  deviceId: string
  workspaceId: string
  scopes: string[]
}

export class DeviceAuthError extends Error {
  constructor(public readonly code: "invalid_grant" | "unauthorized" | "revoked" | "validation", message: string) {
    super(message)
    this.name = "DeviceAuthError"
  }
}

export async function createDeviceAuthorization(input: {
  workspaceId: string
  userId: string
  platform: "macos" | "ios"
  displayName: string
  appVersion: string
  redirectUri: string
  codeChallenge: string
}) {
  assertRedirectUri(input.redirectUri)
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(input.codeChallenge)) {
    throw new DeviceAuthError("validation", "A valid PKCE S256 code challenge is required")
  }

  const code = opaqueToken("dc_code")
  const expiresAt = new Date(Date.now() + AUTHORIZATION_TTL_MS)
  const device = await db.device.create({
    data: {
      workspaceId: input.workspaceId,
      platform: input.platform,
      displayName: input.displayName.trim().slice(0, 200),
      appVersion: input.appVersion.trim().slice(0, 64),
      authorizations: {
        create: {
          workspaceId: input.workspaceId,
          userId: input.userId,
          codeHash: hashToken(code),
          codeChallenge: input.codeChallenge,
          redirectUri: input.redirectUri,
          expiresAt,
        },
      },
    },
    select: { id: true },
  })
  return { code, deviceId: device.id, expiresAt }
}

export async function exchangeDeviceAuthorization(input: { code: string; codeVerifier: string; deviceId: string }): Promise<DeviceTokenPair> {
  const codeHash = hashToken(input.code)
  const authorization = await db.deviceAuthorization.findUnique({
    where: { codeHash },
    include: { device: true },
  })
  if (!authorization || authorization.deviceId !== input.deviceId || authorization.consumedAt || authorization.expiresAt <= new Date()) {
    throw new DeviceAuthError("invalid_grant", "Authorization code is invalid or expired")
  }
  if (authorization.device.revokedAt) throw new DeviceAuthError("revoked", "Device has been revoked")
  if (!safeEqual(pkceChallenge(input.codeVerifier), authorization.codeChallenge)) {
    throw new DeviceAuthError("invalid_grant", "PKCE verification failed")
  }

  const tokens = createTokenPair(authorization.deviceId, authorization.workspaceId)
  const consumed = await db.$transaction(async tx => {
    const result = await tx.deviceAuthorization.updateMany({
      where: { id: authorization.id, consumedAt: null },
      data: { consumedAt: new Date() },
    })
    if (result.count !== 1) return false
    await tx.deviceCredential.create({ data: tokens.credential })
    await tx.device.update({ where: { id: authorization.deviceId }, data: { lastSeenAt: new Date() } })
    return true
  })
  if (!consumed) throw new DeviceAuthError("invalid_grant", "Authorization code was already used")
  return tokens.response
}

export async function refreshDeviceCredential(refreshToken: string): Promise<DeviceTokenPair> {
  const credential = await db.deviceCredential.findUnique({
    where: { refreshTokenHash: hashToken(refreshToken) },
    include: { device: true },
  })
  if (!credential || credential.revokedAt || credential.refreshExpiresAt <= new Date()) {
    throw new DeviceAuthError("unauthorized", "Refresh credential is invalid or expired")
  }
  if (credential.device.revokedAt) throw new DeviceAuthError("revoked", "Device has been revoked")

  const tokens = createTokenPair(credential.deviceId, credential.device.workspaceId)
  const rotated = await db.$transaction(async tx => {
    const result = await tx.deviceCredential.updateMany({
      where: { id: credential.id, refreshTokenHash: credential.refreshTokenHash, revokedAt: null },
      data: { revokedAt: new Date(), lastUsedAt: new Date() },
    })
    if (result.count !== 1) return false
    await tx.deviceCredential.create({ data: tokens.credential })
    await tx.device.update({ where: { id: credential.deviceId }, data: { lastSeenAt: new Date() } })
    return true
  })
  if (!rotated) throw new DeviceAuthError("unauthorized", "Refresh credential was already rotated")
  return tokens.response
}

export async function authorizeDeviceToken(token: string | null | undefined, requiredScope?: string): Promise<DeviceAuthResult | null> {
  if (!token) return null
  const credential = await db.deviceCredential.findUnique({
    where: { accessTokenHash: hashToken(token) },
    include: { device: true },
  })
  if (!credential || credential.revokedAt || credential.accessExpiresAt <= new Date() || credential.device.revokedAt) return null
  const scopes = parseScopes(credential.scopes)
  if (requiredScope && !scopes.includes(requiredScope)) return null
  const now = new Date()
  await Promise.all([
    db.deviceCredential.update({ where: { id: credential.id }, data: { lastUsedAt: now } }),
    db.device.update({ where: { id: credential.deviceId }, data: { lastSeenAt: now } }),
  ])
  return { deviceId: credential.deviceId, workspaceId: credential.device.workspaceId, scopes }
}

export async function revokeDevice(deviceId: string, workspaceId: string) {
  const result = await db.device.updateMany({
    where: { id: deviceId, workspaceId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  if (result.count === 0) throw new DeviceAuthError("validation", "Device was not found or is already revoked")
  await db.deviceCredential.updateMany({ where: { deviceId, revokedAt: null }, data: { revokedAt: new Date() } })
}

export function extractBearerToken(headers: { get(name: string): string | null }) {
  return headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null
}

export function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url")
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

function createTokenPair(deviceId: string, workspaceId: string) {
  const accessToken = opaqueToken("dc_at")
  const refreshToken = opaqueToken("dc_rt")
  const accessExpiresAt = new Date(Date.now() + ACCESS_TTL_MS)
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_MS)
  const scopes = [...DEVICE_SCOPES]
  return {
    credential: {
      deviceId,
      accessTokenHash: hashToken(accessToken),
      refreshTokenHash: hashToken(refreshToken),
      accessExpiresAt,
      refreshExpiresAt,
      scopes: JSON.stringify(scopes),
    } satisfies Prisma.DeviceCredentialUncheckedCreateInput,
    response: {
      tokenType: "Bearer" as const,
      accessToken,
      accessTokenExpiresAt: accessExpiresAt.toISOString(),
      refreshToken,
      refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
      deviceId,
      workspaceId,
      scopes,
    },
  }
}

function opaqueToken(prefix: string) {
  return `${prefix}_${randomBytes(32).toString("base64url")}`
}

function parseScopes(value: string) {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((scope): scope is string => typeof scope === "string") : []
  } catch {
    return []
  }
}

function assertRedirectUri(value: string) {
  let url: URL
  try { url = new URL(value) } catch { throw new DeviceAuthError("validation", "Redirect URI is invalid") }
  if (url.protocol !== "lifeos-companion:" || url.hostname !== "auth" || url.pathname !== "/callback") {
    throw new DeviceAuthError("validation", "Redirect URI is not registered for Life OS Companion")
  }
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}
