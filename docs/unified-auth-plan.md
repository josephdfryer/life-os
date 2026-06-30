# Unified Single Sign-On Across Life OS Apps

Status: proposal
Author: research session, 2026-06-30

## Goal

Log in once (in any app), be authenticated in every Life OS app — persons, home, assistant, places, stuff, theory-of — without re-entering credentials.

## Current state

Every app wraps `createLifeOsAuth()` from `packages/auth/index.ts`, which configures NextAuth v5 (`next-auth@5.0.0-beta.30`) with a single Google OAuth provider:

```ts
// packages/auth/index.ts
export function createLifeOsAuth(options: CreateLifeOsAuthOptions = {}) {
  return NextAuth({
    trustHost: true,
    providers: [Google({ clientId: ..., clientSecret: ... })],
    secret: authSecret(),
    pages: { signIn: options.signInPath ?? "/login" },
    cookies: sharedAuthCookies(),
    callbacks: { signIn, authorized },
  })
}
```

Each app's `auth.ts` is a one-liner: `createLifeOsAuth()` with no per-app overrides. There is no `middleware.ts` in any app — auth is enforced per-page, server-side, with `await auth()` followed by `redirect("/login?callbackUrl=...")` (e.g. `apps/persons/app/people/page.tsx:64`).

**Session strategy is JWT, not database-backed.** No NextAuth `adapter` is configured anywhere, and the Prisma schema (`packages/db/prisma/schema.prisma`) has no `Session` or `Account` model — only a standalone `User` model used for the email allow-list/RBAC, unrelated to NextAuth's adapter contract. The session token is a signed/encrypted JWT stored entirely in the cookie; `AUTH_SECRET` is what verifies it.

**Cookie-domain sharing is already half-built.** `sharedAuthCookies()` reads `AUTH_COOKIE_DOMAIN` (or `LIFE_OS_COOKIE_DOMAIN`) and, if set, pins the `authjs.session-token` cookie to that domain:

```ts
function sharedAuthCookies(): NextAuthConfig["cookies"] | undefined {
  const domain = process.env.AUTH_COOKIE_DOMAIN ?? process.env.LIFE_OS_COOKIE_DOMAIN
  if (!domain) return undefined
  const secure = isSecureAuthContext()
  const prefix = secure ? "__Secure-" : ""
  return {
    sessionToken: {
      name: `${prefix}authjs.session-token`,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure, domain },
    },
  }
}
```

This is the entire mechanism — no env var is currently set, so it's inert in production.

**Deployment reality — this is the fact that decides everything below.** Each app is its own Vercel project, deployed by temporarily swapping the root `.vercel/project.json` and `vercel.json` (see `feedback_vercel_deploy` / `project_persons_deploy_setup` / `project_places_deploy_setup` memory). Confirmed production URLs:

| App | Production URL |
|---|---|
| persons | `persons-azure.vercel.app` |
| places | `life-os-places.vercel.app` |
| home | `life-os-home.vercel.app` (inferred from project naming) |
| assistant | `life-os-assistant.vercel.app` (inferred) |
| stuff, theory-of | not yet deployed under a confirmed URL |

No custom domain is configured anywhere in the repo — no `life-os.app` (or similar) string appears in any `vercel.json`, README, or env file. Every app sits on a **different root domain** (`persons-azure.vercel.app` vs `life-os-places.vercel.app` — the root domain is `vercel.app` itself, owned by Vercel, not by this project). A cookie can only be scoped to a domain the setter is itself a subdomain of; you cannot set a cookie on `.vercel.app` (browsers reject cookies scoped to public suffixes), and even if you could, it would leak across every Vercel customer's app.

This single fact rules out Option A today.

The `NEXT_PUBLIC_PERSONS_URL` / `NEXT_PUBLIC_PLACES_URL` / etc. env vars (read in `apps/home/app/page.tsx`) are the only place cross-app URLs are wired up today, and they're just plain links — no auth handoff.

## Option A — Shared cookie domain

**Mechanism:** all apps move to subdomains of one root domain (e.g. `persons.life-os.app`, `places.life-os.app`, `home.life-os.app`), share `AUTH_SECRET`, and set `AUTH_COOKIE_DOMAIN=.life-os.app`. The browser then attaches the same session cookie to every request regardless of which app subdomain it's visiting, and since they all share `AUTH_SECRET`, any app can verify a JWT another app issued.

