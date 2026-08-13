import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { unstable_cache } from 'next/cache'
import { auth } from '../auth'
import { db } from '@life-os/db'
import { LIFE_OS_APP_URLS, lifeOsAppUrl } from '@life-os/auth'
import { LIFE_OS_APPS, resolveTimeZone, TZ_COOKIE, TimezonePicker } from '@life-os/ui'
import ScheduleWidget from '../components/ScheduleWidget'
import CommitmentsWidget from '../components/CommitmentsWidget'
import NudgesWidget from '../components/NudgesWidget'
import PrepareWidget from '../components/PrepareWidget'
import QuickCapture from '../components/QuickCapture'
import ReconciliationWidget from '../components/ReconciliationWidget'
import CapacityBriefWidget from '../components/CapacityBriefWidget'
import CheckIn from '../components/CheckIn'
import WeeklyReview from '../components/WeeklyReview'
import CommunicationsReviewWidget from '../components/CommunicationsReviewWidget'
import DayReviewNavigation from '../components/DayReviewNavigation'
import CustomizableWidgetGrid from '../components/CustomizableWidgetGrid'
import { greetingForHour, parseReviewDay } from '@/lib/daily'

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

export default function HomePage(props: {
  searchParams: Promise<{ day?: string }>
}) {
  return (
    <Suspense fallback={<HomePageSkeleton />}>
      <HomePageContent {...props} />
    </Suspense>
  )
}

async function HomePageContent({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>
}) {
  const session = await auth()
  const localReview = process.env.NODE_ENV !== 'production' && process.env.LIFE_OS_LOCAL_REVIEW === '1'
  if (!session?.user?.email && !localReview) redirect('/login')

  const workspaceId = session?.user?.email
    ? await getWorkspaceId(session.user.email)
    : 'default-workspace'
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
  const { day: requestedDay } = await searchParams
  const reviewDay = parseReviewDay(requestedDay, today, tz)

  return (
    <div className="dashboard-page min-h-screen pb-12">
      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '48px 24px 0' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '48px' }}>
          <div>
            <h1
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'clamp(2rem, 5vw, 3.5rem)',
                fontWeight: 400,
                letterSpacing: '-0.02em',
                lineHeight: 1.1,
                margin: 0,
              }}
            >
              {greeting}, {firstName}
            </h1>
            <p
              style={{
                fontSize: '1rem',
                color: 'var(--ink-3)',
                marginTop: '8px',
                marginBottom: 0,
              }}
            >
              {dateStr}
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '17px', color: 'var(--camel)' }}>Life OS</div>
            <TimezonePicker current={tz} />
          </div>
        </div>

        <QuickCapture />

        <DayReviewNavigation day={reviewDay} tz={tz} />

        <Suspense fallback={<WidgetSkeleton />}>
          <CapacityBriefWidget workspaceId={workspaceId} day={reviewDay} tz={tz} />
        </Suspense>

        {hourInTz < 12 && <CheckIn slot="morning" />}

        <Suspense fallback={<WidgetSkeleton />}>
          <ReconciliationWidget workspaceId={workspaceId} day={reviewDay} tz={tz} />
        </Suspense>

        <Suspense fallback={<WidgetSkeleton />}>
          <CommunicationsReviewWidget workspaceId={workspaceId} personsUrl={personsUrl} />
        </Suspense>

        <CustomizableWidgetGrid
          schedule={
            <Suspense fallback={<WidgetSkeleton />}>
              <ScheduleWidget workspaceId={workspaceId} />
            </Suspense>
          }
          prepare={
            <Suspense fallback={<WidgetSkeleton />}>
              <PrepareWidget workspaceId={workspaceId} />
            </Suspense>
          }
          commitments={
            <Suspense fallback={<WidgetSkeleton />}>
              <CommitmentsWidget workspaceId={workspaceId} personsUrl={personsUrl} />
            </Suspense>
          }
          nudges={
            <Suspense fallback={<WidgetSkeleton />}>
              <NudgesWidget workspaceId={workspaceId} personsUrl={personsUrl} />
            </Suspense>
          }
        />

        {hourInTz >= 17 && <CheckIn slot="evening" />}
        <Suspense fallback={<WidgetSkeleton />}>
          <WeeklyReview workspaceId={workspaceId} />
        </Suspense>

        {/* App nav footer */}
        <div
          style={{
            marginTop: '64px',
            borderTop: '1px solid #2a424c',
            paddingTop: '32px',
          }}
        >
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
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 32px' }}>
            {LIFE_OS_APPS.filter(app => app.key !== 'home').map(app => (
              <a
                key={app.key}
                href={app.key === 'persons' ? personsUrl : lifeOsAppUrl(app.key, app.localUrl)}
                className="dashboard-app-link"
              >
                {app.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function HomePageSkeleton() {
  return (
    <div className="dashboard-page min-h-screen pb-12">
      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '48px 24px 0' }}>
        <div style={{ marginBottom: '48px' }}>
          <div style={{ width: '280px', height: '56px', borderRadius: '10px', background: 'rgba(247, 244, 238, 0.08)' }} />
          <div style={{ width: '180px', height: '18px', borderRadius: '8px', marginTop: '12px', background: 'rgba(247, 244, 238, 0.06)' }} />
        </div>
        <WidgetSkeleton />
      </div>
    </div>
  )
}

function WidgetSkeleton() {
  return (
    <div
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
