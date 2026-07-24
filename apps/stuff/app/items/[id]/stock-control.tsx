"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

type Definition = {
  id: string
  name: string
  sku: string | null
  unit: string
  trackingMode: "untracked" | "lot" | "serial"
  lots: Array<{ id: string; lotCode: string; expiresAt: string | Date | null }>
}

async function mutation(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new Error(data.error ?? "Stock update failed")
}

export default function StockControl({
  itemId,
  quantity,
  definitionId,
  lotId,
  serialNumber,
  definitions,
}: {
  itemId: string
  quantity: number
  definitionId: string | null
  lotId: string | null
  serialNumber: string | null
  definitions: Definition[]
}) {
  const router = useRouter()
  const [selectedDefinitionId, setSelectedDefinitionId] = useState(definitionId ?? "")
  const [selectedLotId, setSelectedLotId] = useState(lotId ?? "")
  const [serial, setSerial] = useState(serialNumber ?? "")
  const [delta, setDelta] = useState("")
  const [reason, setReason] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const selectedDefinition = definitions.find((definition) => definition.id === selectedDefinitionId)
  const lots = selectedDefinition?.lots ?? []

  async function run(body: unknown, success: string) {
    setPending(true)
    setMessage(null)
    try {
      await mutation(`/api/inventory/items/${itemId}/stock`, body)
      setMessage(success)
      router.refresh()
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Stock update failed")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="item-stock-control">
      <div className="item-stock-balance">
        <strong>{quantity}</strong>
        <span>{selectedDefinition?.unit ?? "each"} currently recorded</span>
      </div>
      <div className="item-stock-grid">
        <label>
          Definition
          <select
            value={selectedDefinitionId}
            onChange={(event) => {
              setSelectedDefinitionId(event.target.value)
              setSelectedLotId("")
            }}
          >
            <option value="">No definition</option>
            {definitions.map((definition) => (
              <option key={definition.id} value={definition.id}>
                {definition.name}{definition.sku ? ` · ${definition.sku}` : ""}
              </option>
            ))}
          </select>
        </label>
        {selectedDefinition?.trackingMode !== "untracked" && selectedDefinition && (
          <label>
            Lot
            <select value={selectedLotId} onChange={(event) => setSelectedLotId(event.target.value)}>
              <option value="">No lot</option>
              {lots.map((lot) => (
                <option key={lot.id} value={lot.id}>{lot.lotCode}</option>
              ))}
            </select>
          </label>
        )}
        {selectedDefinition?.trackingMode === "serial" && (
          <label>
            Serial number
            <input value={serial} onChange={(event) => setSerial(event.target.value)} />
          </label>
        )}
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() => void run({
          action: "configure",
          definitionId: selectedDefinitionId || null,
          lotId: selectedLotId || null,
          serialNumber: serial || null,
        }, "Stock tracking updated.")}
      >
        Save tracking
      </button>

      <div className="item-adjustment">
        <span className="eyebrow">Adjust balance</span>
        <div>
          <input
            type="number"
            step="any"
            value={delta}
            onChange={(event) => setDelta(event.target.value)}
            placeholder="+5 or -2"
            aria-label="Quantity change"
          />
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason, e.g. used or received"
            aria-label="Adjustment reason"
          />
          <button
            type="button"
            disabled={pending || !delta || !reason.trim()}
            onClick={() => void run({
              action: "adjust",
              delta: Number(delta),
              reason,
            }, "Balance adjusted and recorded.")}
          >
            Record adjustment
          </button>
        </div>
      </div>
      {message && <small className="item-stock-message">{message}</small>}
    </div>
  )
}
