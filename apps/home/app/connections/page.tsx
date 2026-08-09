import { ConnectionsClient } from './ConnectionsClient'

export const metadata = { title: 'Connections · Life OS' }

export default function ConnectionsPage() {
  return <main className="stream-page"><div className="stream-container">
    <p className="still-eyebrow">One place for every account</p>
    <h1 className="stream-heading-title">Connections</h1>
    <p className="stream-intro">See what Life OS can read, when it last refreshed, and where a connection needs attention.</p>
    <ConnectionsClient />
  </div></main>
}
