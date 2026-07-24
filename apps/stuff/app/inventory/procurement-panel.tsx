"use client"

import { useState } from "react"

type Definition = {
  id: string
  name: string
  sku: string | null
  unit: string
  trackingMode: "untracked" | "lot" | "serial"
}
type Lot = { id: string; definitionId: string; lotCode: string }
type Place = { id: string; name: string }
type Supplier = {
  id: string
  name: string
  supplierCode: string | null
  email: string | null
  paymentTerms: string | null
  orderCount: number
}
type OrderLine = {
  id: string
  definitionId: string
  description: string
  sku: string | null
  unit: string
  orderedQuantity: number
  receivedQuantity: number
  unitCost: number | null
  destinationPlaceId: string | null
}
type PurchaseOrder = {
  id: string
  planStatus: string
  supplierName: string
  orderNumber: string
  currency: string
  orderedAt: string | Date
  expectedAt: string | Date | null
  lines: OrderLine[]
  progress: {
    ordered: number
    received: number
    complete: boolean
    status: "ordered" | "partial" | "received"
    totalCost: number
  }
}
export type ProcurementOverview = { suppliers: Supplier[]; orders: PurchaseOrder[] }
type DraftLine = { definitionId: string; quantity: string; unitCost: string; destinationPlaceId: string }

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const data = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new Error(data.error ?? "Purchasing request failed")
  return data as T
}

const emptyLine = (): DraftLine => ({ definitionId: "", quantity: "1", unitCost: "", destinationPlaceId: "" })

