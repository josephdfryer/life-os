import { NextRequest, NextResponse } from "next/server"
import { AUTOMATION_PROXY_CONFIG, proxyToLifeOsApi } from "@/lib/life-os-api-proxy"

type Params = { params: Promise<{ path: string[] }> }
type Method = "GET" | "POST" | "PATCH" | "DELETE"

export async function GET(request: NextRequest, context: Params) {
  return proxyAutomation(request, context, "GET")
}

export async function POST(request: NextRequest, context: Params) {
  return proxyAutomation(request, context, "POST")
}

export async function PATCH(request: NextRequest, context: Params) {
  return proxyAutomation(request, context, "PATCH")
}

export async function DELETE(request: NextRequest, context: Params) {
  return proxyAutomation(request, context, "DELETE")
}

async function proxyAutomation(request: NextRequest, { params }: Params, method: Method) {
  const pathname = (await params).path.join("/")
  if (!isAllowed(method, pathname)) {
    return NextResponse.json({ error: { code: "not_found", message: "Automation endpoint not found." } }, { status: 404 })
  }

  const body = method === "GET" || method === "DELETE" ? undefined : await request.text()
  return proxyToLifeOsApi(request, `/v1/automations/${pathname}`, {
    method,
    config: AUTOMATION_PROXY_CONFIG,
    body,
    search: request.nextUrl.search,
  })
}

export function isAllowed(method: Method, pathname: string) {
  if (method === "GET") return pathname === "rules" || pathname === "runs"
  if (method === "POST") return pathname === "rules" || pathname === "runs/apply" || /^rules\/[^/]+\/test$/.test(pathname)
  if (method === "PATCH" || method === "DELETE") return /^rules\/[^/]+$/.test(pathname)
  return false
}
