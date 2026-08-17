import { NextRequest, NextResponse } from 'next/server'
import { LIFE_OS_APP_URLS, lifeOsAppUrl } from '@life-os/auth'
import { workspaceForHomeRequest } from '@/lib/request-access'

const FORWARDED_PARAMS = [
  'cursor', 'limit', 'type', 'since', 'until', 'personId', 'actorPersonId',
  'groupId', 'placeId', 'eventId', 'category', 'direction', 'source', 'q',
  'minAmount', 'maxAmount', 'include', 'withTotal',
]

export async function GET(request: NextRequest) {
  const apiKey = process.env.PERSONS_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'The Home stream is not configured yet.', code: 'stream_not_configured' },
      { status: 503 },
    )
  }

  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) {
    return NextResponse.json({ error: 'Sign in required.', code: 'unauthorized' }, { status: 401 })
  }

  const canonicalApiUrl = process.env.LIFE_OS_API_URL?.trim()
  const fallbackPersonsUrl = process.env.PERSONS_URL ?? lifeOsAppUrl('persons', 'http://localhost:3000') ?? LIFE_OS_APP_URLS.persons
  const target = new URL(canonicalApiUrl ? '/v1/stream' : '/api/v1/interactions', canonicalApiUrl || fallbackPersonsUrl)
  for (const name of FORWARDED_PARAMS) {
    const value = request.nextUrl.searchParams.get(name)
    if (value !== null) target.searchParams.set(name, value)
  }

  try {
    const response = await fetch(target, {
      headers: { 'x-api-key': apiKey, 'x-workspace-override': workspaceId },
      next: { revalidate: 15 },
    })
    const body = await response.json()
    return NextResponse.json(body, { status: response.status })
  } catch {
    return NextResponse.json(
      { error: 'The interaction stream is temporarily unavailable.', code: 'stream_unavailable' },
      { status: 502 },
    )
  }
}