export default function ProcurementPanel({
  initialOverview,
  definitions,
  lots,
  places,
  onInventoryChanged,
}: {
  initialOverview: ProcurementOverview
  definitions: Definition[]
  lots: Lot[]
  places: Place[]
  onInventoryChanged: () => Promise<void>
}) {
  const [overview, setOverview] = useState(initialOverview)
  const [draftLines, setDraftLines] = useState<DraftLine[]>([emptyLine()])
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    setOverview(await requestJson<ProcurementOverview>("/api/inventory/procurement"))
  }

  async function createSupplier(formData: FormData) {
    setError(null)
    try {
      await requestJson("/api/inventory/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(formData)),
      })
      await refresh()
      setNotice("Supplier created as a corporation Group.")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create supplier")
    }
  }

  async function createOrder(formData: FormData) {
    setError(null)
    try {
      await requestJson("/api/inventory/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: formData.get("supplierId"),
          orderNumber: formData.get("orderNumber"),
          currency: formData.get("currency"),
          expectedAt: formData.get("expectedAt"),
          notes: formData.get("notes"),
          lines: draftLines.map((line) => ({
            definitionId: line.definitionId,
            orderedQuantity: Number(line.quantity),
            unitCost: line.unitCost === "" ? null : Number(line.unitCost),
            destinationPlaceId: line.destinationPlaceId || null,
          })),
        }),
      })
      setDraftLines([emptyLine()])
      await refresh()
      setNotice("Purchase order Plan created.")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create order")
    }
  }

  return (
    <div className="procurement-layout">
      {(notice || error) && <div className={`inventory-notice${error ? " is-error" : ""}`}>{error ?? notice}</div>}
      <section className="inventory-panel">
        <div className="inventory-panel-heading"><h2>Suppliers</h2><span>{overview.suppliers.length} suppliers</span></div>
        <div className="supplier-list">
          {overview.suppliers.map((supplier) => (
            <div key={supplier.id}>
              <span><strong>{supplier.name}</strong><small>{supplier.supplierCode ?? supplier.email ?? "Supplier"}</small></span>
              <small>{supplier.orderCount} orders</small>
            </div>
          ))}
          {overview.suppliers.length === 0 && <div className="inventory-empty">No suppliers yet.</div>}
        </div>
        <form action={createSupplier} className="inventory-form procurement-form">
          <span className="eyebrow">New supplier</span>
          <div className="inventory-form-columns">
            <label>Name<input name="name" required placeholder="Acme Supply" /></label>
            <label>Supplier code<input name="supplierCode" placeholder="ACME" /></label>
            <label>Email<input name="email" type="email" /></label>
            <label>Payment terms<input name="paymentTerms" placeholder="Net 30" /></label>
          </div>
          <button className="inventory-primary" type="submit">Create supplier</button>
        </form>
      </section>

      <section className="inventory-panel">
        <div className="inventory-panel-heading"><h2>New purchase order</h2><span>Plan with operational lines</span></div>
        <form action={createOrder} className="inventory-form">
          <div className="inventory-form-columns">
            <label>
              Supplier
              <select name="supplierId" required defaultValue="">
                <option value="" disabled>Choose supplier</option>
                {overview.suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
              </select>
            </label>
            <label>Order number<input name="orderNumber" required placeholder="PO-2026-001" /></label>
            <label>Currency<input name="currency" defaultValue="USD" maxLength={3} /></label>
            <label>Expected<input name="expectedAt" type="date" /></label>
          </div>
          <div className="purchase-line-editor">
            {draftLines.map((line, index) => (
              <div key={index}>
                <select value={line.definitionId} onChange={(event) => setDraftLines((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, definitionId: event.target.value } : entry))}>
                  <option value="">Choose stock definition</option>
                  {definitions.map((definition) => <option key={definition.id} value={definition.id}>{definition.name}</option>)}
                </select>
                <input aria-label={`Line ${index + 1} quantity`} type="number" min="0.0001" step="any" value={line.quantity} onChange={(event) => setDraftLines((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, quantity: event.target.value } : entry))} />
                <input aria-label={`Line ${index + 1} unit cost`} type="number" min="0" step="0.01" value={line.unitCost} placeholder="Unit $" onChange={(event) => setDraftLines((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, unitCost: event.target.value } : entry))} />
                <select aria-label={`Line ${index + 1} destination`} value={line.destinationPlaceId} onChange={(event) => setDraftLines((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, destinationPlaceId: event.target.value } : entry))}>
                  <option value="">Destination</option>
                  {places.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}
                </select>
                {draftLines.length > 1 && <button type="button" onClick={() => setDraftLines((current) => current.filter((_, entryIndex) => entryIndex !== index))}>Remove</button>}
              </div>
            ))}
            <button type="button" onClick={() => setDraftLines((current) => [...current, emptyLine()])}>Add line</button>
          </div>
          <label>Notes<textarea name="notes" rows={2} /></label>
          <button className="inventory-primary" type="submit">Create purchase order</button>
        </form>
      </section>

      <section className="inventory-panel procurement-orders">
        <div className="inventory-panel-heading"><h2>Purchase orders</h2><span>{overview.orders.length} orders</span></div>
        {overview.orders.map((order) => (
          <OrderCard
            key={`${order.id}:${order.progress.received}`}
            order={order}
            definitions={definitions}
            lots={lots}
            places={places}
            onReceived={async () => {
              await Promise.all([refresh(), onInventoryChanged()])
              setNotice(`Receipt recorded for ${order.orderNumber}.`)
            }}
            onError={setError}
          />
        ))}
        {overview.orders.length === 0 && <div className="inventory-empty">No purchase orders yet.</div>}
      </section>
    </div>
  )
}

