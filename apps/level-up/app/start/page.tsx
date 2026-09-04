import Link from "next/link"
import { requireLevelUpAccess } from "@/lib/access"
import { Mono } from "@/components/display"
import ColdStart from "@/components/ColdStart"
import WarmConcrete from "@/components/WarmConcrete"

export const dynamic = "force-dynamic"

export default async function StartPage() {
  const access = await requireLevelUpAccess()
  if (!access) {
    return (
      <WarmConcrete>
        <div className="wrap" style={{ padding: 80 }}><Mono>No workspace.</Mono></div>
      </WarmConcrete>
    )
  }
  return (
    <WarmConcrete>
      <div className="wrap">
        <div style={{ padding: "24px 0 0" }}>
          <Link href="/" className="mono mono-faint">← Card</Link>
        </div>
        <ColdStart />
      </div>
    </WarmConcrete>
  )
}
