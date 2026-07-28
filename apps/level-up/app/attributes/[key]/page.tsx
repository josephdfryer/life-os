import Link from "next/link"
import { notFound } from "next/navigation"
import { requireLevelUpAccess } from "@/lib/access"
import { cookies } from "next/headers"
import { resolveTimeZone, TZ_COOKIE } from "@life-os/ui"
import { loadBundle } from "@/lib/store"
import { getTest, rateTest } from "@/lib/engine"
import { ATTRIBUTE_TAGLINE } from "@/lib/engine/attributes"
import type { AttributeKey, ReferencePopulation } from "@/lib/engine/types"
import { CapNotice, ConfidenceRule, Mono, Panel, Stat } from "@/components/display"

export const dynamic = "force-dynamic"

export default async function AttributeDetail({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  const access = await requireLevelUpAccess()
  const tz = resolveTimeZone((await cookies()).get(TZ_COOKIE)?.value)
  if (!access) notFound()
  const { card, profile } = await loadBundle(access.workspaceId)
  const attr = card.attributes.find((a) => a.key === key)
  if (!attr) notFound()

  const populations: Array<{ key: ReferencePopulation; label: string; note: string }> = [
    { key: "human", label: "Human", note: "vs the whole adult population — the honest one" },
    { key: "trained", label: "Trained", note: "vs people who train this. Always lower, sometimes brutally" },
    { key: "age", label: "Age-adjusted", note: "vs your own age cohort — the real game after 40" },
  ]

  return (
    <div className="wrap" style={{ paddingBottom: 80 }}>
      <div style={{ padding: "24px 0" }}>
        <Link href="/" className="mono mono-faint">← Card</Link>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 24 }}>
        <div>
          <h1 className="serif" style={{ fontSize: 40, margin: 0 }}>{attr.label}</h1>
          <Mono faint>{ATTRIBUTE_TAGLINE[attr.key as AttributeKey]}</Mono>
        </div>
        <Stat
          rating={attr.rating}
          display={attr.displayRating}
          lower={attr.lower}
          upper={attr.upper}
          letter={attr.rank.letter}
          band={`${attr.rank.band} · ${attr.confidence.label}`}
          size={72}
          gated={attr.cap != null}
        />
      </div>

      {attr.cap != null && attr.capReason && <CapNotice cap={attr.cap} reason={attr.capReason} />}

      {attr.provisional > 0 && attr.verifiedCeiling != null && (
        <Panel style={{ marginTop: 16 }}>
          <Mono>Evidence stack</Mono>
          <div style={{ display: "grid", gap: 6, marginTop: 12, fontSize: 13, color: "var(--ink-dim)" }}>
            <div>├ from combine — verified ceiling <b style={{ color: "var(--ink)" }}>{attr.verifiedCeiling}</b></div>
            <div>├ from training — provisional <span style={{ color: "var(--vermillion)" }}>+{attr.provisional}</span></div>
            <div>└ next ceiling raise — <Link href="/combine" style={{ color: "var(--ink)" }}>run a combine</Link></div>
          </div>
        </Panel>
      )}

      {/* Sub-ratings — residuals and independent measures, never restatements. */}
      {attr.subRatings.length > 0 && (
        <>
          <div style={{ padding: "26px 0 8px" }}><Mono>Sub-ratings</Mono></div>
          <div style={{ borderTop: "1px solid var(--line)" }}>
            {attr.subRatings.map((s) => (
              <div key={s.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderBottom: "1px solid var(--line)" }}>
                <div>
                  <div style={{ fontSize: 15 }}>{s.label}</div>
                  {s.detail && <Mono faint style={{ fontSize: 9 }}>{s.detail}</Mono>}
                </div>
                {s.rating != null ? (
                  <span className="display tabular" style={{ fontSize: 28 }}>{s.rating}</span>
                ) : (
                  <Mono faint>— insufficient data</Mono>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Raw measurements — one tap deeper, across all three reference populations. */}
      <div style={{ padding: "26px 0 8px" }}><Mono>Raw measurements</Mono></div>
      {attr.evidence.length === 0 ? (
        <Panel><Mono faint>No measurements logged yet for {attr.label}.</Mono></Panel>
      ) : (
        <div style={{ borderTop: "1px solid var(--line)" }}>
          {attr.evidence.map((e) => {
            const def = getTest(e.testKey)
            const perPop = def
              ? populations.map((p) => ({
                  ...p,
                  rating: Math.round(
                    rateTest({ def, value: def.relative ? e.value * (profile.bodyweightKg ?? 1) : e.value, bodyweightKg: profile.bodyweightKg, age: card.age, sex: profile.sex, population: p.key }),
                  ),
                }))
              : []
            return (
              <div key={e.testKey} style={{ padding: "16px 0", borderBottom: "1px solid var(--line)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <div style={{ fontSize: 15 }}>{e.label}</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span className="display tabular" style={{ fontSize: 22 }}>{e.value}</span>
                    <Mono faint>{e.unit}</Mono>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 24, marginTop: 10 }}>
                  {perPop.map((p) => (
                    <div key={p.key} title={p.note}>
                      <span className="display tabular" style={{ fontSize: 20, color: p.key === "human" ? "var(--ink)" : "var(--ink-dim)" }}>{p.rating}</span>
                      <div><Mono faint style={{ fontSize: 8 }}>{p.label}</Mono></div>
                    </div>
                  ))}
                  <div style={{ marginLeft: "auto", textAlign: "right", alignSelf: "center" }}>
                    <Mono faint style={{ fontSize: 9 }}>{e.source} · {new Date(e.measuredAt).toLocaleDateString("en-US", { timeZone: tz })}</Mono>
                  </div>
                </div>
                {e.note && <div style={{ marginTop: 8, fontSize: 12, color: "var(--ink-faint)", maxWidth: 640 }}>{e.note}</div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
