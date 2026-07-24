"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { resolveScannedValue } from "@/lib/inventory-core"
import ProcurementPanel, { type ProcurementOverview } from "./procurement-panel"

type Place = {
  id: string
  name: string
  type: string | null
  parentPlaceId: string | null
  directItemCount: number
  effectiveItemCount: number
}
type Item = {
  id: string
  name: string
  assetId: string
  category: string | null
  quantity: number
  placeId: string | null
  definitionId: string | null
  lotId: string | null
  serialNumber: string | null
  effectivePlaceId: string | null
  inherited: boolean
  lastObservedAt: string | null
  attentionReason: string | null
}
type StocktakeSummary = { id: string; name: string; start: string | Date; placeId: string | null }
type Definition = {
  id: string
  name: string
  sku: string | null
  category: string | null
  unit: string
  trackingMode: "untracked" | "lot" | "serial"
  reorderPoint: number | null
  targetStock: number | null
  defaultShelfLifeDays: number | null
  quantity: number
  itemCount: number
  lotCount: number
  low: boolean
  suggestedOrder: number
}
type Lot = {
  id: string
  definitionId: string
  definitionName: string
  sku: string | null
  lotCode: string
  expiresAt: string | Date | null
  quantity: number
  itemCount: number
  expiry: { status: "expired" | "expiring" | "fresh"; daysRemaining: number } | null
}
type Overview = {
  places: Place[]
  items: Item[]
  attentionItems: Item[]
  activeStocktakes: StocktakeSummary[]
  definitions: Definition[]
  lots: Lot[]
}
type StocktakeDetail = {
  id: string
  name: string
  end: string | null
  placeId: string | null
  snapshot: { placeIds: string[] }
  progress: {
    expected: number
    observed: number
    verifiedExpected: string[]
    missing: string[]
    unexpected: string[]
    completePercent: number
  }
  expectedItems: Array<{ id: string; name: string; assetId: string; placeId: string | null }>
  missingItems: Array<{ id: string; name: string; assetId: string; placeId: string | null }>
  unexpectedItems: Array<{ id: string; name: string; assetId: string; placeId: string | null }>
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const data = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new Error(data.error ?? "Something went wrong")
  return data as T
}

