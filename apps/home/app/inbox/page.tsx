import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { db } from '@life-os/db'
import { workspaceForHomeRequest } from '@/lib/request-access'
import FederatedInbox, { type InboxItem } from '../../components/FederatedInbox'

export const metadata = { title: 'Inbox · Life OS' }

export default function InboxPage() {
  return <Suspense fallback={<InboxFallback />}><InboxContent /></Suspense>
}

async function InboxContent() {
  const workspaceId = await workspaceForHomeRequest()
  if (!workspaceId) redirect('/login')

  const [staged, suggestions, visits, plans, mentions, claims] = await Promise.all([
    safeQueue('communications', () => db.stagedInteraction.findMany({
      where: { workspaceId, status: { in: ['pending', 'blocked'] }, type: { not: 'financial' } },
      orderBy: [{ priority: 'asc' }, { timestamp: 'desc' }],
      take: 100,
      select: { id: true, source: true, itemType: true, summary: true, body: true, contactName: true, timestamp: true, confidence: true, priority: true },
    })),
    safeQueue('notes', () => db.noteSuggestion.findMany({
      where: { workspaceId, status: 'pending' },
      orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
      take: 100,
      select: { id: true, kind: true, title: true, payload: true, createdAt: true, confidence: true },
    })),
    safeQueue('places', () => db.importStagedVisit.findMany({
      where: { workspaceId, status: 'pending' },
      orderBy: [{ confidence: 'desc' }, { startedAt: 'desc' }],
      take: 100,
      select: { id: true, placeName: true, placeAddress: true, startedAt: true, confidence: true },
    })),
    safeQueue('calendar', () => db.plan.findMany({
      where: { workspaceId, externalSource: 'google-calendar', reconciliationStatus: 'pending', fulfilledBy: null, status: 'active' },
      orderBy: { scheduledStart: 'desc' },
      take: 100,
      select: { id: true, text: true, scheduledStart: true, createdAt: true },
    })),
    // File evidence was missing from the inbox entirely, so unresolved identities
    // and unreviewed claims accumulated with no surface that showed them.
    safeQueue('file identities', () => db.fileEntityMention.findMany({
      where: { workspaceId, resolutionStatus: 'unresolved', sourceFile: { archivedAt: null } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, sourceText: true, entityType: true, role: true, confidence: true, createdAt: true },
    })),
    safeQueue('file claims', () => db.evidenceClaim.findMany({
      where: { workspaceId, status: 'unreviewed', sourceFile: { archivedAt: null } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, assertion: true, classification: true, confidence: true, createdAt: true },
    })),
  ])

  const items: InboxItem[] = [
    ...staged.map(item => ({
      id: item.id,
      source: sourceLabel(item.source),
      sourceKey: 'staged_interaction' as const,
      primitive: item.itemType || 'interaction',
      title: item.summary || item.contactName || 'Unmatched communication',
      detail: item.body || item.contactName || 'Staged interaction awaiting review',
      timestamp: item.timestamp.toISOString(),
      confidence: item.confidence,
      priority: item.priority,
    })),
    ...suggestions.map(item => ({
      id: item.id,
      source: 'Notes',
      sourceKey: 'note_suggestion' as const,
      primitive: item.kind,
      title: item.title,
      detail: suggestionDetail(item.payload),
      timestamp: item.createdAt.toISOString(),
      confidence: item.confidence,
      priority: 3,
    })),
    ...visits.map(item => ({
      id: item.id,
      source: 'Places',
      sourceKey: 'import_staged_visit' as const,
      primitive: 'place',
      title: item.placeName || 'Unresolved visit',
      detail: item.placeAddress || 'A visit is waiting for place resolution',
      timestamp: item.startedAt.toISOString(),
      confidence: item.confidence,
      priority: 3,
    })),
    ...plans.map(item => ({
      id: item.id,
      source: 'Calendar',
      sourceKey: 'calendar_reconciliation' as const,
      primitive: 'event',
      title: item.text,
      detail: 'Calendar Plan needs a happened, changed, or cancelled decision',
      timestamp: (item.scheduledStart ?? item.createdAt).toISOString(),
      confidence: null,
      priority: 2,
    })),
    ...mentions.map(item => ({
      id: item.id,
      source: 'File identities',
      sourceKey: 'file_evidence' as const,
      primitive: 'identity',
      title: `Who is "${item.sourceText}"?`,
      detail: `Unresolved ${item.entityType.toLowerCase()} mentioned as ${item.role} in a file`,
      timestamp: item.createdAt.toISOString(),
      confidence: item.confidence,
      priority: 3,
    })),
    ...claims.map(item => ({
      id: item.id,
      source: 'File claims',
      sourceKey: 'file_evidence' as const,
      primitive: 'claim',
      title: item.assertion,
      detail: `${item.classification} claim extracted from a file, awaiting review`,
      timestamp: item.createdAt.toISOString(),
      confidence: item.confidence,
      priority: 3,
    })),
  ].sort((a, b) => b.timestamp.localeCompare(a.timestamp))

  return (
    <main className="stream-page">
      <div className="stream-container">
        <div className="stream-heading">
          <div>
            <p className="still-eyebrow">The control plane</p>
            <h1>Inbox</h1>
            <p className="stream-intro">One quiet place to see what needs your judgment.</p>
          </div>
          <span className="inbox-count">{items.length} to review</span>
        </div>
        <FederatedInbox items={items} />
      </div>
    </main>
  )
}

async function safeQueue<T>(name: string, read: () => Promise<T[]>): Promise<T[]> {
  try {
    return await read()
  } catch (error) {
    console.warn(`[home/inbox] ${name} legacy queue unavailable; continuing with the other queues`, error)
    return []
  }
}

function InboxFallback() {
  return <main className="stream-page"><div className="stream-container"><p className="still-eyebrow">The control plane</p><h1>Inbox</h1><div className="stream-message">Loading review items…</div></div></main>
}

function sourceLabel(source: string) {
  if (source === 'imessage') return 'iMessage'
  if (source === 'gmail') return 'Email'
  if (source === 'whatsapp') return 'WhatsApp'
  return source.charAt(0).toUpperCase() + source.slice(1)
}

function suggestionDetail(payload: string) {
  try {
    const parsed = JSON.parse(payload) as { description?: string; reason?: string }
    return parsed.description || parsed.reason || 'A note-derived suggestion is awaiting review'
  } catch {
    return 'A note-derived suggestion is awaiting review'
  }
}