**Why it's attractive:** it's nearly built. The cookie-domain logic already exists in `packages/auth/index.ts`. No new infrastructure, no new data model, no token-passing flow — the browser does all the work via its native same-site cookie behavior.

**What's actually required:**
1. Acquire a domain (e.g. `life-os.app`) and add it to the Vercel team.
2. Add a custom subdomain to each of the six Vercel projects (`persons.life-os.app`, etc.) via `vercel domains add` / project settings, pointing each at its respective project.
3. Set `AUTH_COOKIE_DOMAIN=.life-os.app` (leading dot — required for subdomain matching) as a Vercel env var on **every** project.
4. Set the **same** `AUTH_SECRET` value on every project. (Today each app likely has its own independently-generated secret, since nothing currently forces them to match.)
5. Set `AUTH_URL` (or rely on `trustHost: true`, already set) per app to its new custom subdomain, so NextAuth's callback URLs and CSRF checks line up.
6. Verify the Google OAuth client's authorized redirect URIs include all six new `/api/auth/callback/google` URLs.
7. **Cookie name consistency check:** `sharedAuthCookies()` only overrides `cookies.sessionToken`. NextAuth v5 also sets `authjs.csrf-token` and `authjs.callback-url` cookies by default, which are *not* domain-scoped by this code today. For the sign-in flow itself (CSRF token, callback URL) that's fine since those are single-app, single-request concerns — but worth confirming during testing that nothing else implicitly depends on host-only cookies. (See "Gaps to close" below — this is the main code gap.)

**Limitation, stated plainly:** none of this works until step 1–2 happen. As long as apps live on `*.vercel.app`, Option A is not a code problem, it's a domain problem the team hasn't solved yet.

**Effort if the domain exists:** small. Mostly env var configuration + DNS, plus the one code gap noted above. No schema changes, no new auth flow.

## Option B — Central auth app + token forwarding

**Mechanism:** designate one app (e.g. persons, or a new dedicated `auth` app) as the SSO authority. Unauthenticated requests to any other app redirect to the authority with a `returnTo` URL; the authority verifies the session, mints a short-lived signed token (e.g. a JWT good for 60 seconds, single-use), and redirects back to `returnTo?token=...`. The receiving app's callback route verifies the token, establishes its own local session (sets its own cookie), and redirects to the original destination.

**Why you'd pick this:** it works regardless of domain — it doesn't depend on shared cookies at all, so it's the only option that works cleanly across entirely separate root domains (`persons-azure.vercel.app` redirecting to `life-os-home.vercel.app` and back).

