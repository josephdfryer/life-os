import { NextRequest, NextResponse } from "next/server"
import { CONNECTIONS_PROXY_CONFIG, proxyToLifeOsApi } from "@/lib/life-os-api-proxy"

type Params = { params: Promise<{ path: string[] }> }

export const maxDuration = 300

export async function GET(request: NextRequest, { params }: Params) {
  const pathname = (await params).path.join("/")
  if (!isAllowedConnectionRead(pathname)) {
    return NextResponse.json({ error: { code: "not_found", message: "Connections endpoint not found." } }, { status: 404 })
  }

  const target = pathname === "list" ? "/v1/connections" : `/v1/connections/${pathname}`
  return proxyToLifeOsApi(request, target, { config: CONNECTIONS_PROXY_CONFIG })
}

export async function POST(request: NextRequest, { params }: Params) {
  return mutate(request, params, "POST")
}

export async function DELETE(request: NextRequest, { params }: Params) {
  return mutate(request, params, "DELETE")
}

async function mutate(request: NextRequest, paramsPromise: Params["params"], method: "POST" | "DELETE") {
  const pathname = (await paramsPromise).path.join("/")
  if (!isAllowedConnectionMutation(method, pathname)) {
    return NextResponse.json({ error: { code: "not_found", message: "Connections endpoint not found." } }, { status: 404 })
  }

  return proxyToLifeOsApi(request, `/v1/connections/${pathname}`, {
    method,
    config: CONNECTIONS_PROXY_CONFIG,
    body: method === "POST" ? await request.text() : undefined,
  })
}

export function isAllowedConnectionRead(pathname: string) {
  return pathname === "list"
    || pathname === "oura/authorize"
    || pathname === "google/gmail/authorize"
    || pathname === "google/calendar/authorize"
}

export function isAllowedConnectionMutation(method: string, pathname: string) {
  return (method === "POST" && (
    pathname === "era"
    || pathname === "granola"
    || pathname === "granola/sync"
    || pathname === "oura/callback"
    || pathname === "oura/sync"
    || pathname === "google/gmail/callback"
    || pathname === "google/calendar/callback"
  ))
    || (method === "DELETE" && /^[-\w]+$/.test(pathname))
}
