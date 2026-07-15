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
    'purchaseFrom', 'warrantyDetails',
  ]
  for (const key of stringFields) {
    if (key in body) updates[key] = body[key]
  }

  // placeId/ownedById are foreign keys into other tenants' data if left
  // unchecked — verify the referenced Place/Person actually belongs to this
  // workspace before allowing the link.
  if ('placeId' in body) {
    const placeId = body.placeId
    if (placeId == null || placeId === '') {
      updates.placeId = null
    } else {
      const place = await db.place.findFirst({ where: { id: placeId as string, workspaceId }, select: { id: true } })
      if (!place) return NextResponse.json({ error: 'Place not found' }, { status: 400 })
      updates.placeId = place.id
    }
  }
  if ('ownedById' in body) {
    const ownedById = body.ownedById
    if (ownedById == null || ownedById === '') {
      updates.ownedById = null
    } else {
      const person = await db.person.findFirst({ where: { id: ownedById as string, workspaceId }, select: { id: true } })
      if (!person) return NextResponse.json({ error: 'Person not found' }, { status: 400 })
      updates.ownedById = person.id
    }
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

  // updateMany (not update) so the workspace filter guards the write itself.
  await db.item.updateMany({ where: { id, workspaceId }, data: updates })
  const item = await db.item.findUniqueOrThrow({ where: { id } })
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

  await db.item.deleteMany({ where: { id, workspaceId } })
  return new NextResponse(null, { status: 204 })
}