export default function InventoryClient({
  initialOverview,
  initialProcurement,
}: {
  initialOverview: Overview
  initialProcurement: ProcurementOverview
}) {
  const [overview, setOverview] = useState(initialOverview)
  const [tab, setTab] = useState<"overview" | "stock" | "procurement" | "locations" | "scan" | "stocktake">("overview")
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeStocktakeId, setActiveStocktakeId] = useState(initialOverview.activeStocktakes[0]?.id ?? null)
  const [stocktake, setStocktake] = useState<StocktakeDetail | null>(null)

  const placeById = useMemo(() => new Map(overview.places.map((place) => [place.id, place])), [overview.places])
  const refresh = useCallback(async () => {
    setOverview(await jsonRequest<Overview>("/api/inventory/overview"))
  }, [])
  const loadStocktake = useCallback(async (id: string) => {
    setStocktake(await jsonRequest<StocktakeDetail>(`/api/inventory/stocktakes/${id}`))
    setActiveStocktakeId(id)
  }, [])

  useEffect(() => {
    if (activeStocktakeId) void loadStocktake(activeStocktakeId)
  }, [activeStocktakeId, loadStocktake])

  async function startStocktake(formData: FormData) {
    setError(null)
    const placeId = String(formData.get("placeId") ?? "")
    try {
      const result = await jsonRequest<{ id: string }>("/api/inventory/stocktakes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          placeId,
          includeDescendants: formData.get("includeDescendants") === "on",
        }),
      })
      await Promise.all([refresh(), loadStocktake(result.id)])
      setNotice("Stocktake started. Scan or enter each item as you find it.")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start stocktake")
    }
  }

  function optionalNumber(formData: FormData, key: string) {
    const value = String(formData.get(key) ?? "").trim()
    return value === "" ? null : Number(value)
  }

  async function createDefinition(formData: FormData) {
    setError(null)
    try {
      await jsonRequest("/api/inventory/definitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          sku: formData.get("sku"),
          category: formData.get("category"),
          unit: formData.get("unit"),
          trackingMode: formData.get("trackingMode"),
          reorderPoint: optionalNumber(formData, "reorderPoint"),
          targetStock: optionalNumber(formData, "targetStock"),
          defaultShelfLifeDays: optionalNumber(formData, "defaultShelfLifeDays"),
        }),
      })
      await refresh()
      setNotice("Stock definition created.")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create definition")
    }
  }

  async function createLot(formData: FormData) {
    setError(null)
    try {
      await jsonRequest("/api/inventory/lots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          definitionId: formData.get("definitionId"),
          lotCode: formData.get("lotCode"),
          receivedAt: formData.get("receivedAt"),
          expiresAt: formData.get("expiresAt"),
        }),
      })
      await refresh()
      setNotice("Inventory lot created.")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create lot")
    }
  }

  async function stocktakeAction(action: "verify" | "finish" | "mark_missing", itemId?: string) {
    if (!activeStocktakeId) return
    setError(null)
    try {
      await jsonRequest(`/api/inventory/stocktakes/${activeStocktakeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, itemId }),
      })
      await Promise.all([loadStocktake(activeStocktakeId), refresh()])
      setNotice(action === "finish" ? "Stocktake finished." : action === "mark_missing" ? "Item marked missing." : "Item verified.")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Stocktake action failed")
    }
  }

  async function handleScan(rawValue: string) {
    setError(null)
    const parsed = resolveScannedValue(rawValue)
    if (!parsed) return
    try {
      let itemId: string | null = parsed.kind === "item" ? parsed.id : null
      if (parsed.kind === "lookup") {
        const lookup = await jsonRequest<{ kind: "item" | "place"; value: { id: string } }>(
          `/api/inventory/lookup?q=${encodeURIComponent(parsed.id)}`,
        )
        if (lookup.kind !== "item") throw new Error("Scan an item while a stocktake is active")
        itemId = lookup.value.id
      }
      if (parsed.kind === "place") throw new Error("Scan an item while a stocktake is active")
      if (!itemId) return
      if (activeStocktakeId && stocktake) {
        const item = overview.items.find((candidate) => candidate.id === itemId)
        const scopePlaceId = stocktake.placeId
        if (item && !stocktake.snapshot.placeIds.includes(item.effectivePlaceId ?? "") && scopePlaceId) {
          const confirmed = window.confirm(`${item.name} is stored elsewhere. Move it to this stocktake location?`)
          if (!confirmed) return
          await jsonRequest(`/api/inventory/stocktakes/${activeStocktakeId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "move",
              itemId,
              destinationPlaceId: scopePlaceId,
              expectedFromPlaceId: item.placeId,
            }),
          })
        } else {
          await stocktakeAction("verify", itemId)
          return
        }
        await Promise.all([loadStocktake(activeStocktakeId), refresh()])
        setNotice("Item moved here and verified.")
        return
      }
      window.location.href = `/items/${itemId}`
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not resolve scan")
    }
  }

  return (
    <div className="inventory-page">
      <section className="inventory-hero">
        <div>
          <span className="eyebrow">Know where everything is</span>
          <h1>Inventory</h1>
          <p>Locations are the present view. Every move and verification remains part of the history.</p>
        </div>
        <div className="inventory-hero-stats">
          <Stat value={overview.items.length} label="items" />
          <Stat value={overview.places.length} label="places" />
          <Stat value={overview.attentionItems.length} label="need attention" attention />
        </div>
      </section>

      {(notice || error) && (
        <div className={`inventory-notice${error ? " is-error" : ""}`}>
          {error ?? notice}
          <button type="button" onClick={() => { setNotice(null); setError(null) }}>Dismiss</button>
        </div>
      )}

      <nav className="inventory-tabs" aria-label="Inventory sections">
        {(["overview", "stock", "procurement", "locations", "scan", "stocktake"] as const).map((value) => (
          <button key={value} type="button" className={tab === value ? "is-active" : ""} onClick={() => setTab(value)}>
            {value === "stocktake" ? "Stocktake" : value === "procurement" ? "Purchasing" : value[0].toUpperCase() + value.slice(1)}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="inventory-grid">
          <section className="inventory-panel">
            <PanelHeading title="Needs attention" meta={`${overview.attentionItems.length} items`} />
            {overview.attentionItems.length === 0 ? (
              <Empty text="Everything has a location and a recent verification." />
            ) : overview.attentionItems.map((item) => (
              <ItemRow key={item.id} item={item} place={item.effectivePlaceId ? placeById.get(item.effectivePlaceId) : undefined} />
            ))}
          </section>
          <section className="inventory-panel">
            <PanelHeading title="Recently catalogued" meta={`${overview.items.length} total`} />
            {overview.items.slice(0, 8).map((item) => (
              <ItemRow key={item.id} item={item} place={item.effectivePlaceId ? placeById.get(item.effectivePlaceId) : undefined} />
            ))}
          </section>
        </div>
      )}

      {tab === "locations" && (
        <section className="inventory-panel">
          <PanelHeading title="Locations" meta="Nested storage map" />
          <LocationTree places={overview.places} items={overview.items} />
        </section>
      )}

      {tab === "stock" && (
        <div className="inventory-stock-layout">
          <section className="inventory-panel">
            <PanelHeading title="Stock definitions" meta={`${overview.definitions.length} definitions`} />
            {overview.definitions.length === 0 ? <Empty text="Create a definition for supplies or products you track by quantity." /> : (
              <div className="definition-list">
                {overview.definitions.map((definition) => (
                  <div key={definition.id} className={definition.low ? "definition-row is-low" : "definition-row"}>
                    <span>
                      <strong>{definition.name}</strong>
                      <small>{definition.sku ?? "No SKU"} · {definition.trackingMode} · {definition.itemCount} holding{definition.itemCount === 1 ? "" : "s"}</small>
                    </span>
                    <span>
                      <strong>{definition.quantity} {definition.unit}</strong>
                      <small>
                        {definition.low
                          ? `Low · replenish ${definition.suggestedOrder}`
                          : definition.reorderPoint != null
                            ? `Reorder at ${definition.reorderPoint}`
                            : "No threshold"}
                      </small>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="inventory-panel">
            <PanelHeading title="New definition" meta="Reusable stock identity" />
            <form action={createDefinition} className="inventory-form definition-form">
              <div className="inventory-form-columns">
                <label>Name<input name="name" required placeholder="Printer paper" /></label>
                <label>SKU<input name="sku" placeholder="PAPER-A4" /></label>
                <label>Category<input name="category" placeholder="Office supplies" /></label>
                <label>Unit<input name="unit" defaultValue="each" placeholder="box" /></label>
                <label>
                  Tracking
                  <select name="trackingMode" defaultValue="untracked">
                    <option value="untracked">Quantity only</option>
                    <option value="lot">Lot or batch</option>
                    <option value="serial">Serial number</option>
                  </select>
                </label>
                <label>Reorder point<input name="reorderPoint" type="number" min="0" step="any" /></label>
                <label>Target stock<input name="targetStock" type="number" min="0" step="any" /></label>
                <label>Shelf life, days<input name="defaultShelfLifeDays" type="number" min="1" step="1" /></label>
              </div>
              <button className="inventory-primary" type="submit">Create definition</button>
            </form>
          </section>

          <section className="inventory-panel">
            <PanelHeading title="Lots and expiry" meta={`${overview.lots.length} lots`} />
            {overview.lots.length === 0 ? <Empty text="No lots have been recorded." /> : (
              <div className="definition-list">
                {overview.lots.map((lot) => (
                  <div key={lot.id} className={`definition-row${lot.expiry?.status === "expired" ? " is-expired" : lot.expiry?.status === "expiring" ? " is-low" : ""}`}>
                    <span>
                      <strong>{lot.lotCode}</strong>
                      <small>{lot.definitionName}{lot.sku ? ` · ${lot.sku}` : ""}</small>
                    </span>
                    <span>
                      <strong>{lot.quantity}</strong>
                      <small>
                        {lot.expiry
                          ? lot.expiry.status === "expired"
                            ? `Expired ${Math.abs(lot.expiry.daysRemaining)} days ago`
                            : `${lot.expiry.daysRemaining} days remaining`
                          : "No expiry"}
                      </small>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="inventory-panel">
            <PanelHeading title="New lot" meta="Shared batch provenance" />
            <form action={createLot} className="inventory-form">
              <label>
                Definition
                <select name="definitionId" required defaultValue="">
                  <option value="" disabled>Choose a definition</option>
                  {overview.definitions.filter((definition) => definition.trackingMode !== "untracked").map((definition) => (
                    <option key={definition.id} value={definition.id}>{definition.name}</option>
                  ))}
                </select>
              </label>
              <div className="inventory-form-columns">
                <label>Lot code<input name="lotCode" required placeholder="LOT-2026-07" /></label>
                <label>Received<input name="receivedAt" type="date" /></label>
                <label>Expires<input name="expiresAt" type="date" /></label>
              </div>
              <button className="inventory-primary" type="submit">Create lot</button>
            </form>
          </section>
        </div>
      )}

      {tab === "procurement" && (
        <ProcurementPanel
          initialOverview={initialProcurement}
          definitions={overview.definitions}
          lots={overview.lots}
          places={overview.places}
          onInventoryChanged={refresh}
        />
      )}

      {tab === "scan" && (
        <section className="inventory-panel inventory-scan-panel">
          <PanelHeading title="Scan a label" meta={activeStocktakeId ? "Adds to active stocktake" : "Opens item details"} />
          <Scanner onValue={handleScan} />
        </section>
      )}

      {tab === "stocktake" && (
        <div className="inventory-grid">
          <section className="inventory-panel">
            <PanelHeading title="Start or resume" meta="Frozen location snapshot" />
            <form action={startStocktake} className="inventory-form">
              <label>
                Location
                <select name="placeId" required defaultValue="">
                  <option value="" disabled>Choose a place</option>
                  {overview.places.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}
                </select>
              </label>
              <label className="inventory-checkbox">
                <input type="checkbox" name="includeDescendants" defaultChecked />
                Include shelves, drawers, and other child locations
              </label>
              <button className="inventory-primary" type="submit">Start stocktake</button>
            </form>
            {overview.activeStocktakes.length > 0 && (
              <div className="active-stocktakes">
                <span className="eyebrow">In progress</span>
                {overview.activeStocktakes.map((event) => (
                  <button key={event.id} type="button" onClick={() => void loadStocktake(event.id)}>
                    <span>{event.name}</span>
                    <small>{new Date(event.start).toLocaleDateString()}</small>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="inventory-panel">
            <PanelHeading title={stocktake?.name ?? "Current stocktake"} meta={stocktake ? `${stocktake.progress.completePercent}% found` : "Not started"} />
            {!stocktake ? <Empty text="Choose a location to begin." /> : (
              <>
                <div className="stocktake-progress">
                  <div style={{ width: `${stocktake.progress.completePercent}%` }} />
                </div>
                <div className="stocktake-counts">
                  <Stat value={stocktake.progress.verifiedExpected.length} label="found" />
                  <Stat value={stocktake.progress.missing.length} label="unseen" attention />
                  <Stat value={stocktake.progress.unexpected.length} label="unexpected" />
                </div>
                <Scanner onValue={handleScan} compact />
                {stocktake.missingItems.length > 0 && (
                  <div className="stocktake-list">
                    <span className="eyebrow">Still unseen</span>
                    {stocktake.missingItems.map((item) => (
                      <div key={item.id}>
                        <span><strong>{item.name}</strong><small>{item.assetId}</small></span>
                        <span className="stocktake-actions">
                          <button type="button" onClick={() => void stocktakeAction("verify", item.id)}>Found</button>
                          <button type="button" onClick={() => {
                            if (window.confirm(`Confirm that ${item.name} is missing?`)) void stocktakeAction("mark_missing", item.id)
                          }}>Mark missing</button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {!stocktake.end && (
                  <button className="inventory-primary" type="button" onClick={() => void stocktakeAction("finish")}>
                    Finish stocktake
                  </button>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function Stat({ value, label, attention }: { value: number; label: string; attention?: boolean }) {
  return <div className={attention ? "inventory-stat is-attention" : "inventory-stat"}><strong>{value}</strong><span>{label}</span></div>
}

function PanelHeading({ title, meta }: { title: string; meta: string }) {
  return <div className="inventory-panel-heading"><h2>{title}</h2><span>{meta}</span></div>
}

function Empty({ text }: { text: string }) {
  return <div className="inventory-empty">{text}</div>
}

function ItemRow({ item, place }: { item: Item; place?: Place }) {
  return (
    <div className="inventory-item-row">
      <Link href={`/items/${item.id}`}>
        <span><strong>{item.name}</strong><small>{item.assetId}{item.category ? ` · ${item.category}` : ""}</small></span>
        <span className="inventory-item-meta">
          {item.attentionReason && <em>{item.attentionReason}</em>}
          <small>{place?.name ?? "Unplaced"}{item.inherited ? " · inherited" : ""}</small>
        </span>
      </Link>
      <Link className="label-link" href={`/inventory/labels?kind=item&id=${item.id}`}>Label</Link>
    </div>
  )
}

function LocationTree({ places, items }: { places: Place[]; items: Item[] }) {
  const children = useMemo(() => {
    const map = new Map<string | null, Place[]>()
    for (const place of places) map.set(place.parentPlaceId, [...(map.get(place.parentPlaceId) ?? []), place])
    return map
  }, [places])

  function branch(parentId: string | null, depth: number): React.ReactNode {
    return (children.get(parentId) ?? []).map((place) => {
      const placedItems = items.filter((item) => item.effectivePlaceId === place.id)
      return (
        <div key={place.id} className="location-branch" style={{ marginLeft: depth * 20 }}>
          <div className="location-row">
            <span><strong>{place.name}</strong><small>{place.type ?? "Location"} · {place.effectiveItemCount} items</small></span>
            <Link href={`/inventory/labels?kind=place&id=${place.id}`}>Print label</Link>
          </div>
          {placedItems.length > 0 && (
            <div className="location-items">{placedItems.slice(0, 5).map((item) => <Link key={item.id} href={`/items/${item.id}`}>{item.name}</Link>)}</div>
          )}
          {branch(place.id, depth + 1)}
        </div>
      )
    })
  }

  return <div className="location-tree">{branch(null, 0)}{places.length === 0 && <Empty text="No Places exist yet. Create storage Places in the Places app first." />}</div>
}

type BarcodeDetectorInstance = {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>
}
type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorInstance

function Scanner({ onValue, compact }: { onValue: (value: string) => Promise<void>; compact?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [manual, setManual] = useState("")
  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)

  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), [])

  async function startCamera() {
    const Detector = (window as typeof window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector
    if (!Detector) {
      setCameraError("This browser does not support built-in QR scanning. Use the entry field below.")
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
      streamRef.current = stream
      if (!videoRef.current) return
      videoRef.current.srcObject = stream
      await videoRef.current.play()
      setCameraOn(true)
      const detector = new Detector({ formats: ["qr_code"] })
      const scan = async () => {
        if (!videoRef.current || !streamRef.current) return
        const codes = await detector.detect(videoRef.current).catch(() => [])
        if (codes[0]?.rawValue) {
          streamRef.current.getTracks().forEach((track) => track.stop())
          streamRef.current = null
          setCameraOn(false)
          await onValue(codes[0].rawValue)
          return
        }
        window.setTimeout(() => void scan(), 250)
      }
      void scan()
    } catch {
      setCameraError("Camera access was unavailable. Use the entry field below.")
    }
  }

  return (
    <div className={compact ? "inventory-scanner is-compact" : "inventory-scanner"}>
      <video ref={videoRef} playsInline muted className={cameraOn ? "is-on" : ""} />
      {!cameraOn && <button type="button" className="scanner-camera" onClick={() => void startCamera()}>Use camera</button>}
      {cameraError && <small>{cameraError}</small>}
      <form onSubmit={(event) => { event.preventDefault(); void onValue(manual); setManual("") }}>
        <input value={manual} onChange={(event) => setManual(event.target.value)} placeholder="Item label, asset ID, or QR value" />
        <button type="submit">Resolve</button>
      </form>
    </div>
  )
}
