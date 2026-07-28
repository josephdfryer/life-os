import Link from "next/link"
import { requireLevelUpAccess } from "@/lib/access"
import { db } from "@/lib/db"
import { loadBundle } from "@/lib/store"
import { BUILDS, TARGET_TEMPLATES, targetDeltas, type BuildKey } from "@/lib/engine"
import { ATTRIBUTE_LABELS } from "@/lib/engine/attributes"
import type { AttributeKey } from "@/lib/engine/types"
import { Mono } from "@/components/display"
import BuildSelector from "@/components/BuildSelector"
import TargetBuilds, { type TargetView } from "@/components/TargetBuilds"

export const dynamic = "force-dynamic"

export default async function BuildsPage() {
  const access = await requireLevelUpAccess()
  if (!access) return <div className="wrap" style={{ padding: 80 }}><Mono>No workspace.</Mono></div>

  const [{ card }, tracked] = await Promise.all([
    loadBundle(access.workspaceId),
    db.levelUpTargetBuild.findMany({ where: { workspaceId: access.workspaceId, status: "active" }, select: { buildKey: true } }),
  ])
  const trackedKeys = new Set(tracked.map((t) => t.buildKey))
  const buildRows = (Object.keys(BUILDS) as BuildKey[]).map((k) => ({ key: k, label: BUILDS[k].label, ovr: card.buildOvrs[k] }))

  const targets: TargetView[] = TARGET_TEMPLATES.map((t) => {
    const deltas = targetDeltas(card.attributes, t.requirements)
    return {
      key: t.key,
      label: t.label,
      blurb: t.blurb,
      tracked: trackedKeys.has(t.key),
      totalGap: deltas.reduce((a, d) => a + d.gap, 0),
      requirements: t.requirements as Record<string, number>,
      deltas: deltas.map((d) => ({
        label: ATTRIBUTE_LABELS[d.attribute as AttributeKey],
        current: d.current,
        required: d.required,
        gap: d.gap,
      })),
    }
  })

  return (
    <div className="wrap" style={{ paddingBottom: 80 }}>
      <div style={{ padding: "24px 0 0" }}>
        <Link href="/" className="mono mono-faint">← Card</Link>
      </div>

      <div style={{ padding: "16px 0 8px" }}>
        <h1 className="serif" style={{ fontSize: 40, margin: 0 }}>Builds</h1>
        <Mono faint>One score can&apos;t describe a person. Pick the OVR that matters to you; every build keeps Mobility and Resilience mandatory.</Mono>
      </div>

      <div style={{ margin: "20px 0 8px" }}>
        {BUILDS[card.primaryBuild] && (
          <div style={{ marginBottom: 16 }}>
            <Mono faint style={{ fontSize: 9 }}>{BUILDS[card.primaryBuild].blurb}</Mono>
          </div>
        )}
        <BuildSelector builds={buildRows} current={card.primaryBuild} />
      </div>

      <div style={{ padding: "36px 0 16px", borderTop: "1px solid var(--line-strong)", marginTop: 28 }}>
        <Mono>Target builds</Mono>
        <div style={{ color: "var(--ink-dim)", fontSize: 13, marginTop: 6, maxWidth: 620 }}>
          Turn a goal into a character sheet. Track one and the engine renders the whole climb as visible points instead of a binary can&apos;t / can.
        </div>
      </div>
      <TargetBuilds targets={targets} />
    </div>
  )
}
