import { redirect } from "next/navigation"
import { requireStuffAccess } from "@/lib/access"
import { db } from "@/lib/db"
import { getInventoryOverview, getProcurementOverview } from "@/lib/inventory"
import InventoryClient from "./inventory-client"

export const dynamic = "force-dynamic"

export default async function InventoryPage() {
  const access = await requireStuffAccess()
  if (!access) redirect("/login")
  const [overview, procurement] = await Promise.all([
    getInventoryOverview(db, access.workspaceId),
    getProcurementOverview(db, access.workspaceId),
  ])

  return <InventoryClient initialOverview={overview} initialProcurement={procurement} />
}
