# lacollecteur.com unified auth runbook

Status: implementation plan
Domain: `lacollecteur.com`

## Decision

Use shared-cookie auth across subdomains of `lacollecteur.com`.

This is the smallest correct path because every browser request to a LifeOS app can live under one parent domain. The existing Auth.js wrapper in `packages/auth/index.ts` already supports shared cookies through `AUTH_COOKIE_DOMAIN` / `LIFE_OS_COOKIE_DOMAIN`.

Do not switch to database-backed Auth.js sessions for this phase. That path is still valid if apps must live on unrelated domains, but it is unnecessary once all apps use `*.lacollecteur.com`.

## App domains

| App | Vercel project | Custom domain |
| --- | --- | --- |
| Home launcher | `life-os-home` | `home.lacollecteur.com` |
| Persons | `persons` | `persons.lacollecteur.com` |
| Places | `life-os-places` | `places.lacollecteur.com` |
| Stuff | `life-os-stuff` | `stuff.lacollecteur.com` |
| Events | `life-os-events` | `events.lacollecteur.com` |
| Assistant | `life-os-assistant` | `assistant.lacollecteur.com` |

Theory of Person lives in Persons; `apps/theory-of` no longer exists. `context.lacollecteur.com` is not routed anywhere.

## Current setup status

Completed in Vercel:

- `home.lacollecteur.com` added to `life-os-home`
- `persons.lacollecteur.com` added to `persons`
- `places.lacollecteur.com` added to `life-os-places`
- `stuff.lacollecteur.com` added to `life-os-stuff`
- `assistant.lacollecteur.com` added to `life-os-assistant`
- shared production `AUTH_SECRET` / `NEXTAUTH_SECRET` set on Home, People, Places, and Stuff
- production `AUTH_COOKIE_DOMAIN` / `LIFE_OS_COOKIE_DOMAIN` set to `.lacollecteur.com` on Home, People, Places, and Stuff
- canonical production `AUTH_URL` / `NEXTAUTH_URL` set on Home, People, Places, and Stuff
- Home production launcher URLs set to the `lacollecteur.com` app domains

Still required:

- add the DNS A records below in Squarespace / Google Domains
- add the Google OAuth callback URLs below
- redeploy apps after DNS and OAuth are ready

## Required DNS records

Create these records wherever `lacollecteur.com` DNS is managed. At the time this runbook was written, public nameservers were Google/Squarespace Domains:

```text
ns-cloud-e1.googledomains.com
ns-cloud-e2.googledomains.com
ns-cloud-e3.googledomains.com
ns-cloud-e4.googledomains.com
```

After adding each custom domain in Vercel, use Vercel's exact DNS recommendation. Because the domain is currently keeping Google/Squarespace nameservers, Vercel recommended A records:

```text
home       A  76.76.21.21
people     A  76.76.21.21
places     A  76.76.21.21
stuff      A  76.76.21.21
events     A  76.76.21.21
assistant  A  76.76.21.21
context    A  76.76.21.21
```

Do not point the apex `lacollecteur.com` at an app unless you intentionally want the bare domain to resolve. The SSO design only requires subdomains.

## Required Vercel environment variables

Set these on every web app project that uses Auth.js:

```text
AUTH_COOKIE_DOMAIN=.lacollecteur.com
LIFE_OS_COOKIE_DOMAIN=.lacollecteur.com
AUTH_SECRET=<same strong secret on every app>
NEXTAUTH_SECRET=<same value as AUTH_SECRET>
```

The shared cookie only works if all apps use the same session cookie domain and can decrypt/verify the same JWT session token with the same `AUTH_SECRET`.

Set app URLs for the Home launcher. The code now defaults to these values in production, but setting them explicitly in Vercel keeps the deployed environment self-documenting:

```text
NEXT_PUBLIC_PERSONS_URL=https://persons.lacollecteur.com
NEXT_PUBLIC_PLACES_URL=https://places.lacollecteur.com
NEXT_PUBLIC_STUFF_URL=https://stuff.lacollecteur.com
```

For app-specific OAuth helpers in Persons, set the app's own canonical URL:

```text
AUTH_URL=https://persons.lacollecteur.com
NEXTAUTH_URL=https://persons.lacollecteur.com
```

For other apps, `trustHost: true` should infer the host from the request. Setting `AUTH_URL` / `NEXTAUTH_URL` per app is still acceptable if a helper needs absolute URLs.

## Google OAuth callback URLs

Add these authorized redirect URIs to the Google OAuth client used by LifeOS:

```text
https://home.lacollecteur.com/api/auth/callback/google
https://persons.lacollecteur.com/api/auth/callback/google
https://places.lacollecteur.com/api/auth/callback/google
https://stuff.lacollecteur.com/api/auth/callback/google
```

The assistant webhook app does not need a Google callback unless it grows a browser login surface.

## Vercel CLI shape

Link each project explicitly before running project-scoped commands:

```bash
vercel link --yes --scope jdf247-3720s-projects --project life-os-home
vercel domains add home.lacollecteur.com
vercel domains inspect home.lacollecteur.com
```

Repeat for:

```text
persons.lacollecteur.com     persons
places.lacollecteur.com      life-os-places
stuff.lacollecteur.com       life-os-stuff
assistant.lacollecteur.com   life-os-assistant
```

The root `.vercel/project.json` is currently linked to `persons`. This repo has historically swapped `.vercel/project.json` between app projects for deploys, so verify the linked project before any Vercel command that mutates domains or env vars.

## Validation

1. Verify DNS:

   ```bash
   dig +short A home.lacollecteur.com
   dig +short A persons.lacollecteur.com
   dig +short A places.lacollecteur.com
   dig +short A stuff.lacollecteur.com
   ```

2. Verify Vercel domain status:

   ```bash
   vercel domains inspect home.lacollecteur.com
   ```

3. Sign in through one app, preferably `https://home.lacollecteur.com`.

4. In browser devtools, confirm an `authjs.session-token` cookie exists for `.lacollecteur.com`.

5. Open another app, for example `https://persons.lacollecteur.com`, and confirm it renders without another login.

6. Sign out and verify other apps require login after reload.

## Rollback

Remove `AUTH_COOKIE_DOMAIN` / `LIFE_OS_COOKIE_DOMAIN` from the Vercel projects and redeploy. Apps will fall back to host-only cookies. Users may need to sign in again.
