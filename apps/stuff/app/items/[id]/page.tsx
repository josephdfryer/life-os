import { notFound, redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { resolveTimeZone, TZ_COOKIE } from '@life-os/ui'
import { db } from '@/lib/db'
import { requireStuffAccess } from '@/lib/access'
import { getEffectiveLocation, listInventoryPlaces } from '@/lib/inventory'
import MoveItem from './move-item'
import StockControl from './stock-control'

export const dynamic = 'force-dynamic'

function formatDate(d: Date | null | undefined, timeZone?: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { timeZone, year: 'numeric', month: 'short', day: 'numeric' })
}

function formatPrice(cents: number | null | undefined) {
  if (cents == null) return '—'
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const access = await requireStuffAccess()
  if (!access) redirect('/login')
  const workspaceId = access.workspaceId
  const tz = resolveTimeZone((await cookies()).get(TZ_COOKIE)?.value)
  const { id } = await params

  const [item, places, definitions] = await Promise.all([
    db.item.findFirst({
      where: { id, workspaceId },
      include: {
      place: { select: { name: true } },
      ownedBy: { select: { first: true, last: true } },
      assembledInto: {
        where: { disassembledAt: null },
        include: { parentItem: { select: { id: true, name: true, assetId: true } } },
      },
      components: {
        where: { disassembledAt: null },
        include: { childItem: { select: { id: true, name: true, assetId: true } } },
      },
      itemInteractions: {
        include: {
          interaction: {
            select: {
              id: true,
              type: true,
              timestamp: true,
              summary: true,
              place: { select: { name: true } },
              person: { select: { first: true, last: true } },
            },
          },
        },
      },
      definition: {
        select: { id: true, name: true, sku: true, unit: true, trackingMode: true },
      },
      lot: {
        select: { id: true, lotCode: true, expiresAt: true },
      },
      },
    }),
    listInventoryPlaces(db, workspaceId),
    db.itemDefinition.findMany({
      where: { workspaceId, active: true },
      select: {
        id: true,
        name: true,
        sku: true,
        unit: true,
        trackingMode: true,
        lots: {
          select: { id: true, lotCode: true, expiresAt: true },
          orderBy: { lotCode: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    }),
  ])

  if (!item) notFound()
  const effectiveLocation = await getEffectiveLocation(db, workspaceId, item.id)

  // Sort in JS — safe for libSQL
  const interactions = item.itemInteractions
    .map(ii => ii.interaction)
    .filter(Boolean)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 20)

  const row: React.CSSProperties = {
    display: 'flex',
    gap: '32px',
    padding: '10px 0',
    borderBottom: '1px solid var(--border)',
  }
  const keyStyle: React.CSSProperties = {
    fontSize: '11px',
    color: 'var(--ink-4)',
    width: '140px',
    flexShrink: 0,
    paddingTop: '1px',
  }
  const valStyle: React.CSSProperties = { fontSize: '13px', color: 'var(--ink)', flex: 1 }
  const sectionLabel: React.CSSProperties = {
    fontFamily: 'var(--font-body)',
    fontSize: '10px',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--ink-4)',
    marginBottom: '12px',
  }

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '40px 24px' }}>
      <div style={{ marginBottom: '32px' }}>
        <a href="/items" style={{ fontSize: '12px', color: 'var(--ink-3)', textDecoration: 'none' }}>← Items</a>
      </div>

      {/* Header */}
      <div style={{ marginBottom: '40px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <span style={{
            fontFamily: 'var(--font-body)',
            fontSize: '11px',
            color: 'var(--ink-4)',
            background: 'var(--surface2)',
            padding: '3px 10px',
            borderRadius: '6px',
          }}>
            {item.assetId}
          </span>
          {item.color && (
            <span style={{
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              background: item.colorSoft ?? item.color,
              border: `2px solid ${item.color}`,
              flexShrink: 0,
            }} />
          )}
        </div>
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: '28px',
          fontWeight: 600,
          margin: '0 0 4px',
          letterSpacing: '-0.02em',
        }}>
          {item.name}
        </h1>
        {item.category && <div style={{ fontSize: '13px', color: 'var(--ink-3)' }}>{item.category}</div>}
      </div>

      {/* Details */}
      <div style={{ marginBottom: '48px' }}>
        <div style={sectionLabel}>Details</div>
        {(item.make || item.model) && (
          <div style={row}><span style={keyStyle}>Make / model</span><span style={valStyle}>{[item.make, item.model].filter(Boolean).join(' ')}</span></div>
        )}
        {item.serialNumber && (
          <div style={row}><span style={keyStyle}>Serial number</span><span style={{ ...valStyle, fontFamily: 'var(--font-body)', fontSize: '12px' }}>{item.serialNumber}</span></div>
        )}
        {item.quantity !== 1 && (
          <div style={row}><span style={keyStyle}>Quantity</span><span style={valStyle}>{item.quantity}</span></div>
        )}
        {item.description && (
          <div style={row}><span style={keyStyle}>Description</span><span style={valStyle}>{item.description}</span></div>
        )}
        {item.notes && (
          <div style={row}><span style={keyStyle}>Notes</span><span style={{ ...valStyle, whiteSpace: 'pre-wrap' }}>{item.notes}</span></div>
        )}
        {item.tags && (
          <div style={row}><span style={keyStyle}>Tags</span><span style={valStyle}>{item.tags}</span></div>
        )}
        {effectiveLocation.place && (
          <div style={row}>
            <span style={keyStyle}>Location</span>
            <span style={valStyle}>
              {effectiveLocation.place.name}
              {effectiveLocation.inheritedThrough.length > 0 ? ` · inherited through ${effectiveLocation.inheritedThrough.map(parent => parent.name).join(' → ')}` : ''}
            </span>
          </div>
        )}
        {item.ownedBy && (
          <div style={row}><span style={keyStyle}>Owned by</span><span style={valStyle}>{item.ownedBy.first} {item.ownedBy.last ?? ''}</span></div>
        )}
      </div>

      <div style={{ marginBottom: '48px' }}>
        <div style={sectionLabel}>Inventory</div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
          <a href={`/inventory/labels?kind=item&id=${item.id}`} style={{ color: 'var(--cognac)', fontSize: '12px', textDecoration: 'none' }}>
            Print QR label
          </a>
          <span style={{ color: 'var(--ink-4)' }}>·</span>
          <a href="/inventory" style={{ color: 'var(--cognac)', fontSize: '12px', textDecoration: 'none' }}>
            Open inventory
          </a>
        </div>
        <MoveItem
          itemId={item.id}
          currentPlaceId={item.placeId}
          places={places}
          disabledReason={item.assembledInto.length > 0
            ? `This item inherits its location from ${item.assembledInto[0].parentItem.name}. Move the containing item instead.`
            : undefined}
        />
      </div>

      <div style={{ marginBottom: '48px' }}>
        <div style={sectionLabel}>Stock</div>
        <StockControl
          itemId={item.id}
          quantity={item.quantity}
          definitionId={item.definitionId}
          lotId={item.lotId}
          serialNumber={item.serialNumber}
          definitions={definitions}
        />
      </div>

      {/* Acquisition */}
      {(item.purchaseDate || item.purchasePrice != null || item.purchaseFrom) && (
        <div style={{ marginBottom: '48px' }}>
          <div style={sectionLabel}>Acquisition</div>
          {item.purchaseDate && <div style={row}><span style={keyStyle}>Purchased</span><span style={valStyle}>{formatDate(item.purchaseDate, tz)}</span></div>}
          {item.purchasePrice != null && <div style={row}><span style={keyStyle}>Price</span><span style={valStyle}>{formatPrice(item.purchasePrice)}</span></div>}
          {item.purchaseFrom && <div style={row}><span style={keyStyle}>From</span><span style={valStyle}>{item.purchaseFrom}</span></div>}
        </div>
      )}

      {/* Warranty */}
      {(item.warrantyExpires || item.lifetimeWarranty || item.warrantyDetails) && (
        <div style={{ marginBottom: '48px' }}>
          <div style={sectionLabel}>Warranty</div>
          {item.lifetimeWarranty && <div style={row}><span style={keyStyle}>Lifetime</span><span style={valStyle}>Yes</span></div>}
          {item.warrantyExpires && <div style={row}><span style={keyStyle}>Expires</span><span style={valStyle}>{formatDate(item.warrantyExpires, tz)}</span></div>}
          {item.warrantyDetails && <div style={row}><span style={keyStyle}>Details</span><span style={valStyle}>{item.warrantyDetails}</span></div>}
        </div>
      )}

      {/* Assembly */}
      {(item.assembledInto.length > 0 || item.components.length > 0) && (
        <div style={{ marginBottom: '48px' }}>
          <div style={sectionLabel}>Assembly</div>
          {item.assembledInto.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: 'var(--ink-3)', marginBottom: '8px' }}>Inside</div>
              {item.assembledInto.map(a => (
                <a
                  key={a.id}
                  href={`/items/${a.parentItem.id}`}
                  style={{
                    display: 'flex',
                    gap: '12px',
                    alignItems: 'center',
                    padding: '10px 14px',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    textDecoration: 'none',
                    color: 'inherit',
                    marginBottom: '6px',
                  }}
                >
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '10px', color: 'var(--ink-4)' }}>
                    {a.parentItem.assetId}
                  </span>
                  <span style={{ fontSize: '13px' }}>{a.parentItem.name}</span>
                </a>
              ))}
            </div>
          )}
          {item.components.length > 0 && (
            <div>
              <div style={{ fontSize: '11px', color: 'var(--ink-3)', marginBottom: '8px' }}>
                Components ({item.components.length})
              </div>
              {item.components.map(a => (
                <a
                  key={a.id}
                  href={`/items/${a.childItem.id}`}
                  style={{
                    display: 'flex',
                    gap: '12px',
                    alignItems: 'center',
                    padding: '10px 14px',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    textDecoration: 'none',
                    color: 'inherit',
                    marginBottom: '6px',
                  }}
                >
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '10px', color: 'var(--ink-4)' }}>
                    {a.childItem.assetId}
                  </span>
                  <span style={{ fontSize: '13px' }}>{a.childItem.name}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Interaction history */}
      {interactions.length > 0 && (
        <div>
          <div style={sectionLabel}>History</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {interactions.map(interaction => (
              <div
                key={interaction.id}
                style={{
                  padding: '12px 16px',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: '10px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--ink-3)' }}>
                    {interaction.type === 'item_moved'
                      ? `Movement${interaction.place ? ` · ${interaction.place.name}` : ''}`
                      : interaction.type === 'inventory_verified'
                        ? `Verification${interaction.place ? ` · ${interaction.place.name}` : ''}`
                        : interaction.person
                      ? `${interaction.person.first} ${interaction.person.last ?? ''}`.trim()
                      : interaction.type}
                  </span>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: '11px', color: 'var(--ink-4)' }}>
                    {formatDate(interaction.timestamp, tz)}
                  </span>
                </div>
                {interaction.summary && (
                  <div style={{ fontSize: '13px', color: 'var(--ink)' }}>{interaction.summary}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
