import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { centsToDollars, dollarsToCents } from '@life-os/db'
import { requireStuffAccess } from '@/lib/access'

export async function GET(req: NextRequest) {
  const access = await requireStuffAccess()
  if (!access) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = access.workspaceId

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search')
  const take = Math.min(Number(searchParams.get('take') ?? 50), 100)

  const items = await db.item.findMany({
    where: {
      workspaceId,
      ...(search ? { name: { contains: search } } : {}),
    },
    include: {
      place: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take,
  })

  return NextResponse.json(items.map(item => ({ ...item, purchasePrice: centsToDollars(item.purchasePrice) })))
}

export async function POST(req: NextRequest) {
  const access = await requireStuffAccess()
  if (!access) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = access.workspaceId

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const {
    name, category, make, model, serialNumber, quantity, description, notes,
    purchaseDate, purchasePrice, purchaseFrom, warrantyExpires, lifetimeWarranty, warrantyDetails,
    tags, color, colorSoft,
  } = body as Record<string, unknown>

  if (!name || typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  // Auto-generate assetId: #CAT-NNN
  const catStr = typeof category === 'string' && category.trim()
    ? category.trim().slice(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X')
    : 'ITM'
  const count = await db.item.count({ where: { workspaceId } })
  const assetId = `#${catStr}-${String(count + 1).padStart(3, '0')}`

  const item = await db.item.create({
    data: {
      workspaceId,
      name: (name as string).trim(),
      assetId,
      ...(category ? { category: category as string } : {}),
      ...(make ? { make: make as string } : {}),
      ...(model ? { model: model as string } : {}),
      ...(serialNumber ? { serialNumber: serialNumber as string } : {}),
      quantity: quantity != null ? Number(quantity) : 1,
      ...(description ? { description: description as string } : {}),
      ...(notes ? { notes: notes as string } : {}),
      ...(tags ? { tags: tags as string } : {}),
      ...(color ? { color: color as string } : {}),
      ...(colorSoft ? { colorSoft: colorSoft as string } : {}),
      ...(purchaseDate ? { purchaseDate: new Date(purchaseDate as string) } : {}),
      ...(purchasePrice != null && purchasePrice !== '' ? { purchasePrice: dollarsToCents(purchasePrice) } : {}),
      ...(purchaseFrom ? { purchaseFrom: purchaseFrom as string } : {}),
      ...(warrantyExpires ? { warrantyExpires: new Date(warrantyExpires as string) } : {}),
      lifetimeWarranty: Boolean(lifetimeWarranty),
      ...(warrantyDetails ? { warrantyDetails: warrantyDetails as string } : {}),
    },
  })

  return NextResponse.json({ ...item, purchasePrice: centsToDollars(item.purchasePrice) }, { status: 201 })
}
