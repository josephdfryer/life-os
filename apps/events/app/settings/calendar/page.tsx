import { Suspense } from "react"
import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import CalendarSettingsClient from "@/components/settings/CalendarSettingsClient"

export const dynamic = "force-dynamic"

export default async function CalendarSettingsPage() {
  const session = await auth()
  if (!session?.user?.email) redirect("/login")

  return (
    <div style={{ maxWidth: "760px", margin: "0 auto", padding: "40px 24px" }}>
      <div style={{ marginBottom: "28px" }}>
        <Link href="/connections" style={{ display: "inline-block", marginBottom: 12, color: "var(--ink-3)", fontSize: 12, textDecoration: "none" }}>← Connections</Link>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "28px",
            fontWeight: 600,
            letterSpacing: "-0.02em",
            margin: "0 0 6px",
          }}
        >
          Calendar sync
        </h1>
        <p style={{ margin: 0, fontSize: "12px", color: "var(--ink-3)" }}>
          Import Google Calendar into Events. Attendee matching still uses Person records from Persons.
        </p>
      </div>
      <Suspense fallback={<div style={{ color: "var(--ink-4)", fontSize: "12px" }}>Loading…</div>}>
        <CalendarSettingsClient />
      </Suspense>
    </div>
  )
}
