"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useTimeZone } from "@life-os/ui"

type WardrobeItem = {
  id: string
  name: string
  assetId: string
  category: string | null
  color: string | null
  imageUrl: string | null
  wearCount: number
  lastWorn: string | null
  costPerWear: number | null
}

type Proposal = {
  name: string
  garmentType: string
  category: string
  colors: string[]
  material: string | null
  pattern: string | null
  season: string[]
  formality: string | null
  brand: string | null
  confidence: number
}

type RecentWear = {
  id: string
  timestamp: string
  summary: string | null
  personName: string | null
  imageUrl: string | null
  items: Array<{ id: string; name: string }>
}

type Props = {
  initialItems: WardrobeItem[]
  persons: Array<{ id: string; name: string }>
  places: Array<{ id: string; name: string }>
  recentWears: RecentWear[]
  defaultPersonId: string | null
  initialTimestamp: string
  aiConnected: boolean
  aiModelId: string
}

export default function WardrobeClient(props: Props) {
  const router = useRouter()
  const tz = useTimeZone()
  const [items, setItems] = useState(props.initialItems)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [photo, setPhoto] = useState<{ id: string; url: string; filename: string } | null>(null)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [personId, setPersonId] = useState(props.defaultPersonId ?? props.persons[0]?.id ?? "")
  const [placeId, setPlaceId] = useState("")
  const [timestamp, setTimestamp] = useState(props.initialTimestamp)
  const [duration, setDuration] = useState("")
  const [summary, setSummary] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [modelId, setModelId] = useState(props.aiModelId)
  const [connected, setConnected] = useState(props.aiConnected)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.includes(item.id)),
    [items, selectedIds],
  )

  async function uploadPhoto(file: File) {
    setBusy("upload")
    clearFeedback()
    const formData = new FormData()
    formData.set("photo", file)
    const result = await requestJson("/api/wardrobe/media", { method: "POST", body: formData })
    if (result.ok) {
      setPhoto(result.data)
      setProposals([])
      setMessage("Photograph archived locally.")
    } else setError(result.error)
    setBusy(null)
  }

  async function analyze() {
    if (!photo) return
    setBusy("analyze")
    clearFeedback()
    const result = await requestJson("/api/wardrobe/analyze", jsonRequest({ fileId: photo.id }))
    if (result.ok) {
      setProposals(result.data.garments)
      setMessage(`Found ${result.data.garments.length} garment${result.data.garments.length === 1 ? "" : "s"}. Review before saving.`)
    } else setError(result.error)
    setBusy(null)
  }

  async function saveGarments() {
    if (!photo || proposals.length === 0) return
    setBusy("save")
    clearFeedback()
    const result = await requestJson("/api/wardrobe/garments", jsonRequest({
      sourceFileId: photo.id,
      garments: proposals,
    }))
    if (result.ok) {
      const additions: WardrobeItem[] = result.data.items.map((item: { id: string; name: string; assetId: string }) => ({
        ...item,
        category: "Clothing",
        color: null,
        imageUrl: photo.url,
        wearCount: 0,
        lastWorn: null,
        costPerWear: null,
      }))
      setItems((current) => [...additions, ...current])
      setSelectedIds((current) => [...new Set([...current, ...additions.map((item) => item.id)])])
      setProposals([])
      setMessage(`${additions.length} reviewed garment${additions.length === 1 ? "" : "s"} saved and selected for this outfit.`)
      router.refresh()
    } else setError(result.error)
    setBusy(null)
  }

  async function logWear() {
    setBusy("wear")
    clearFeedback()
    const result = await requestJson("/api/wardrobe/wears", jsonRequest({
      personId,
      itemIds: selectedIds,
      sourceFileId: photo?.id,
      timestamp: new Date(timestamp).toISOString(),
      duration: duration ? Number(duration) : null,
      placeId: placeId || null,
      summary: summary || null,
    }))
    if (result.ok) {
      setItems((current) => current.map((item) => selectedIds.includes(item.id)
        ? { ...item, wearCount: item.wearCount + 1, lastWorn: result.data.timestamp }
        : item))
      setSelectedIds([])
      setSummary("")
      setDuration("")
      setMessage("Outfit recorded as a time-based Interaction.")
      router.refresh()
    } else setError(result.error)
    setBusy(null)
  }

  async function connectAi() {
    setBusy("settings")
    clearFeedback()
    const result = await requestJson("/api/wardrobe/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, modelId }),
    })
    if (result.ok) {
      setConnected(true)
      setApiKey("")
      setMessage("AI Gateway connected. The key is encrypted at rest.")
    } else setError(result.error)
    setBusy(null)
  }

  function updateProposal(index: number, field: keyof Proposal, value: string) {
    setProposals((current) => current.map((proposal, proposalIndex) => {
      if (proposalIndex !== index) return proposal
      if (field === "colors" || field === "season") {
        return { ...proposal, [field]: value.split(",").map((part) => part.trim()).filter(Boolean) }
      }
      return { ...proposal, [field]: value }
    }))
  }

  function clearFeedback() {
    setError(null)
    setMessage(null)
  }

  return (
    <div className="wardrobe-page">
      <section className="wardrobe-hero">
        <div>
          <div className="eyebrow">Wardrobe</div>
          <h1>Dress from what you own.</h1>
          <p>Photographs become provenance. Garments remain Items. What you wear becomes part of your life’s interaction history.</p>
        </div>
        <div className="wardrobe-stat">
          <strong>{items.length}</strong>
          <span>garments</span>
        </div>
      </section>

      {(message || error) && (
        <div className={`wardrobe-notice ${error ? "is-error" : ""}`}>{error ?? message}</div>
      )}

      <div className="wardrobe-layout">
        <main>
          <section className="wardrobe-panel capture-panel">
            <div className="panel-heading">
              <div>
                <span className="step-number">01</span>
                <h2>Begin with a photograph</h2>
              </div>
              <span className="panel-meta">Stored on this Mac</span>
            </div>

            <label className={`photo-drop ${photo ? "has-photo" : ""}`}>
              {photo ? (
                // Authenticated local media cannot be optimized by next/image without a custom loader.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo.url} alt="Uploaded outfit" />
              ) : (
                <span>
                  <strong>{busy === "upload" ? "Archiving…" : "Choose an outfit photograph"}</strong>
                  <small>JPEG, PNG, WebP, HEIC or HEIF · up to 15 MB</small>
                </span>
              )}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                disabled={Boolean(busy)}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void uploadPhoto(file)
                }}
              />
            </label>

            {photo && (
              <div className="capture-actions">
                <span>{photo.filename}</span>
                <button className="primary-button" onClick={() => void analyze()} disabled={!connected || Boolean(busy)}>
                  {busy === "analyze" ? "Looking carefully…" : "Analyze garments"}
                </button>
              </div>
            )}

            {!connected && (
              <div className="quiet-callout">Connect an AI Gateway key in the sidebar to analyze automatically. You can still select existing garments and log an outfit without AI.</div>
            )}
          </section>

          {proposals.length > 0 && (
            <section className="wardrobe-panel">
              <div className="panel-heading">
                <div>
                  <span className="step-number">02</span>
                  <h2>Review what was seen</h2>
                </div>
                <span className="panel-meta">You remain the authority</span>
              </div>
              <div className="proposal-list">
                {proposals.map((proposal, index) => (
                  <div className="proposal-card" key={`${proposal.name}-${index}`}>
                    <div className="proposal-topline">
                      <span>Garment {index + 1}</span>
                      <button className="text-button" onClick={() => setProposals((current) => current.filter((_, i) => i !== index))}>Remove</button>
                    </div>
                    <div className="field-grid">
                      <Field label="Name" value={proposal.name} onChange={(value) => updateProposal(index, "name", value)} />
                      <Field label="Type" value={proposal.garmentType} onChange={(value) => updateProposal(index, "garmentType", value)} />
                      <Field label="Colors" value={proposal.colors.join(", ")} onChange={(value) => updateProposal(index, "colors", value)} />
                      <Field label="Material" value={proposal.material ?? ""} onChange={(value) => updateProposal(index, "material", value)} />
                      <Field label="Pattern" value={proposal.pattern ?? ""} onChange={(value) => updateProposal(index, "pattern", value)} />
                      <Field label="Season" value={proposal.season.join(", ")} onChange={(value) => updateProposal(index, "season", value)} />
                      <Field label="Formality" value={proposal.formality ?? ""} onChange={(value) => updateProposal(index, "formality", value)} />
                      <Field label="Brand" value={proposal.brand ?? ""} onChange={(value) => updateProposal(index, "brand", value)} />
                    </div>
                  </div>
                ))}
              </div>
              <button className="primary-button" onClick={() => void saveGarments()} disabled={Boolean(busy)}>
                {busy === "save" ? "Saving…" : `Save ${proposals.length} reviewed garment${proposals.length === 1 ? "" : "s"}`}
              </button>
            </section>
          )}

          <section className="wardrobe-panel">
            <div className="panel-heading">
              <div>
                <span className="step-number">{proposals.length > 0 ? "03" : "02"}</span>
                <h2>Choose what was worn</h2>
              </div>
              <span className="panel-meta">{selectedIds.length} selected</span>
            </div>

            {items.length === 0 ? (
              <div className="empty-wardrobe">No garments yet. Analyze a photograph above to begin.</div>
            ) : (
              <div className="garment-grid">
                {items.map((item) => {
                  const selected = selectedIds.includes(item.id)
                  return (
                    <button
                      key={item.id}
                      className={`garment-card ${selected ? "is-selected" : ""}`}
                      onClick={() => setSelectedIds((current) => selected
                        ? current.filter((id) => id !== item.id)
                        : [...current, item.id])}
                    >
                      <div className="garment-image">
                        {item.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.imageUrl} alt="" />
                        ) : <span>{item.name.slice(0, 1)}</span>}
                      </div>
                      <div className="garment-copy">
                        <strong>{item.name}</strong>
                        <span>{item.wearCount} wear{item.wearCount === 1 ? "" : "s"}{item.costPerWear != null ? ` · $${item.costPerWear.toFixed(2)}/wear` : ""}</span>
                      </div>
                      <span className="selection-mark">{selected ? "✓" : ""}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </section>

          <section className="wardrobe-panel">
            <div className="panel-heading">
              <div>
                <span className="step-number">{proposals.length > 0 ? "04" : "03"}</span>
                <h2>Record the wearing</h2>
              </div>
              <span className="panel-meta">A time-based Interaction</span>
            </div>
            <div className="wear-form">
              <label><span>Wearer</span><select value={personId} onChange={(event) => setPersonId(event.target.value)}>{props.persons.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
              <label><span>When</span><input type="datetime-local" value={timestamp} onChange={(event) => setTimestamp(event.target.value)} /></label>
              <label><span>Duration in minutes</span><input type="number" min="1" value={duration} onChange={(event) => setDuration(event.target.value)} placeholder="Optional" /></label>
              <label><span>Place</span><select value={placeId} onChange={(event) => setPlaceId(event.target.value)}><option value="">No place</option>{props.places.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}</select></label>
              <label className="wide-field"><span>What was the occasion?</span><input value={summary} onChange={(event) => setSummary(event.target.value)} placeholder={selectedItems.length ? `Wore ${selectedItems.map((item) => item.name).join(", ")}` : "Dinner, work, a quiet Saturday…"} /></label>
            </div>
            <button className="primary-button" onClick={() => void logWear()} disabled={selectedIds.length === 0 || !personId || Boolean(busy)}>
              {busy === "wear" ? "Recording…" : "Record outfit"}
            </button>
          </section>
        </main>

        <aside>
          <section className="ai-card">
            <div className="eyebrow">Garment analysis</div>
            <h2>{connected ? "AI is connected" : "Connect your own key"}</h2>
            <p>Usage is billed through your Vercel AI Gateway account. Life OS stores the key encrypted and records each analysis.</p>
            <label><span>Gateway API key</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={connected ? "Replace existing key" : "vck_…"} /></label>
            <label><span>Vision model</span><input value={modelId} onChange={(event) => setModelId(event.target.value)} /></label>
            <button className="dark-button" onClick={() => void connectAi()} disabled={!apiKey || Boolean(busy)}>{busy === "settings" ? "Connecting…" : connected ? "Replace key" : "Connect key"}</button>
            <small>Keys never return to the browser after saving.</small>
          </section>

          <section className="recent-card">
            <div className="eyebrow">Recent wearing</div>
            {props.recentWears.length === 0 ? <p className="muted">Your outfit history will gather here.</p> : props.recentWears.map((wear) => (
              <div className="recent-wear" key={wear.id}>
                {wear.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={wear.imageUrl} alt="" />
                )}
                <div>
                  <strong>{wear.summary ?? wear.items.map((item) => item.name).join(", ")}</strong>
                  <span>{new Date(wear.timestamp).toLocaleDateString("en-US", { timeZone: tz })} · {wear.personName ?? "Unknown wearer"}</span>
                </div>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </div>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} /></label>
}

function jsonRequest(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }
}

async function requestJson(url: string, init: RequestInit): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, init)
    const data = await response.json()
    if (!response.ok) return { ok: false, error: data.error ?? "Something went wrong." }
    return { ok: true, data }
  } catch {
    return { ok: false, error: "Life OS could not complete that request." }
  }
}