function OrderCard({
  order,
  definitions,
  lots,
  places,
  onReceived,
  onError,
}: {
  order: PurchaseOrder
  definitions: Definition[]
  lots: Lot[]
  places: Place[]
  onReceived: () => Promise<void>
  onError: (message: string) => void
}) {
  const [quantities, setQuantities] = useState<Record<string, string>>(
    Object.fromEntries(order.lines.map((line) => [line.id, String(Math.max(0, line.orderedQuantity - line.receivedQuantity))])),
  )
  const [destinations, setDestinations] = useState<Record<string, string>>(
    Object.fromEntries(order.lines.map((line) => [line.id, line.destinationPlaceId ?? ""])),
  )
  const [selectedLots, setSelectedLots] = useState<Record<string, string>>({})
  const [serials, setSerials] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)

  async function receive(formData: FormData) {
    setPending(true)
    try {
      let receiptFileId: string | null = null
      const receipt = formData.get("receipt")
      if (receipt instanceof File && receipt.size > 0) {
        const upload = new FormData()
        upload.set("receipt", receipt)
        receiptFileId = (await requestJson<{ id: string }>("/api/inventory/receipts", { method: "POST", body: upload })).id
      }
      const lines = order.lines.flatMap((line) => {
        const quantity = Number(quantities[line.id] ?? 0)
        if (quantity <= 0) return []
        return [{
          orderLineId: line.id,
          quantity,
          destinationPlaceId: destinations[line.id] || null,
          lotId: selectedLots[line.id] || null,
          serialNumber: serials[line.id] || null,
        }]
      })
      await requestJson(`/api/inventory/purchase-orders/${order.id}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiptFileId, lines }),
      })
      await onReceived()
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not receive order")
    } finally {
      setPending(false)
    }
  }

  return (
    <article className="purchase-order-card">
      <header>
        <span>
          <strong>{order.orderNumber}</strong>
          <small>{order.supplierName} · {new Date(order.orderedAt).toLocaleDateString()}</small>
        </span>
        <em className={`order-status is-${order.progress.status}`}>{order.progress.status}</em>
      </header>
      <div className="purchase-progress"><div style={{ width: `${order.progress.ordered === 0 ? 0 : Math.min(100, (order.progress.received / order.progress.ordered) * 100)}%` }} /></div>
      <form action={receive}>
        {order.lines.map((line) => {
          const definition = definitions.find((entry) => entry.id === line.definitionId)
          const remaining = Math.max(0, line.orderedQuantity - line.receivedQuantity)
          return (
            <div key={line.id} className="receiving-line">
              <span><strong>{line.description}</strong><small>{line.receivedQuantity} of {line.orderedQuantity} {line.unit} received</small></span>
              {remaining > 0 && (
                <div>
                  <input aria-label={`${line.description} receive quantity`} type="number" min="0" max={remaining} step="any" value={quantities[line.id] ?? ""} onChange={(event) => setQuantities((current) => ({ ...current, [line.id]: event.target.value }))} />
                  <select aria-label={`${line.description} destination`} value={destinations[line.id] ?? ""} onChange={(event) => setDestinations((current) => ({ ...current, [line.id]: event.target.value }))}>
                    <option value="">Destination</option>
                    {places.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}
                  </select>
                  {definition?.trackingMode === "lot" && (
                    <select aria-label={`${line.description} lot`} value={selectedLots[line.id] ?? ""} onChange={(event) => setSelectedLots((current) => ({ ...current, [line.id]: event.target.value }))}>
                      <option value="">Choose lot</option>
                      {lots.filter((lot) => lot.definitionId === line.definitionId).map((lot) => <option key={lot.id} value={lot.id}>{lot.lotCode}</option>)}
                    </select>
                  )}
                  {definition?.trackingMode === "serial" && <input aria-label={`${line.description} serial number`} value={serials[line.id] ?? ""} placeholder="Serial number" onChange={(event) => setSerials((current) => ({ ...current, [line.id]: event.target.value }))} />}
                </div>
              )}
            </div>
          )
        })}
        {!order.progress.complete && (
          <div className="receipt-actions">
            <label>Receipt or packing slip<input name="receipt" type="file" accept="application/pdf,image/*" /></label>
            <button className="inventory-primary" type="submit" disabled={pending}>{pending ? "Receiving…" : "Receive selected"}</button>
          </div>
        )}
      </form>
    </article>
  )
}
