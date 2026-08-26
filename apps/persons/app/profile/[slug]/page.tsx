import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { Avatar } from "@life-os/ui"
import { getPublicProfileBySlug } from "@/server/domain/public-profile"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const card = await getPublicProfileBySlug(slug)
  if (!card) return { title: "Profile not found" }
  const name = `${card.first} ${card.last}`.trim()
  return {
    title: name,
    description: [card.title, card.company].filter(Boolean).join(" at ") || "Digital business card",
  }
}

const LINK_FIELDS: { key: keyof NonNullable<Awaited<ReturnType<typeof getPublicProfileBySlug>>>; label: string; toHref: (v: string) => string }[] = [
  { key: "website", label: "Website", toHref: v => v.startsWith("http") ? v : `https://${v}` },
  { key: "linkedin", label: "LinkedIn", toHref: v => v.startsWith("http") ? v : `https://linkedin.com/in/${v}` },
  { key: "twitter", label: "Twitter / X", toHref: v => v.startsWith("http") ? v : `https://x.com/${v.replace(/^@/, "")}` },
  { key: "instagram", label: "Instagram", toHref: v => v.startsWith("http") ? v : `https://instagram.com/${v.replace(/^@/, "")}` },
  { key: "facebook", label: "Facebook", toHref: v => v.startsWith("http") ? v : `https://facebook.com/${v}` },
]

export default async function PublicProfilePage({ params }: Params) {
  const { slug } = await params
  const card = await getPublicProfileBySlug(slug)
  if (!card) notFound()

  const name = `${card.first} ${card.last}`.trim()

  return (
    <div style={{
      minHeight: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "40px 20px",
      background: "var(--bg)",
    }}>
      <div style={{
        width: "100%",
        maxWidth: "380px",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "18px",
        padding: "36px 30px",
        textAlign: "center",
      }}>
        <Avatar
          name={name}
          size="lg"
          color={card.colorSoft ?? undefined}
          textColor={card.color ?? undefined}
          style={{ borderRadius: "50%", margin: "0 auto 18px", border: `1.5px solid ${card.color ?? "var(--border)"}22` }}
        />

        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "24px", fontWeight: 600, color: "var(--ink)", margin: "0 0 4px" }}>
          {name}
        </h1>

        {card.nickname && (
          <div style={{ fontSize: "12px", color: "var(--ink-4)", marginBottom: "8px" }}>aka {card.nickname}</div>
        )}

        {(card.title || card.headline || card.company) && (
          <div style={{ fontSize: "13px", color: "var(--ink-3)", marginBottom: "4px" }}>
            {card.title ?? card.headline}
            {card.title && card.company ? ` at ${card.company}` : !card.title && card.company ? card.company : ""}
          </div>
        )}

        {card.location && (
          <div style={{ fontSize: "12px", color: "var(--ink-4)", marginBottom: "18px" }}>{card.location}</div>
        )}

        {LINK_FIELDS.some(f => card[f.key]) && (
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "8px", marginTop: "18px", paddingTop: "18px", borderTop: "1px solid var(--separator)" }}>
            {LINK_FIELDS.filter(f => card[f.key]).map(f => (
              <a
                key={f.key}
                href={f.toHref(card[f.key] as string)}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: "11px",
                  color: card.color ?? "var(--accent)",
                  background: card.colorSoft ?? "var(--surface2)",
                  padding: "6px 12px",
                  borderRadius: "20px",
                  textDecoration: "none",
                  fontWeight: 500,
                }}
              >
                {f.label}
              </a>
            ))}
          </div>
        )}

        <div style={{ marginTop: "26px", fontSize: "10px", color: "var(--ink-4)" }}>
          Digital business card via LifeOS
        </div>
      </div>
    </div>
  )
}
