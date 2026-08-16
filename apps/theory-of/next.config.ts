import type { NextConfig } from "next"
import path from "path"

function personsOrigin() {
  const configured = process.env.NEXT_PUBLIC_PERSONS_URL?.trim()
  if (configured) return configured.replace(/\/$/, "")
  if (process.env.NODE_ENV === "production") return "https://persons.lacollecteur.com"
  return "http://localhost:3000"
}

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  async redirects() {
    const persons = personsOrigin()
    return [
      { source: "/", destination: `${persons}/persons`, permanent: false },
      { source: "/login", destination: `${persons}/login`, permanent: false },
      { source: "/person/:id", destination: `${persons}/persons/:id/theory`, permanent: false },
      { source: "/notes", destination: `${persons}/persons/notes`, permanent: false },
      { source: "/notes/:path*", destination: `${persons}/persons/notes`, permanent: false },
    ]
  },
}

export default nextConfig
