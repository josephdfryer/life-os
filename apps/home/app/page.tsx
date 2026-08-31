import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { cookies, headers } from 'next/headers'
import { unstable_cache } from 'next/cache'
import { auth } from '../auth'
import { db } from '@life-os/db'
import { LIFE_OS_APP_URLS, lifeOsAppUrl } from '@life-os/auth'
import { AppMark, LIFE_OS_APPS, resolveTimeZone, TZ_COOKIE, TimezonePicker } from '@life-os/ui'
import { isMarketingHost } from '@/lib/site'
import MarketingHome from '../components/MarketingHome'
import ScheduleWidget from '../components/ScheduleWidget'
import EventSignalsWidget from '../components/EventSignalsWidget'
import NudgesWidget from '../components/NudgesWidget'
import CommunicationsReviewWidget from '../components/CommunicationsReviewWidget'
import AssistantPanel from '../components/AssistantPanel'
import { greetingForHour } from '@/lib/daily'

async function getWorkspaceId(email: string): Promise<string> {
  return unstable_cache(
    async () => {
      const member = await db.workspaceMember.findFirst({
        where: { user: { email }, status: 'active' },
        select: { workspaceId: true },
        orderBy: { createdAt: 'asc' },
      })
      return member?.workspaceId ?? 'default-workspace'
    },
    [`home-workspace:${email.toLocaleLowerCase()}`],
    { revalidate: 300 },
  )()
}

export default function HomePage() {
  return (
    <Suspense fallback={<HomePageSkeleton />}>
      <HomePageContent />
    </Suspense>
  )
}

async function HomePageContent() {
  if (isMarketingHost((await headers()).get('host'))) {
    return <MarketingHome />
  }

  const session = await auth()
  const localReview = process.env.NODE_ENV !== 'production' && process.env.LIFE_OS_LOCAL_REVIEW === '1'
  if (!session?.user?.email && !localReview) redirect('/login')

  const firstName = session?.user?.name?.split(' ')[0] ?? (localReview ? 'Joseph' : 'there')

  // Master timezone: the shared root-domain `tz` cookie, resolved to a valid
  // IANA zone. Everything time-based on this page reads it — never the server
  // clock (which lives in whatever region Vercel runs the function).
  const tz = resolveTimeZone((await cookies()).get(TZ_COOKIE)?.value)

  const today = new Date()
  const hourInTz = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(today),
  )
  const greeting = greetingForHour(hourInTz)
  const dateStr = today.toLocaleDateString('en-US', {
    timeZone: tz,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  const personsUrl = process.env.NODE_ENV === 'production'
    ? LIFE_OS_APP_URLS.persons
    : lifeOsAppUrl('persons', 'http://localhost:3000')

  return (
    <div className="dashboard-page min-h-screen pb-12">
      <div className="dashboard-page-inner">

        <div className="dashboard-header">
          <div className="dashboard-header-greeting">
            <h1 className="dashboard-greeting-title">
              {greeting}, {firstName}
            </h1>
            <p className="dashboard-greeting-date">
              {dateStr}
            </p>
          </div>
          <div className="dashboard-header-meta">
            <div className="dashboard-wordmark">LifeOS</div>
            <TimezonePicker current={tz} />
          </div>
        </div>

        <div className="dashboard-content-grid">
          <AssistantPanel />
          <Suspense fallback={<DashboardDataSkeleton />}>
            <HomeDataPanels
              email={session?.user?.email}
              localReview={localReview}
              personsUrl={personsUrl}
              tz={tz}
            />
          </Suspense>
        </div>

        {/* App nav footer */}
        <div className="dashboard-apps-footer">
          <div
            style={{
              fontSize: '11px',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: '#6a858f',
              marginBottom: '16px',
            }}
          >
            Apps
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 32px' }}>
            {LIFE_OS_APPS.filter(app => app.key !== 'home').map(app => (
              <a
                key={app.key}
                href={app.key === 'persons' ? personsUrl : lifeOsAppUrl(app.key, app.localUrl)}
                className="dashboard-app-link"
              >
                {/* Marks inherit the link color rather than taking their light-ground
                    accent — on the petrol dashboard those accents go muddy. */}
                <AppMark app={app.key} size={16} />
                {app.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

async function HomeDataPanels({
  email,
  localReview,
  personsUrl,
  tz,
}: {
  email?: string | null
  localReview: boolean
  personsUrl: string
  tz: string
}) {
  const workspaceId = email
    ? await getWorkspaceId(email)
    : localReview
      ? 'default-workspace'
      : null

  if (!workspaceId) return null

  return (
    <>
      <ScheduleWidget workspaceId={workspaceId} personsUrl={personsUrl} tz={tz} />
      <EventSignalsWidget workspaceId={workspaceId} tz={tz} />
      <NudgesWidget workspaceId={workspaceId} personsUrl={personsUrl} />
      <CommunicationsReviewWidget workspaceId={workspaceId} personsUrl={personsUrl} />
    </>
  )
}

function HomePageSkeleton() {
  return (
    <div className="dashboard-page min-h-screen pb-12">
      <div className="dashboard-page-inner">
        <div className="dashboard-header dashboard-header-skeleton">
          <div style={{ width: '280px', height: '56px', borderRadius: '10px', background: 'rgba(247, 244, 238, 0.08)' }} />
          <div style={{ width: '180px', height: '18px', borderRadius: '8px', marginTop: '12px', background: 'rgba(247, 244, 238, 0.06)' }} />
        </div>
        <WidgetSkeleton />
      </div>
    </div>
  )
}

function DashboardDataSkeleton() {
  return (
    <>
      <WidgetSkeleton className="dashboard-schedule-card" />
      <WidgetSkeleton className="dashboard-nudges-card" />
      <WidgetSkeleton className="dashboard-communications-card" />
    </>
  )
}

function WidgetSkeleton({ className }: { className?: string } = {}) {
  return (
    <div
      className={className}
      style={{
        background: '#1a2a35',
        border: '1px solid #2a424c',
        borderRadius: 'var(--radius)',
        padding: '32px',
      }}
    >
      <div
        style={{
          height: '28px',
          background: '#2a424c',
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
            background: 'rgba(42,66,76,0.58)',
            borderRadius: 'var(--radius)',
            marginBottom: '16px',
            animation: 'pulse 2s infinite',
          }}
        />
      ))}
    </div>
  )
}
