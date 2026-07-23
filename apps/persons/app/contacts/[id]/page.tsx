import { redirect } from "next/navigation"

type Params = { params: Promise<{ id: string }> }

export default async function LegacyContactDetailPage({ params }: Params) {
  const { id } = await params
  redirect(`/persons/${id}`)
}