**What it requires, concretely:**
- A new signing mechanism distinct from the session JWT (short TTL, single-use, ideally bound to the requesting app's origin to prevent token replay against a different app).
- A new route in every app: `/api/sso/callback` (or similar) that accepts `?token=`, verifies it, and calls `signIn` (or directly sets the NextAuth session cookie) for that app's own domain.
- A new route in the authority app: `/api/sso/authorize?returnTo=...&app=...` that checks the authority's own session, mints the token, redirects.
- Redirect-loop and open-redirect protection: `returnTo` must be validated against an allowlist of known app origins (the existing `NEXT_PUBLIC_*_URL` env vars are a natural source for this allowlist).
- Logout fan-out is now a real problem you have to solve separately: signing out of one app does not sign out of the others unless you build a parallel "logout broadcast" (e.g. iframe pings or a backchannel call to each app's logout endpoint).

**Honest assessment:** this is meaningfully more code than Option A or C — a new token format, two new routes per app, origin-allowlisting, and a logout story you don't get for free. It's the right answer if apps must live on unrelated domains permanently. Given Option C is available and cheaper, Option B is not recommended unless Option C's downsides (below) turn out to be unacceptable.

## Option C — Shared database session store

**Mechanism:** switch NextAuth from JWT sessions to database sessions via the official Prisma adapter (`@auth/prisma-adapter`), pointed at the same Turso/libSQL database every app already uses. Add `Session`, `Account`, and `VerificationToken` models (the standard Auth.js schema) alongside the existing `User` model. NextAuth's session cookie then holds only an opaque session ID — verification means a database lookup, not JWT signature checking — so **any app reading from the same database session table sees the same session**, regardless of domain.

**Why this fits this codebase specifically:** the Turso shared database is already the one piece of infrastructure all six apps unconditionally depend on (`@life-os/db` is a workspace package imported everywhere). There's no new infrastructure to provision — just new tables and an adapter wired into the existing `createLifeOsAuth()`. It also doesn't care what domain each app is on, so it works today on `*.vercel.app` with zero DNS/domain work, and continues to work unchanged if a custom domain is added later.

**What changes, concretely:**

1. **Schema** — add to `packages/db/prisma/schema.prisma`. Auth.js's Prisma adapter expects this shape (adapted to fit the existing `User` model rather than replacing it):

```prisma
model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}
```

   And add the back-relations to the existing `User` model (`packages/db/prisma/schema.prisma:158`):
   ```prisma
   accounts User[]  // wrong direction, see note below
   ```
   Concretely: add `accounts Account[]` and `sessions Session[]` to `model User`.

   Auth.js's adapter also expects `User.emailVerified DateTime?` — the existing `User` model doesn't have it; add it as optional so it doesn't conflict with the allow-list logic already in place.

2. **Adapter wiring** — `packages/auth/index.ts`:

```ts
import NextAuth, { type NextAuthConfig } from "next-auth"
import Google from "next-auth/providers/google"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { db } from "@life-os/db"

export function createLifeOsAuth(options: CreateLifeOsAuthOptions = {}) {
  return NextAuth({
    trustHost: true,
    adapter: PrismaAdapter(db),
    session: { strategy: "database" },
    providers: [Google({ clientId: ..., clientSecret: ... })],
    secret: authSecret(),
    pages: { signIn: options.signInPath ?? "/login" },
    cookies: sharedAuthCookies(), // can stay — see below
    callbacks: {
      async signIn({ user }) { return isEmailAllowedToSignIn(user.email) },
      session({ session, user }) {
        // database strategy passes `user`, not `token` — adjust any callback
        // that currently reads from a JWT-shaped `token` argument
        return session
      },
    },
  } satisfies NextAuthConfig)
}
```

   Note the `authorized` callback in the existing config (`auth.ts` line ~27) is part of the deprecated `authjs` middleware-based pattern — confirm whether it's still read anywhere, since no app currently has a `middleware.ts` to invoke it. It's likely dead code today and can be dropped or left as-is; it doesn't interact with the session-strategy change either way.

3. **`sharedAuthCookies()` becomes optional, not required.** With database sessions, the cookie is just an opaque session ID — it no longer needs to be valid on every domain, because every app independently looks the ID up in the same database. Each app can keep its own host-only cookie. You only need `AUTH_COOKIE_DOMAIN` if you also want to skip a redundant `/api/auth/session` round-trip across apps — for a true "click around and you're just logged in" feel with separate domains, you still need a way to *pass* the session cookie (or session ID) across domains once during the first cross-app navigation, since unlike Option A, the browser won't send a persons.vercel.app cookie to home.vercel.app automatically.

   This is the one piece Option C doesn't solve for free if apps stay on separate `*.vercel.app` domains: a database session removes the "must share `AUTH_SECRET`-signed JWT" requirement, but it does **not** remove the "browser must send a cookie to the right domain" requirement. So Option C needs a small piece of Option B's idea — not a full token-exchange system, just a one-time redirect that copies the session ID as a URL param on first cross-app visit, set as that app's own cookie. This is much simpler than full Option B because there's no token to mint/verify — you're just copying an already-valid session ID and letting the new app's database lookup confirm it.

   Concretely: add a tiny `/api/session/adopt?sid=...` route per app that takes a `sid` query param, confirms it resolves to a valid `Session` row in the database, and sets it as that app's own `authjs.session-token` cookie (host-only, no domain override needed). The "home" launcher (`apps/home/app/page.tsx`, which already centralizes links to every other app) is a natural place to append `?sid=<session.id>` to each outbound link.

4. **Migration path for existing sessions:** today's sessions are JWTs with no database row. After deploying the adapter change, all existing JWT cookies become unreadable by the new database-strategy code (no matching `Session` row) — every user will be silently signed out and redirected to `/login` on next page load. This is a one-time, mostly invisible event (re-click "Sign in with Google", which still works) — no manual migration step is needed since there are no rows to migrate, only old cookies to discard. Worth doing during a low-traffic window and giving the (small, allow-listed) user base a heads-up.

5. **New dependency:** `@auth/prisma-adapter`, matching the `next-auth@5.0.0-beta.30` major. Add to `packages/auth/package.json`.

## Recommendation

**Build Option C (shared database session store), with the lightweight session-adoption redirect described above.**

Reasoning, given what's actually true about this deployment:
- All apps are confirmed to be on separate `*.vercel.app` root domains today, with no custom domain in the repo, env files, or Vercel config. Option A cannot work until someone buys and wires up a domain — that's an infrastructure/business decision, not something this plan can schedule.
- All apps already share one database (`@life-os/db` → Turso). Option C uses infrastructure that exists right now.
- Option C's code footprint is smaller than Option B's: no new token-signing scheme, no per-app origin allowlist for token replay, and logout becomes a single `Session` row delete that every app sees immediately (a real win Option B doesn't have — Option B requires a separate logout-fan-out mechanism Option C gets for free, since deleting the DB row invalidates the session everywhere instantly).
- Option C also happens to be forward-compatible with Option A: if a custom domain is set up later, you can layer `AUTH_COOKIE_DOMAIN` back on top (it's still wired into `sharedAuthCookies()`) and delete the `/api/session/adopt` redirect entirely, since the browser will start doing the cookie-sharing for free.

If a custom domain is already planned or trivial to set up (e.g. the team already owns a domain not yet wired to Vercel), say so and Option A becomes the better near-term call — it is structurally simpler once the domain exists. Confirm this before starting Option C's schema migration, since it's the one piece of work Option A doesn't need at all.

## Implementation steps (Option C)

1. **Schema migration** — add `Account`, `Session`, `VerificationToken` models and `User.emailVerified`/`accounts`/`sessions` relations to `packages/db/prisma/schema.prisma`. Run `npx prisma migrate dev` locally, then apply to the production Turso database using the existing manual-migration pattern (`@libsql/client` script — see `project_persons_deploy_setup` memory; this repo doesn't auto-migrate on deploy).
2. **Add `@auth/prisma-adapter`** to `packages/auth/package.json`, run install.
3. **Wire the adapter** into `createLifeOsAuth()` in `packages/auth/index.ts`: add `adapter: PrismaAdapter(db)` and `session: { strategy: "database" }`. Audit the `signIn`/`authorized` callbacks for any place that assumes a JWT `token` argument instead of the database-strategy `user` argument.
4. **Add the session-adoption route** (`app/api/session/adopt/route.ts`) to each app — a small shared helper in `packages/auth` is worth extracting since the logic (look up `sid`, validate, set cookie) is identical across all six apps.
5. **Update the home launcher** (`apps/home/app/page.tsx`) to append `?sid=<session.id>` to its outbound links to persons/places/stuff/theory-of/assistant, so navigating from home (after already being logged in there) adopts the session in the destination app on first click.
6. **New env vars:** none strictly required beyond what exists (`AUTH_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `DATABASE_URL`/`TURSO_*` — already shared). `AUTH_COOKIE_DOMAIN` stays unset unless/until a custom domain exists.
7. **Test plan:**
   - Local: run two apps concurrently on different ports (e.g. persons on 3000, home on 3002, matching `.env.example`'s `NEXT_PUBLIC_*_URL` defaults), sign in on persons, click through to home via a manually-constructed `?sid=` link, confirm home renders as authenticated without hitting `/login`.
   - Verify sign-out: delete the session from one app, confirm a page load in another app now redirects to `/login` (proves the shared-row invalidation works).
   - Verify the allow-list (`isEmailAllowedToSignIn`) still gates new sign-ins correctly post-adapter-change — this logic is unaffected by the session-strategy switch but worth a regression check since it's the security boundary for this whole system.
   - Staging deploy: deploy persons and one other app (e.g. places) with the new schema/adapter, confirm cross-app session adoption over real Vercel URLs (not localhost) before rolling out to all six apps.
   - Confirm OAuth callback URLs in the Google Cloud Console are unaffected (Option C doesn't touch the OAuth redirect flow, only what happens after).
