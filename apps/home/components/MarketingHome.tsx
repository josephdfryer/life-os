import { LifeOSMark } from '@life-os/ui'

const PRIMITIVES = [
  { name: 'Person', desc: 'A human in your life — attributes, closeness, history.' },
  { name: 'Place', desc: 'A location at any scale, Earth to shelf, self-referencing.' },
  { name: 'Item', desc: 'A physical object you own, with acquisition and location.' },
  { name: 'Event', desc: 'Something that happened, independent of any one participant.' },
  { name: 'Plan', desc: 'Declared intent — a goal, commitment, or prediction.' },
  { name: 'Group', desc: 'A collective identity — family, team, company, community.' },
  { name: 'State', desc: 'A timestamped condition on any entity, never a mutable field.' },
  { name: 'Note', desc: 'A raw captured thought, before it resolves into structure.' },
]

const PRINCIPLES = [
  { title: 'Derived over stored', desc: 'Net worth, relationship health, fulfillment — none of these are fields. They are queries, always current by construction.' },
  { title: 'Provenance is sacred', desc: 'Every conclusion traces back to the raw thing that produced it. A model you can’t audit is not one you can trust.' },
  { title: 'Sovereignty', desc: 'Local-first, plain-text, zero recurring cost, no lock-in. A foundational model of who you are should be yours to keep.' },
]

const SIGN_IN_URL = 'https://home.lacollecteur.com/login'

export default function MarketingHome() {
  return (
    <div className="marketing-page">
      <header className="marketing-nav">
        <span className="marketing-wordmark">
          <LifeOSMark size={19} className="marketing-wordmark-mark" />
          LifeOS
        </span>
        <a className="marketing-nav-signin" href={SIGN_IN_URL}>Sign in</a>
      </header>

      <main>
        <section className="marketing-hero">
          <p className="marketing-eyebrow">A foundation, not a to-do list</p>
          <h1>Live intentionally.<br />Let the system hold the context.</h1>
          <p className="marketing-hero-copy">
            LifeOS is a structured, continuously updated model of who you are, what you care
            about, and where you&rsquo;re trying to go — the people, places, plans, and events of
            an actual life, held together with honesty about the gap between what you intend and
            what you do.
          </p>
          <div className="marketing-hero-actions">
            <a className="marketing-button-primary" href={SIGN_IN_URL}>Sign in with Google</a>
          </div>
        </section>

        <section className="marketing-section">
          <p className="marketing-eyebrow">The premise</p>
          <h2>Observation is not context.</h2>
          <p className="marketing-prose">
            Most tools that watch your life are very capable observers — they see what you do
            and gather data. But observation only tells you what happened; it can&rsquo;t tell you
            what it means. Meaning requires a foundation: a living model built from what you
            declare, what you actually do, the real people and places in your life, and the
            tension between the two. That tension — the gap between the life you say you want and
            the one your calendar and inbox say you&rsquo;re living — is where the most useful
            intelligence lives.
          </p>
        </section>

        <section className="marketing-section">
          <p className="marketing-eyebrow">The model</p>
          <h2>Eight primitives. One edge.</h2>
          <p className="marketing-prose">
            The data model resists complexity on purpose. Every primitive earned its place by
            surviving hard questions before it was allowed in.
          </p>
          <div className="marketing-primitive-grid">
            {PRIMITIVES.map((p) => (
              <div key={p.name} className="marketing-primitive-card">
                <h3>{p.name}</h3>
                <p>{p.desc}</p>
              </div>
            ))}
          </div>
          <p className="marketing-prose marketing-prose-tight">
            Connected by <strong>Interaction</strong> — the universal edge that links any two of
            the above, carrying its own emotional weight, outcome, and story.
          </p>
        </section>

        <section className="marketing-section">
          <p className="marketing-eyebrow">What breaks the tie</p>
          <h2>Principles, not features.</h2>
          <div className="marketing-principle-grid">
            {PRINCIPLES.map((p) => (
              <div key={p.title} className="marketing-principle-card">
                <h3>{p.title}</h3>
                <p>{p.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="marketing-cta">
          <h2>Not another expensive to-do list.</h2>
          <p className="marketing-prose">
            A prior model of you, rich and honest enough that any system can reason against it on
            your behalf.
          </p>
          <a className="marketing-button-primary" href={SIGN_IN_URL}>Sign in with Google</a>
        </section>
      </main>

      <footer className="marketing-footer">
        <span>&copy; 2026 LifeOS</span>
        <nav aria-label="Legal">
          <a href="/privacy">Privacy Policy</a>
          <a href="/terms">Terms of Service</a>
        </nav>
      </footer>
    </div>
  )
}
