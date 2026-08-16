export function personsOrigin() {
  const configured = process.env.NEXT_PUBLIC_PERSONS_URL?.trim()
  if (configured) return configured.replace(/\/$/, "")
  if (process.env.NODE_ENV === "production") return "https://persons.lacollecteur.com"
  return "http://localhost:3000"
}

export function personsUrl(path: string) {
  return `${personsOrigin()}${path.startsWith("/") ? path : `/${path}`}`
}
