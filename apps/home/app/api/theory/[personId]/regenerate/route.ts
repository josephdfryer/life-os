import { NextRequest, NextResponse } from "next/server"

type Params = { params: Promise<{ personId: string }> }

/**
 * Browser-authenticated Home proxy for the canonical, API-key-only command.
 * The browser never receives the control-plane API key.
 */
export async function POST(_request: NextRequest, { params }: Params) {
  const baseUrl = process.env.LIFE_OS_API_URL?.trim()
  const apiKey = process.env.PERSONS_API_KEY?.trim()
  if (!baseUrl || !apiKey) {
    return NextResponse.json(
      { error: { code: "theory_not_configured", message: "The shared intelligence service is not configured yet." } },
      { status: 503 },
    )
  }

  const { personId } = await params
  const target = new URL(`/v1/theory/${encodeURIComponent(personId)}/regenerate`, baseUrl)

  try {
    const response = await fetch(target, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      cache: "no-store",
    })
    const body: unknown = await response.json()
    return NextResponse.json(body, { status: response.status })
  } catch {
    return NextResponse.json(
      { error: { code: "theory_unavailable", message: "The shared intelligence service is temporarily unavailable." } },
      { status: 502 },
    )
  }
}
