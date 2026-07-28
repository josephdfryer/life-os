import NextAuth, { type NextAuthConfig } from "next-auth"
import Google from "next-auth/providers/google"
import { db } from "@life-os/db"

export const LIFE_OS_ROOT_DOMAIN = "lacollecteur.com"
export const LIFE_OS_COOKIE_DOMAIN = `.${LIFE_OS_ROOT_DOMAIN}`

export const LIFE_OS_APP_URLS = {
  home: `https://home.${LIFE_OS_ROOT_DOMAIN}`,
  persons: `https://persons.${LIFE_OS_ROOT_DOMAIN}`,
  places: `https://places.${LIFE_OS_ROOT_DOMAIN}`,
  stuff: `https://stuff.${LIFE_OS_ROOT_DOMAIN}`,
  events: `https://events.${LIFE_OS_ROOT_DOMAIN}`,
  context: `https://context.${LIFE_OS_ROOT_DOMAIN}`,
  assistant: `https://assistant.${LIFE_OS_ROOT_DOMAIN}`,
  levelUp: `https://level-up.${LIFE_OS_ROOT_DOMAIN}`,
} as const

export type LifeOsApp = keyof typeof LIFE_OS_APP_URLS

type CreateLifeOsAuthOptions = {
  signInPath?: string
}

export function createLifeOsAuth(options: CreateLifeOsAuthOptions = {}) {
  return NextAuth({
    trustHost: true,
    providers: [
      Google({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      }),
    ],
    secret: authSecret(),
    pages: {
      signIn: options.signInPath ?? "/login",
    },
    cookies: sharedAuthCookies(),
    callbacks: {
      async signIn({ user }) {
        return isEmailAllowedToSignIn(user.email)
      },
      authorized({ auth: session }) {
        return !!session?.user
      },
      // After sign-in, NextAuth only allows same-origin redirects by default.
      // Life OS is one identity spread across *.lacollecteur.com subdomains,
      // so a user who started on persons.* and logged in via home.* must be
      // sent back to persons.*. Allow any Life OS host; reject everything else.
      async redirect({ url, baseUrl }) {
        if (url.startsWith("/")) return `${baseUrl}${url}`
        try {
          const target = new URL(url)
          if (target.origin === new URL(baseUrl).origin) return url
          if (isLifeOsHost(target.hostname)) return url
        } catch {
          // fall through to safe default
        }
        return baseUrl
      },
    },
  } satisfies NextAuthConfig)
}

function isLifeOsHost(hostname: string) {
  return hostname === LIFE_OS_ROOT_DOMAIN || hostname.endsWith(`.${LIFE_OS_ROOT_DOMAIN}`)
}

// The one place login actually happens. Returns the Home app's URL, or null
// when running locally without a configured Home (callers then fall back to a
// local flow instead of redirecting into a nonexistent hub).
export function lifeOsHomeUrl(): string | null {
  const configured = process.env.NEXT_PUBLIC_HOME_URL?.trim()
  if (configured) return configured
  if (process.env.NODE_ENV === "production") return LIFE_OS_APP_URLS.home
  return null
}

// Builds the Home login URL that a satellite app sends unauthenticated users
// to. `callbackUrl` should already be absolute (pointing back at the satellite)
// so Home can return the user to where they were headed. Returns null when
// there is no distinct Home to forward to (local dev) or when forwarding would
// loop back onto the caller's own origin.
export function homeLoginUrl(callbackUrl: string): string | null {
  const base = lifeOsHomeUrl()
  if (!base) return null
  const login = new URL("/login", base)
  login.searchParams.set("callbackUrl", callbackUrl)
  try {
    const cb = new URL(callbackUrl)
    if (cb.origin === new URL(base).origin) return null
  } catch {
    // non-absolute callbackUrl is fine; no loop risk against Home
  }
  return login.toString()
}

// Resolves a satellite's raw callbackUrl (which may be relative) to an absolute
// URL on that satellite's own origin, then returns the Home login URL to send
// the user to. `origin` is the satellite's public origin (from request headers).
export function homeLoginRedirect(callbackUrl: string | undefined, origin: string): string | null {
  const raw = callbackUrl && callbackUrl.length > 0 ? callbackUrl : "/"
  let absolute = raw
  try {
    new URL(raw)
  } catch {
    absolute = origin ? new URL(raw, origin).toString() : raw
  }
  return homeLoginUrl(absolute)
}

export async function isEmailAllowedToSignIn(emailRaw: string | null | undefined) {
  const email = normalizeEmail(emailRaw)
  if (!email) return false
  if (envApprovedEmails().includes(email)) return true

  try {
    const existingUsers = await db.user.count()
    if (existingUsers === 0) return true

    const approved = await db.approvedEmail.findUnique({
      where: { email },
      select: { status: true },
    })
    return approved?.status === "approved"
  } catch {
    return false
  }
}

export function envApprovedEmails() {
  return [
    process.env.ALLOWED_EMAILS,
    process.env.OWNER_EMAILS,
    process.env.ADMIN_EMAILS,
  ]
    .filter(Boolean)
    .flatMap(value => value!.split(","))
    .map(normalizeEmail)
    .filter((value): value is string => Boolean(value))
}

export function lifeOsAppUrl(app: LifeOsApp, localFallback: string) {
  const configured = appUrlFromEnv(app)
  if (configured) return configured
  if (process.env.NODE_ENV === "production") return LIFE_OS_APP_URLS[app]
  return localFallback
}

function normalizeEmail(value: string | null | undefined) {
  const email = value?.trim().toLowerCase()
  return email || null
}

function sharedAuthCookies(): NextAuthConfig["cookies"] | undefined {
  const domain = sharedAuthCookieDomain()
  if (!domain) return undefined

  const secure = isSecureAuthContext()
  const prefix = secure ? "__Secure-" : ""

  return {
    sessionToken: {
      name: `${prefix}authjs.session-token`,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure,
        domain,
      },
    },
  }
}

function isSecureAuthContext() {
  return (
    process.env.NODE_ENV === "production"
    || process.env.AUTH_URL?.startsWith("https://") === true
    || process.env.NEXTAUTH_URL?.startsWith("https://") === true
  )
}

function appUrlFromEnv(app: LifeOsApp) {
  const envName = `NEXT_PUBLIC_${app.toUpperCase()}_URL`
  const value = process.env[envName]
  const configured = value?.trim()
  if (configured) return configured

  if (app === "context") {
    return process.env.NEXT_PUBLIC_THEORY_URL?.trim() || null
  }

  return null
}

function sharedAuthCookieDomain() {
  const configured = process.env.AUTH_COOKIE_DOMAIN ?? process.env.LIFE_OS_COOKIE_DOMAIN
  const domain = configured?.trim()
  if (!domain) return undefined

  if (domain === LIFE_OS_ROOT_DOMAIN) return LIFE_OS_COOKIE_DOMAIN
  return domain
}

function authSecret() {
  return (
    process.env.AUTH_SECRET
    ?? process.env.NEXTAUTH_SECRET
    ?? (process.env.NODE_ENV === "production" ? undefined : "life-os-local-dev-secret")
  )
}
