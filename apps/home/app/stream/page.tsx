import StreamClient from '../../components/StreamClient'

export const metadata = {
  title: 'Stream · Life OS',
}

export default function StreamPage() {
  return (
    <main className="stream-page">
      <div className="stream-container">
        <div className="stream-heading">
          <div>
            <p className="still-eyebrow">The graph</p>
            <h1>Stream</h1>
            <p className="stream-intro">Everything that has happened, in one chronological view.</p>
          </div>
          <a className="still-button still-button-secondary" href="/">Today</a>
        </div>
        <StreamClient />
      </div>
    </main>
  )
}
