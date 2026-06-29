const appLinks = [
  {
    name: "Persons",
    label: "People",
    href: process.env.NEXT_PUBLIC_PERSONS_URL ?? "http://localhost:3000",
    description: "Relationships and interactions",
  },
  {
    name: "Places",
    label: "Places",
    href: process.env.NEXT_PUBLIC_PLACES_URL ?? "http://localhost:3002",
    description: "Map, visits, and place memory",
  },
  {
    name: "Stuff",
    label: "Items",
    href: process.env.NEXT_PUBLIC_STUFF_URL ?? "http://localhost:3001",
    description: "Objects and inventory",
  },
  {
    name: "Theory of",
    label: "Theory",
    href: process.env.NEXT_PUBLIC_THEORY_URL ?? "http://localhost:3004",
    description: "Living theory of a person",
  },
]

export default function Home() {
  return (
    <main className="page">
      <header className="header">
        <a href="/" className="brand">Life OS</a>
      </header>

      <section className="apps" aria-label="Life OS apps">
        {appLinks.map((app) => (
          <a className="app-link" href={app.href} key={app.name}>
            <span className="app-label">{app.label}</span>
            <span className="app-name">{app.name}</span>
            <span className="app-description">{app.description}</span>
          </a>
        ))}
      </section>
    </main>
  )
}
