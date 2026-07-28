import Link from "next/link"
import { requireLevelUpAccess } from "@/lib/access"
import { Mono } from "@/components/display"
import ColdStart from "@/components/ColdStart"

export const dynamic = "force-dynamic"

export default async function StartPage() {
  const access = await requireLevelUpAccess()
  if (!access) return <div className="wrap" style={{ padding: 80 }}><Mono>No workspace.</Mono></div>
  return (
    <div className="wrap">
      <div style={{ padding: "24px 0 0" }}>
        <Link href="/" className="mono mono-faint">← Card</Link>
      </div>
      <ColdStart />
    </div>
  )
}
