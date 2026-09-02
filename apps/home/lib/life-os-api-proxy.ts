import { NextRequest, NextResponse } from "next/server"
import { workspaceForHomeRequest } from "@/lib/request-access"

export type ProxyMethod = "GET" | "POST" | "PATCH" | "DELETE"

export type ProxyServiceConfig = {
  notConfiguredCode: string
  notConfiguredMessage: string
  unavailableCode: string
  unavailableMessage: string
}

type ProxyContext =
  | { ok: true; baseUrl: string; apiKey: string; workspaceId: string }
  | { ok: false; response: NextResponse }

export function proxyError(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status })
}

export async function resolveProxyContext(config: ProxyServiceConfig): Promise<ProxyContext> {
  const baseUrl = process.env.LIFE_OS_API_URL?.trim()
  const apiKey = process.env.PERSONS_API_KEY?.trim()
  if (!baseUrl || !apiKey) {
    return {
      ok: false,
      response: proxyError(config.notConfiguredCode, config.notConfiguredMessage, 503),
    }
  }

  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) {
    return { ok: false, response: proxyError("unauthorized", "Sign in required.", 401) }
  }

  return { ok: true, baseUrl, apiKey, workspaceId }
}

export async function proxyToLifeOsApi(
  request: NextRequest,
  apiPath: string,
  options: {
    method?: ProxyMethod
    config: ProxyServiceConfig
    body?: string
    search?: string
    cache?: RequestCache
    next?: { revalidate?: number }
  },
): Promise<NextResponse> {
  const context = await resolveProxyContext(options.config)
  if (!context.ok) return context.response

  const method = options.method ?? "GET"
  const target = new URL(apiPath, context.baseUrl)
  target.search = options.search ?? request.nextUrl.search

  try {
    const response = await fetch(target, {
      method,
      body: options.body,
      headers: {
        accept: "application/json",
        ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
        "x-api-key": context.apiKey,
        "x-workspace-override": context.workspaceId,
      },
      cache: options.cache ?? "no-store",
      ...(options.next ? { next: options.next } : {}),
    })
    if (response.status === 204) return new NextResponse(null, { status: 204 })
    return NextResponse.json(await response.json(), { status: response.status })
  } catch {
    return proxyError(options.config.unavailableCode, options.config.unavailableMessage, 502)
  }
}

export const ADMIN_PROXY_CONFIG: ProxyServiceConfig = {
  notConfiguredCode: "admin_not_configured",
  notConfiguredMessage: "The shared access service is not configured yet.",
  unavailableCode: "admin_unavailable",
  unavailableMessage: "The shared access service is temporarily unavailable.",
}

export const CONNECTIONS_PROXY_CONFIG: ProxyServiceConfig = {
  notConfiguredCode: "connections_not_configured",
  notConfiguredMessage: "The shared connections service is not configured yet.",
  unavailableCode: "connections_unavailable",
  unavailableMessage: "The shared connections service is temporarily unavailable.",
}

export const AUTOMATION_PROXY_CONFIG: ProxyServiceConfig = {
  notConfiguredCode: "automation_not_configured",
  notConfiguredMessage: "The shared automation service is not configured yet.",
  unavailableCode: "automation_unavailable",
  unavailableMessage: "The shared automation service is temporarily unavailable.",
}

export const INTELLIGENCE_PROXY_CONFIG: ProxyServiceConfig = {
  notConfiguredCode: "intelligence_not_configured",
  notConfiguredMessage: "The shared intelligence service is not configured yet.",
  unavailableCode: "intelligence_unavailable",
  unavailableMessage: "The shared intelligence service is temporarily unavailable.",
}
