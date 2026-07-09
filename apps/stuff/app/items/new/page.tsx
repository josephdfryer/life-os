'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

export default function NewItemPage() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [lifetimeWarranty, setLifetimeWarranty] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const formData = new FormData(e.currentTarget)
    const body: Record<string, unknown> = {}
    for (const [key, val] of formData.entries()) {
      if (val !== '') body[key] = val
    }
    body.lifetimeWarranty = lifetimeWarranty
    if (body.quantity != null) body.quantity = Number(body.quantity)
    if (body.purchasePrice != null) body.purchasePrice = Number(body.purchasePrice)

    startTransition(async () => {
      const res = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const text = await res.text()
        setError(text || 'Failed to create item')
        return
      }
      const created = await res.json()
      router.push(`/items/${created.id}`)
    })
  }

  const labelStyle: React.CSSProperties = { fontSize: '11px', color: 'var(--ink-3)', display: 'block', marginBottom: '4px' }
  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    padding: '8px 12px',
    fontSize: '13px',
    color: 'var(--ink)',
    fontFamily: 'inherit',
    outline: 'none',
  }
  const fieldStyle: React.CSSProperties = { marginBottom: '16px' }
  const sectionStyle: React.CSSProperties = { marginBottom: '32px' }
  const sectionHeadStyle: React.CSSProperties = {
    fontFamily: 'var(--font-body)',
    fontSize: '10px',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--ink-4)',
    marginBottom: '16px',
    paddingBottom: '8px',
    borderBottom: '1px solid var(--border)',
  }

  return (
    <div style={{ maxWidth: '680px', margin: '0 auto', padding: '40px 24px' }}>
      <div style={{ marginBottom: '32px' }}>
        <a href="/items" style={{ fontSize: '12px', color: 'var(--ink-3)', textDecoration: 'none' }}>← Items</a>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 600, margin: '12px 0 0', letterSpacing: '-0.02em' }}>
          Add item
        </h1>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Identity */}
        <div style={sectionStyle}>
          <div style={sectionHeadStyle}>Identity</div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Name *</label>
            <input name="name" required style={inputStyle} placeholder="Leica M11" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Category</label>
              <input name="category" style={inputStyle} placeholder="Camera" />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Quantity</label>
              <input name="quantity" type="number" min="0" step="any" defaultValue="1" style={inputStyle} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Make</label>
              <input name="make" style={inputStyle} placeholder="Leica" />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Model</label>
              <input name="model" style={inputStyle} placeholder="M11" />
            </div>
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Serial number</label>
            <input name="serialNumber" style={inputStyle} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Description</label>
            <textarea name="description" rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Notes</label>
            <textarea name="notes" rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
          </div>
        </div>

        {/* Acquisition */}
        <div style={sectionStyle}>
          <div style={sectionHeadStyle}>Acquisition</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Purchase date</label>
              <input name="purchaseDate" type="date" style={inputStyle} />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Purchase price</label>
              <input name="purchasePrice" type="number" min="0" step="0.01" style={inputStyle} placeholder="0.00" />
            </div>
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Purchased from</label>
            <input name="purchaseFrom" style={inputStyle} placeholder="B&amp;H Photo" />
          </div>
        </div>

        {/* Warranty */}
        <div style={sectionStyle}>
          <div style={sectionHeadStyle}>Warranty</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Warranty expires</label>
              <input name="warrantyExpires" type="date" style={inputStyle} />
            </div>
            <div style={{ ...fieldStyle, display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '20px' }}>
              <input
                type="checkbox"
                id="lifetimeWarranty"
                checked={lifetimeWarranty}
                onChange={e => setLifetimeWarranty(e.target.checked)}
                style={{ width: '14px', height: '14px', accentColor: 'var(--accent)' }}
              />
              <label htmlFor="lifetimeWarranty" style={{ ...labelStyle, marginBottom: 0 }}>Lifetime warranty</label>
            </div>
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Warranty details</label>
            <textarea name="warrantyDetails" rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
          </div>
        </div>

        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px', padding: '12px 16px', fontSize: '12px', color: '#dc2626', marginBottom: '16px' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            type="submit"
            disabled={isPending}
            style={{
              background: isPending ? 'var(--ink-4)' : 'var(--accent)',
              color: '#fff',
              borderRadius: '8px',
              padding: '10px 24px',
              fontSize: '13px',
              fontWeight: 500,
              border: 'none',
              cursor: isPending ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {isPending ? 'Creating…' : 'Create item'}
          </button>
          <a
            href="/items"
            style={{ padding: '10px 24px', fontSize: '13px', color: 'var(--ink-3)', textDecoration: 'none', borderRadius: '8px', border: '1px solid var(--border)' }}
          >
            Cancel
          </a>
        </div>
      </form>
    </div>
  )
}
