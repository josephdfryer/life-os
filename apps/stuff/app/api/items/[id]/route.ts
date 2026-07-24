import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { centsToDollars, dollarsToCents } from '@life-os/db'
import { requireStuffAccess } from '@/lib/access'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await requireStuffAccess()
  if (!access) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = access.workspaceId
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

  // Location changes are commands, not generic field edits: they must update
  // Item.placeId and append an item_moved Interaction atomically.
  if ('placeId' in body) {
    return NextResponse.json(
      { error: 'Use POST /api/inventory/move to change an item location' },
      { status: 409 },
    )
  }
  // ownedById is a foreign key into other tenants' data if left unchecked.
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
  if ('quantity' in body) {
    return NextResponse.json(
      { error: 'Use the inventory stock adjustment command to change quantity' },
      { status: 409 },
    )
  }
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
  const access = await requireStuffAccess()
  if (!access) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = access.workspaceId
  const { id } = await params

  const existing = await db.item.findFirst({ where: { id, workspaceId } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await db.item.deleteMany({ where: { id, workspaceId } })
  return new NextResponse(null, { status: 204 })
}
