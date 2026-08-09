import { NextRequest, NextResponse } from "next/server"

type Params = { params: Promise<{ path: string[] }> }
type Method = "POST" | "PATCH"

export async function POST(request: NextRequest, context: Params) {
  return proxyAccess(request, context, "POST")
}

export async function PATCH(request: NextRequest, context: Params) {
  return proxyAccess(request, context, "PATCH")
}

async function proxyAccess(request: NextRequest, { params }: Params, method: Method) {
  const baseUrl = process.env.LIFE_OS_API_URL?.trim()
  const apiKey = process.env.PERSONS_API_KEY?.trim()
  if (!baseUrl || !apiKey) return error("admin_not_configured", "The shared access service is not configured yet.", 503)

  const pathname = (await params).path.join("/")
  if (!isAllowed(method, pathname)) return error("not_found", "Admin endpoint not found.", 404)

  const target = new URL(`/v1/access/${pathname}`, baseUrl)
  try {
    const response = await fetch(target, {
      method,
      body: await request.text(),
      headers: { accept: "application/json", "content-type": "application/json", "x-api-key": apiKey },
      cache: "no-store",
    })
    if (response.status === 204) return new NextResponse(null, { status: 204 })
    return NextResponse.json(await response.json(), { status: response.status })
  } catch {
    return error("admin_unavailable", "The shared access service is temporarily unavailable.", 502)
  }
}

export function isAllowed(method: Method, pathname: string) {
  if (method === "POST") return pathname === "api-keys" || pathname === "roles" || pathname === "approved-emails"
  return /^api-keys\/[^/]+$/.test(pathname)
    || /^roles\/[^/]+$/.test(pathname)
    || /^users\/[^/]+\/roles$/.test(pathname)
    || /^approved-emails\/[^/]+$/.test(pathname)
}

function error(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status })
}
