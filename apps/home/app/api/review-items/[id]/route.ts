import { NextRequest, NextResponse } from 'next/server'
import { forward, reviewApiTarget } from '../route'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const target = reviewApiTarget(`/v1/review-items/${encodeURIComponent(id)}`)
  if (!target) {
    return NextResponse.json(
      { error: 'The shared review service is not configured yet.', code: 'review_not_configured' },
      { status: 503 },
    )
  }

  return forward(target, { method: 'POST', body: await request.text() })
}
