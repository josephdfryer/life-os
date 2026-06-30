export default function Home() {
  return (
    <main style={{ fontFamily: "monospace", padding: "2rem" }}>
      <h1>Life OS Assistant</h1>
      <p>WhatsApp ↔ Claude bridge. Send a WhatsApp message to get started.</p>
      <p>
        <a href="/api/health">Health check</a>
      </p>
    </main>
  )
}
