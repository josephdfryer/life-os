export default function PlacesLoading() {
  return (
    <main className="places-loading" aria-busy="true" aria-label="Loading Places">
      <div className="places-loading-title" />
      <div className="places-loading-toolbar" />
      <div className="places-loading-grid">
        <div className="places-loading-map" />
        <div className="places-loading-results">
          {Array.from({ length: 6 }, (_, index) => <div key={index} />)}
        </div>
      </div>
    </main>
  )
}
