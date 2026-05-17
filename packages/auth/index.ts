import NextAuth, { type NextAuthConfig } from "next-auth"
import Google from "next-auth/providers/google"
import { db } from "@life-os/db"

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

function normalizeEmail(value: string | null | undefined) {
  const email = value?.trim().toLowerCase()
  return email || null
}

function sharedAuthCookies(): NextAuthConfig["cookies"] | undefined {
  const domain = process.env.AUTH_COOKIE_DOMAIN ?? process.env.LIFE_OS_COOKIE_DOMAIN
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

function authSecret() {
  return (
    process.env.AUTH_SECRET
    ?? process.env.NEXTAUTH_SECRET
    ?? (process.env.NODE_ENV === "production" ? undefined : "life-os-local-dev-secret")
  )
}
