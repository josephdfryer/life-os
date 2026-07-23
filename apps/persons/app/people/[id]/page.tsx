import { redirect } from "next/navigation"

type Params = { params: Promise<{ id: string }> }

export default async function LegacyPersonDetailPage({ params }: Params) {
  const { id } = await params
  redirect(`/persons/${id}`)
}
