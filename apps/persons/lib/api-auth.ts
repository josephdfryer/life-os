import { NextRequest, NextResponse } from "next/server"

export function validateApiKey(req: NextRequest): boolean {
  const apiKey = process.env.API_KEY
  if (!apiKey) return false
  const provided =
    req.headers.get("x-api-key") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
  return provided === apiKey
}

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized. Pass your key as X-Api-Key header or Authorization: Bearer <key>." }, { status: 401 })
}
