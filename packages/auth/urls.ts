import { LIFE_OS_APP_URLS, LIFE_OS_ROOT_DOMAIN, type LifeOSAppKey } from "@life-os/ui/app-registry"

export { LIFE_OS_APP_URLS, LIFE_OS_ROOT_DOMAIN }
export type LifeOsApp = LifeOSAppKey

export function lifeOsAppUrl(app: LifeOsApp, localFallback: string) {
  const configured = appUrlFromEnv(app)
  if (configured) return configured
  if (process.env.NODE_ENV === "production") return LIFE_OS_APP_URLS[app]
  return localFallback
}

function appUrlFromEnv(app: LifeOsApp) {
  const envName = `NEXT_PUBLIC_${app.toUpperCase()}_URL`
  const value = process.env[envName]
  const configured = value?.trim()
  if (configured) return configured

  return null
}

