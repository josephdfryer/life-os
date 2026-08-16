import { LIFE_OS_ROOT_DOMAIN } from "@life-os/auth"

// The apex domain (and its www alias) is the public marketing site —
// distinct from home.lacollecteur.com, the private authenticated dashboard.
// Pure string check (no next/headers) so it's safe to call from middleware too.
export function isMarketingHost(host: string | null | undefined): boolean {
  const bareHost = (host ?? "").split(":")[0]
  return bareHost === LIFE_OS_ROOT_DOMAIN || bareHost === `www.${LIFE_OS_ROOT_DOMAIN}`
}
