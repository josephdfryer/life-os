import { NextRequest } from 'next/server'

import { forward, reviewApiTarget } from '../../review-items/route'

/** Proxy for the shared visit-group resolver, same key and target as the review queue. */
export async function POST(request: NextRequest) {
  const target = reviewApiTarget('/v1/staged-visits/resolve')
  if (!target) {
    return Response.json({ error: 'The shared review service is not configured yet.', code: 'review_not_configured' }, { status: 503 })
  }
  return forward(target, { method: 'POST', body: await request.text() })
}
