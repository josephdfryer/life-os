import { ConnectionsClient } from './ConnectionsClient'

export const metadata = { title: 'Connections · LifeOS' }

export default function ConnectionsPage() {
  return <main className="stream-page"><div className="stream-container">
    <p className="still-eyebrow">One place for every account</p>
    <h1 className="stream-heading-title">Connections</h1>
    <p className="stream-intro">Connect or reconnect an account here. Last data, collector freshness, and stream status live in <a href="/admin/health">system health</a>.</p>
    <ConnectionsClient />
  </div></main>
}
