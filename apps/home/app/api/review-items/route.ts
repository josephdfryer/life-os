import { NextRequest, NextResponse } from 'next/server'

const FORWARDED_PARAMS = ['cursor', 'limit', 'status', 'source', 'itemType', 'riskTier']

export async function GET(request: NextRequest) {
  const target = reviewApiTarget('/v1/review-items')
  if (!target) return unavailable()

  for (const name of FORWARDED_PARAMS) {
    const value = request.nextUrl.searchParams.get(name)
    if (value !== null) target.searchParams.set(name, value)
  }

  return forward(target, { method: 'GET' })
}

export function reviewApiTarget(pathname: string) {
  const baseUrl = process.env.LIFE_OS_API_URL?.trim()
  const apiKey = process.env.PERSONS_API_KEY?.trim()
  if (!baseUrl || !apiKey) return null
  return new URL(pathname, baseUrl)
}

export async function forward(target: URL, init: RequestInit) {
  const apiKey = process.env.PERSONS_API_KEY?.trim()
  if (!apiKey) return unavailable()

  try {
    const response = await fetch(target, {
      ...init,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-api-key': apiKey,
        ...init.headers,
      },
      cache: 'no-store',
    })
    const body = await response.json()
    return NextResponse.json(body, { status: response.status })
  } catch {
    return NextResponse.json(
      { error: 'The shared review service is temporarily unavailable.', code: 'review_unavailable' },
      { status: 502 },
    )
  }
}

function unavailable() {
  return NextResponse.json(
    { error: 'The shared review service is not configured yet.', code: 'review_not_configured' },
    { status: 503 },
  )
}
