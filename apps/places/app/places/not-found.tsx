export default function PlaceNotFound() {
  return (
    <main className="places-route-state">
      <span aria-hidden="true">○</span>
      <h1>Place not found</h1>
      <p>It may have moved, been merged, or belong to another workspace.</p>
      <a href="/places">Return to Places</a>
    </main>
  )
}
