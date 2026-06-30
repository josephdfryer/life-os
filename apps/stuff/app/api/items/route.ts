import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/db'

async function getWorkspaceId(email: string): Promise<string> {
  const member = await db.workspaceMember.findFirst({
    where: { user: { email }, status: 'active' },
    select: { workspaceId: true },
  })
  return member?.workspaceId ?? 'default-workspace'
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = await getWorkspaceId(session.user.email)

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

  return NextResponse.json(items)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = await getWorkspaceId(session.user.email)

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
      ...(purchasePrice != null && purchasePrice !== '' ? { purchasePrice: Number(purchasePrice) } : {}),
      ...(purchaseFrom ? { purchaseFrom: purchaseFrom as string } : {}),
      ...(warrantyExpires ? { warrantyExpires: new Date(warrantyExpires as string) } : {}),
      lifetimeWarranty: Boolean(lifetimeWarranty),
      ...(warrantyDetails ? { warrantyDetails: warrantyDetails as string } : {}),
    },
  })

  return NextResponse.json(item, { status: 201 })
}
