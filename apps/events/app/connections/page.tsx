import { redirect } from "next/navigation"
import { lifeOsAppUrl } from "@life-os/auth"

export default function EventsConnectionsRedirectPage() {
  const homeUrl = lifeOsAppUrl("home", "http://localhost:3003")
  redirect(`${homeUrl}/admin/connections`)
}
