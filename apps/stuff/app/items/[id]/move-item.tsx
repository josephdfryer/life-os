"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

export default function MoveItem({
  itemId,
  currentPlaceId,
  disabledReason,
  places,
}: {
  itemId: string
  currentPlaceId: string | null
  disabledReason?: string
  places: Array<{ id: string; name: string }>
}) {
  const router = useRouter()
  const [destination, setDestination] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function move() {
    if (!destination) return
    setPending(true)
    setMessage(null)
    const response = await fetch("/api/inventory/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemId,
        destinationPlaceId: destination,
        expectedFromPlaceId: currentPlaceId,
      }),
    })
    const data = await response.json().catch(() => ({})) as { error?: string }
    setPending(false)
    if (!response.ok) {
      setMessage(data.error ?? "Move failed")
      return
    }
    setMessage("Location updated and movement recorded.")
    setDestination("")
    router.refresh()
  }

  if (disabledReason) return <div className="item-move-disabled">{disabledReason}</div>

  return (
    <div className="item-move-control">
      <select value={destination} onChange={(event) => setDestination(event.target.value)}>
        <option value="">Choose destination</option>
        {places.filter((place) => place.id !== currentPlaceId).map((place) => (
          <option key={place.id} value={place.id}>{place.name}</option>
        ))}
      </select>
      <button type="button" disabled={!destination || pending} onClick={() => void move()}>
        {pending ? "Moving…" : "Move item"}
      </button>
      {message && <small>{message}</small>}
    </div>
  )
}
