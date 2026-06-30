import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

async function getWorkspaceId(email: string): Promise<string> {
  const member = await db.workspaceMember.findFirst({
    where: { user: { email }, status: 'active' },
    select: { workspaceId: true },
  })
  return member?.workspaceId ?? 'default-workspace'
}

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>
}) {
  const session = await auth()
  if (!session?.user?.email) redirect('/login')
  const workspaceId = await getWorkspaceId(session.user.email)
  const { search } = await searchParams

  const items = await db.item.findMany({
    where: {
      workspaceId,
      ...(search ? { name: { contains: search } } : {}),
    },
    include: {
      place: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '40px 24px' }}>
      <style>{`.item-card:hover { border-color: var(--accent) !important; }`}</style>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '32px', gap: '16px', flexWrap: 'wrap' }}>
        <h1 style={{ fontFamily: 'var(--font-playfair)', fontSize: '28px', fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
          Everything
        </h1>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <form method="get" action="/items">
            <input
              name="search"
              defaultValue={search}
              placeholder="Search…"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '12px',
                color: 'var(--ink)',
                outline: 'none',
                width: '180px',
              }}
            />
          </form>
          <a
            href="/items/new"
            style={{
              background: 'var(--accent)',
              color: '#fff',
              borderRadius: '8px',
              padding: '6px 16px',
              fontSize: '12px',
              fontWeight: 500,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            + New item
          </a>
        </div>
      </div>

      {items.length === 0 ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '64px 32px', textAlign: 'center' }}>
          <div style={{ fontSize: '13px', color: 'var(--ink-3)', marginBottom: '6px' }}>
            {search ? `No items matching "${search}"` : 'Nothing here yet.'}
          </div>
          {!search && (
            <div style={{ fontSize: '12px', color: 'var(--ink-4)' }}>
              <a href="/items/new" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Add your first item</a> to start cataloguing what you own.
            </div>
          )}
        </div>
      ) : (
        <>
          <div style={{ fontSize: '11px', color: 'var(--ink-4)', marginBottom: '16px' }}>
            {items.length} item{items.length !== 1 ? 's' : ''}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
            {items.map(item => (
              <a
                key={item.id}
                href={`/items/${item.id}`}
                className="item-card"
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  padding: '16px 18px',
                  textDecoration: 'none',
                  color: 'inherit',
                  display: 'block',
                  transition: 'border-color 0.1s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
                  <span style={{
                    fontFamily: 'var(--font-dm-mono)',
                    fontSize: '10px',
                    color: 'var(--ink-4)',
                    background: 'var(--surface2)',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    flexShrink: 0,
                  }}>
                    {item.assetId}
                  </span>
                  {item.color && (
                    <span style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      background: item.colorSoft ?? item.color,
                      border: `2px solid ${item.color}`,
                      flexShrink: 0,
                      marginTop: '2px',
                    }} />
                  )}
                </div>
                <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '4px' }}>{item.name}</div>
                {item.category && (
                  <div style={{ fontSize: '11px', color: 'var(--ink-3)', marginBottom: '4px' }}>{item.category}</div>
                )}
                {(item.make || item.model) && (
                  <div style={{ fontSize: '11px', color: 'var(--ink-4)' }}>
                    {[item.make, item.model].filter(Boolean).join(' ')}
                  </div>
                )}
                {item.place && (
                  <div style={{ fontSize: '11px', color: 'var(--ink-4)', marginTop: '8px' }}>
                    📍 {item.place.name}
                  </div>
                )}
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
