import Link from "next/link"
import { requireLevelUpAccess } from "@/lib/access"
import { cookies } from "next/headers"
import { resolveTimeZone, TZ_COOKIE } from "@life-os/ui"
import { loadBundle, BUILDS, ATTRIBUTE_TAGLINE, type BuildKey } from "@life-os/level-up"
import { AttributeLink, Delta, Mono, Panel, Stat } from "@/components/display"
import BuildSelector from "@/components/BuildSelector"
import WarmConcrete from "@/components/WarmConcrete"

export const dynamic = "force-dynamic"

export default async function FitnessSkillPage() {
  const access = await requireLevelUpAccess()
  const tz = resolveTimeZone((await cookies()).get(TZ_COOKIE)?.value)
  if (!access) {
    return (
      <WarmConcrete>
        <div className="wrap" style={{ padding: "80px 24px", textAlign: "center" }}>
          <Mono>No Level Up workspace. Sign in from Home.</Mono>
        </div>
      </WarmConcrete>
    )
  }

  const { card, coldStartDone, profileExists, lastCombineAt, combineCount } = await loadBundle(access.workspaceId)
  const build = BUILDS[card.primaryBuild]
  const ovrDelta = card.currentOvr - card.ovr
  const buildRows = (Object.keys(BUILDS) as BuildKey[]).map((k) => ({ key: k, label: BUILDS[k].label, ovr: card.buildOvrs[k] }))

  return (
    <WarmConcrete>
      <div className="wrap" style={{ paddingBottom: 80, paddingTop: 20 }}>
        <Link href="/" className="mono mono-faint" style={{ display: "inline-block", marginBottom: 12 }}>
          ← Character
        </Link>
        <Mono>Skill — Fitness</Mono>

        {(!coldStartDone || !profileExists) && (
          <Link href="/start" style={{ display: "block", marginTop: 20 }}>
            <div style={{ border: "1px solid var(--vermillion)", padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <Mono style={{ color: "var(--vermillion)" }}>Day one — your card is provisional</Mono>
                <div style={{ color: "var(--ink-dim)", fontSize: 13, marginTop: 4 }}>
                  Every rating sits at the median with a wide band. Set up your profile and run a combine to make it real.
                </div>
              </div>
              <span className="btn btn-primary">Start →</span>
            </div>
          </Link>
        )}

        <section style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", padding: "40px 0 28px", flexWrap: "wrap", gap: 24 }}>
          <div>
            <Mono faint>{build.label} OVR</Mono>
            <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginTop: 6 }}>
              <span className="display tabular" style={{ fontSize: 108 }}>{card.ovr}</span>
              <div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <Mono>Now</Mono>
                  <span className="display tabular" style={{ fontSize: 34, color: "var(--ink-dim)" }}>{card.currentOvr}</span>
                  {ovrDelta !== 0 && <Delta value={ovrDelta} />}
                </div>
                {card.form.reasons.length > 0 && (
                  <div style={{ marginTop: 4, maxWidth: 220 }}>
                    <Mono faint style={{ fontSize: 9 }}>{card.form.reasons.join(" · ")}</Mono>
                  </div>
                )}
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              <Mono faint>Archetype — {card.archetype.label}</Mono>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <Mono faint>{combineCount === 0 ? "No combine yet" : `Last combine ${lastCombineAt ? new Date(lastCombineAt).toLocaleDateString("en-US", { timeZone: tz }) : "—"}`}</Mono>
            <div style={{ marginTop: 10 }}>
              <Link href="/combine" className="btn btn-primary">Run a Combine</Link>
            </div>
          </div>
        </section>

        <BuildSelector builds={buildRows} current={card.primaryBuild} />

        <div style={{ marginTop: 32, borderTop: "1px solid var(--line-strong)" }}>
          {card.attributes.map((a) => (
            <div key={a.key} style={{ borderBottom: "1px solid var(--line)" }}>
              <AttributeLink href={`/attributes/${a.key}`} label={a.label} tagline={ATTRIBUTE_TAGLINE[a.key]}>
                <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                  {a.provisional > 0 && (
                    <Mono faint style={{ fontSize: 9 }}>
                      verified {a.verifiedCeiling} · +{a.provisional} training
                    </Mono>
                  )}
                  {a.cap != null && <Mono style={{ color: "var(--vermillion)", fontSize: 9 }}>cap {a.cap}</Mono>}
                  <div style={{ minWidth: 150 }}>
                    <Stat
                      rating={a.rating}
                      display={a.displayRating}
                      lower={a.lower}
                      upper={a.upper}
                      letter={a.rank.letter}
                      size={38}
                      gated={a.cap != null}
                    />
                  </div>
                </div>
              </AttributeLink>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 32 }}>
          <Panel>
            <Mono>Rank — capability</Mono>
            <p style={{ color: "var(--ink-dim)", fontSize: 13, marginTop: 8 }}>
              What you can do. Moves slowly, and never because you showed up. Only a combine raises a verified ceiling; typed training data moves you within your proven range.
            </p>
          </Panel>
          <Panel style={{ borderColor: "var(--line-strong)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <Mono style={{ color: "var(--gold)" }}>Career — consistency</Mono>
              <span className="display" style={{ fontSize: 30 }}>{card.behavioral.streakWeeks}<span className="mono" style={{ fontSize: 10 }}> wk streak</span></span>
            </div>
            <div style={{ display: "flex", gap: 28, marginTop: 14 }}>
              <div>
                <span className="display" style={{ fontSize: 26 }}>{card.behavioral.consistencyPct}%</span>
                <div><Mono faint style={{ fontSize: 9 }}>consistency (12 wk)</Mono></div>
              </div>
              <div>
                <span className="display" style={{ fontSize: 26, textTransform: "capitalize" }}>{card.behavioral.loadTolerance}</span>
                <div><Mono faint style={{ fontSize: 9 }}>load tolerance</Mono></div>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </WarmConcrete>
  )
}
