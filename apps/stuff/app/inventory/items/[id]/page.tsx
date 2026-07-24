import { notFound, redirect } from "next/navigation"
import { requireStuffAccess } from "@/lib/access"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

export default async function ItemLabelResolver({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const access = await requireStuffAccess()
  if (!access) redirect("/login")
  const { id } = await params
  const item = await db.item.findFirst({
    where: { id, workspaceId: access.workspaceId },
    select: { id: true },
  })
  if (!item) notFound()
  redirect(`/items/${item.id}`)
}
