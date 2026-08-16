import { redirect } from "next/navigation"
import { personsUrl } from "@/lib/persons-url"

export default async function TheoryPersonRedirect({ params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params
  redirect(personsUrl(`/persons/${personId}/theory`))
}
