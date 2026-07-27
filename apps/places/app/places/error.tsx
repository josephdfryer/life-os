"use client"

export default function PlacesError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="places-route-state" role="alert">
      <span aria-hidden="true">!</span>
      <h1>Places hit an unexpected problem</h1>
      <p>Your Places were not changed. Try loading this screen again.</p>
      <div>
        <button type="button" onClick={reset}>Try again</button>
        <a href="/places">Return to Places</a>
      </div>
    </main>
  )
}
