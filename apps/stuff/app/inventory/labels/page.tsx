import QRCode from "qrcode"
import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"
import { requireStuffAccess } from "@/lib/access"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

export default async function InventoryLabelPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; id?: string }>
}) {
  const access = await requireStuffAccess()
  if (!access) redirect("/login")
  const { kind, id } = await searchParams
  if (!id || (kind !== "item" && kind !== "place")) notFound()

  const record = kind === "item"
    ? await db.item.findFirst({
      where: { id, workspaceId: access.workspaceId },
      select: { id: true, name: true, assetId: true },
    })
    : await db.place.findFirst({
      where: { id, workspaceId: access.workspaceId },
      select: { id: true, name: true },
    })
  if (!record) notFound()

  const path = `/inventory/${kind === "item" ? "items" : "places"}/${record.id}`
  const requestHeaders = await headers()
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host")
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https")
  const appOrigin = process.env.NEXT_PUBLIC_STUFF_URL ?? (host ? `${protocol}://${host}` : "https://stuff.lacollecteur.com")
  const labelUrl = `${appOrigin.replace(/\/$/, "")}${path}`
  const svg = await QRCode.toString(labelUrl, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    color: { dark: "#2c2620", light: "#f7f4ee" },
  })
  const assetId = kind === "item" && "assetId" in record
    ? String(record.assetId)
    : "Place"

  return (
    <div className="label-page">
      <div className="label-toolbar">
        <a href="/inventory">← Inventory</a>
        <span className="print-instruction">Use your browser’s print command</span>
      </div>
      <article className="inventory-label">
        <div className="inventory-label-qr" dangerouslySetInnerHTML={{ __html: svg }} />
        <div>
          <span>{assetId}</span>
          <h1>{record.name}</h1>
          <small>{labelUrl}</small>
        </div>
      </article>
    </div>
  )
}
