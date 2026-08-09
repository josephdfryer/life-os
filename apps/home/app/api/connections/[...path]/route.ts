import { NextRequest, NextResponse } from "next/server"

type Params = { params: Promise<{ path: string[] }> }

export async function GET(request: NextRequest, { params }: Params) {
  const baseUrl = process.env.LIFE_OS_API_URL?.trim()
  const apiKey = process.env.PERSONS_API_KEY?.trim()
  if (!baseUrl || !apiKey) return error("connections_not_configured", "The shared connections service is not configured yet.", 503)

  const pathname = (await params).path.join("/")
  if (pathname !== "list") return error("not_found", "Connections endpoint not found.", 404)

  try {
    const response = await fetch(new URL("/v1/connections", baseUrl), {
      headers: { accept: "application/json", "x-api-key": apiKey },
      cache: "no-store",
    })
    return NextResponse.json(await response.json(), { status: response.status })
  } catch {
    return error("connections_unavailable", "The shared connections service is temporarily unavailable.", 502)
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  return mutate(request, params, "POST")
}

export async function DELETE(request: NextRequest, { params }: Params) {
  return mutate(request, params, "DELETE")
}

async function mutate(request: NextRequest, paramsPromise: Params["params"], method: "POST" | "DELETE") {
  const baseUrl = process.env.LIFE_OS_API_URL?.trim()
  const apiKey = process.env.PERSONS_API_KEY?.trim()
  if (!baseUrl || !apiKey) return error("connections_not_configured", "The shared connections service is not configured yet.", 503)

  const pathname = (await paramsPromise).path.join("/")
  const allowed = isAllowedConnectionMutation(method, pathname)
  if (!allowed) return error("not_found", "Connections endpoint not found.", 404)

  try {
    const body = method === "POST" ? await request.text() : undefined
    const response = await fetch(new URL(`/v1/connections/${pathname}`, baseUrl), {
      method,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body,
      cache: "no-store",
    })
    return NextResponse.json(await response.json(), { status: response.status })
  } catch {
    return error("connections_unavailable", "The shared connections service is temporarily unavailable.", 502)
  }
}

export function isAllowedConnectionMutation(method: string, pathname: string) {
  return (method === "POST" && pathname === "era") || (method === "DELETE" && /^[-\w]+$/.test(pathname))
}

function error(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status })
}
