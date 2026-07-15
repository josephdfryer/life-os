import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { centsToDollars, dollarsToCents } from '@life-os/db'

async function getWorkspaceId(email: string): Promise<string> {
  const member = await db.workspaceMember.findFirst({
    where: { user: { email }, status: 'active' },
    select: { workspaceId: true },
  })
  return member?.workspaceId ?? 'default-workspace'
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = await getWorkspaceId(session.user.email)
  const { id } = await params

  const existing = await db.item.findFirst({ where: { id, workspaceId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  const stringFields = [
    'name', 'category', 'make', 'model', 'serialNumber',
    'description', 'notes', 'tags', 'color', 'colorSoft',
    'purchaseFrom', 'warrantyDetails', 'placeId', 'ownedById',
  ]
  for (const key of stringFields) {
    if (key in body) updates[key] = body[key]
  }
  if ('lifetimeWarranty' in body) updates.lifetimeWarranty = Boolean(body.lifetimeWarranty)
  if ('quantity' in body) updates.quantity = Number(body.quantity)
  if ('purchasePrice' in body) {
    updates.purchasePrice = body.purchasePrice != null && body.purchasePrice !== ''
      ? dollarsToCents(body.purchasePrice)
      : null
  }
  if ('purchaseDate' in body) {
    updates.purchaseDate = body.purchaseDate ? new Date(body.purchaseDate as string) : null
  }
  if ('warrantyExpires' in body) {
    updates.warrantyExpires = body.warrantyExpires ? new Date(body.warrantyExpires as string) : null
  }

  const item = await db.item.update({ where: { id }, data: updates })
  return NextResponse.json({ ...item, purchasePrice: centsToDollars(item.purchasePrice) })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = await getWorkspaceId(session.user.email)
  const { id } = await params

  const existing = await db.item.findFirst({ where: { id, workspaceId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await db.item.delete({ where: { id } })
  return new NextResponse(null, { status: 204 })
}
