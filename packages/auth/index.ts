import NextAuth, { type NextAuthConfig } from "next-auth"
import Google from "next-auth/providers/google"
import { db } from "@life-os/db"

export const LIFE_OS_ROOT_DOMAIN = "lacollecteur.com"
export const LIFE_OS_COOKIE_DOMAIN = `.${LIFE_OS_ROOT_DOMAIN}`

export const LIFE_OS_APP_URLS = {
  home: `https://home.${LIFE_OS_ROOT_DOMAIN}`,
  persons: `https://people.${LIFE_OS_ROOT_DOMAIN}`,
  places: `https://places.${LIFE_OS_ROOT_DOMAIN}`,
  stuff: `https://stuff.${LIFE_OS_ROOT_DOMAIN}`,
  context: `https://context.${LIFE_OS_ROOT_DOMAIN}`,
  assistant: `https://assistant.${LIFE_OS_ROOT_DOMAIN}`,
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
    },
  } satisfies NextAuthConfig)
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
