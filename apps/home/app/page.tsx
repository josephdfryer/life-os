import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { auth } from '../auth'
import { db } from '@life-os/db'
import ScheduleWidget from '../components/ScheduleWidget'
import ActionItemsWidget from '../components/ActionItemsWidget'
import InboxWidget from '../components/InboxWidget'
import NudgesWidget from '../components/NudgesWidget'

export const revalidate = 60

async function getWorkspaceId(email: string): Promise<string> {
  const member = await db.workspaceMember.findFirst({
    where: { user: { email }, status: 'active' },
    select: { workspaceId: true },
    orderBy: { createdAt: 'asc' },
  })
  return member?.workspaceId ?? 'default-workspace'
}

export default async function HomePage() {
  const session = await auth()
  if (!session?.user?.email) redirect('/login')

  const workspaceId = await getWorkspaceId(session.user.email)
  const firstName = session.user.name?.split(' ')[0] ?? 'there'

  const today = new Date()
  const dateStr = today.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  const personsUrl = process.env.NEXT_PUBLIC_PERSONS_URL ?? 'http://localhost:3000'

  return (
    <div className="min-h-screen pb-12" style={{ background: '#0d0d0d', color: '#fff' }}>
      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '48px 24px 0' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '48px' }}>
          <div>
            <h1
              style={{
                fontFamily: 'var(--font-playfair)',
                fontSize: 'clamp(2rem, 5vw, 3.5rem)',
                fontWeight: 600,
                letterSpacing: '-0.02em',
                lineHeight: 1.1,
                margin: 0,
              }}
            >
              Good morning, {firstName}
            </h1>
            <p
              style={{
                fontFamily: 'var(--font-dm-mono)',
                fontSize: '1rem',
                color: '#a1a1aa',
                marginTop: '8px',
                marginBottom: 0,
              }}
            >
              {dateStr}
            </p>
          </div>
          <div style={{ fontSize: '12px', color: '#52525b' }}>Life OS</div>
        </div>

        {/* Widgets grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 520px), 1fr))',
            gap: '32px',
          }}
        >
          {/* Left column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
            <Suspense fallback={<WidgetSkeleton />}>
              <ScheduleWidget workspaceId={workspaceId} />
            </Suspense>
            <Suspense fallback={<WidgetSkeleton />}>
              <ActionItemsWidget workspaceId={workspaceId} personsUrl={personsUrl} />
            </Suspense>
          </div>

          {/* Right column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
            <Suspense fallback={<WidgetSkeleton />}>
              <InboxWidget workspaceId={workspaceId} personsUrl={personsUrl} />
            </Suspense>
            <Suspense fallback={<WidgetSkeleton />}>
              <NudgesWidget workspaceId={workspaceId} personsUrl={personsUrl} />
            </Suspense>
          </div>
        </div>

        {/* App nav footer */}
        <div
          style={{
            marginTop: '64px',
            borderTop: '1px solid #27272a',
            paddingTop: '32px',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-dm-mono)',
              fontSize: '11px',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: '#52525b',
              marginBottom: '16px',
            }}
          >
            Apps
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 32px' }}>
            {[
              { label: 'Persons', href: personsUrl },
              { label: 'Places', href: process.env.NEXT_PUBLIC_PLACES_URL ?? 'http://localhost:3002' },
              { label: 'Stuff', href: process.env.NEXT_PUBLIC_STUFF_URL ?? 'http://localhost:3001' },
              { label: 'Theory of', href: process.env.NEXT_PUBLIC_THEORY_URL ?? 'http://localhost:3004' },
            ].map(({ label, href }) => (
              <a
                key={label}
                href={href}
                style={{ fontSize: '14px', color: '#a1a1aa', textDecoration: 'none' }}
                onMouseOver={(e) => (e.currentTarget.style.color = '#fff')}
                onMouseOut={(e) => (e.currentTarget.style.color = '#a1a1aa')}
              >
                {label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function WidgetSkeleton() {
  return (
    <div
      style={{
        background: 'rgba(24,24,27,0.5)',
        border: '1px solid #27272a',
        borderRadius: '24px',
        padding: '32px',
      }}
    >
      <div
        style={{
          height: '28px',
          background: '#27272a',
          borderRadius: '6px',
          width: '192px',
          marginBottom: '24px',
          animation: 'pulse 2s infinite',
        }}
      />
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            height: '64px',
            background: 'rgba(39,39,42,0.5)',
            borderRadius: '16px',
            marginBottom: '16px',
            animation: 'pulse 2s infinite',
          }}
        />
      ))}
    </div>
  )
}
