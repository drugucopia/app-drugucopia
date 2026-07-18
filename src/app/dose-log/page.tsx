'use client'

import { Suspense, useMemo, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { Bell, Activity, History, BarChart3 } from 'lucide-react'
import { useDoseStore } from '@/store/dose-store'
import { useReminderStore } from '@/store/reminder-store'
import { PullToRefresh } from '@/components/ui/PullToRefresh'

// Lazy-load heavy client-only components
const DoseHistory = dynamic(
  () => import('@/components/dose-history').then((m) => m.DoseHistory),
  { ssr: false, loading: () => null },
)
const DoseStats = dynamic(
  () => import('@/components/dose-stats').then((m) => m.DoseStats),
  { ssr: false, loading: () => null },
)
const IntensityTimelineChart = dynamic(
  () => import('@/components/intensity-timeline-chart').then((m) => m.IntensityTimelineChart),
  { ssr: false, loading: () => null },
)
const ActiveReminders = dynamic(
  () => import('@/components/active-reminders').then((m) => m.ActiveReminders),
  { ssr: false, loading: () => null },
)
const ReminderSettings = dynamic(
  () => import('@/components/reminder-settings').then((m) => m.ReminderSettings),
  { ssr: false, loading: () => null },
)
const SyncConflicts = dynamic(
  () => import('@/components/sync-conflicts').then((m) => m.SyncConflicts),
  { ssr: false, loading: () => null },
)

// ─── Tab model ─────────────────────────────────────────────────────────────

type TrackTab = 'session' | 'history' | 'reminders' | 'insights'

interface TabDef {
  id: TrackTab
  label: string
  icon: typeof Activity
}

const TABS: TabDef[] = [
  { id: 'session', label: 'Active Session', icon: Activity },
  { id: 'history', label: 'History', icon: History },
  { id: 'reminders', label: 'Reminders', icon: Bell },
  { id: 'insights', label: 'Insights', icon: BarChart3 },
]

// ─── Hero ──────────────────────────────────────────────────────────────────

function TrackHero() {
  const doses = useDoseStore((state) => state.doses)
  const schedules = useReminderStore((state) => state.schedules)
  const activeReminders = useReminderStore((state) => state.activeReminders)

  const todayKey = new Date().toISOString().slice(0, 10)
  const todayCount = useMemo(() => {
    // Dose store writes are newest-first. Stop as soon as we pass today's
    // UTC key instead of filtering a potentially very large history.
    let count = 0
    for (const dose of doses) {
      const doseDay = dose.timestamp.slice(0, 10)
      if (doseDay === todayKey) count++
      else if (doseDay < todayKey) break
    }
    return count
  }, [doses, todayKey])
  const activeCount = useMemo(
    () => activeReminders.filter((reminder) => reminder.status !== 'dismissed').length,
    [activeReminders],
  )

  return (
    <section className="hero rounded-box border border-base-300 bg-base-200/60 shadow-sm">
      <div className="hero-content w-full flex-col items-start gap-4 p-4 md:p-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-2xl space-y-2">
          <span className="badge badge-outline badge-sm">Track workspace</span>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            Dose log, reminders & session view
          </h1>
          <p className="text-sm text-neutral-content md:text-base">
            Review active reminders, follow your current session timeline, and keep your dose
            history organized in one place.
          </p>
        </div>

        {/* Glanceable stats — semantic daisyUI tokens, no hard-coded palette. */}
        <div className="stats stats-vertical border border-base-300 bg-base-100 shadow-sm sm:stats-horizontal">
          <div className="stat">
            <div className="stat-title">Total logs</div>
            <div className="stat-value text-2xl">{doses.length}</div>
            <div className="stat-desc">All recorded doses</div>
          </div>
          <div className="stat">
            <div className="stat-title">Today</div>
            <div className="stat-value text-2xl">{todayCount}</div>
            <div className="stat-desc">Doses logged today</div>
          </div>
          <div className="stat">
            <div className="stat-title">Active reminders</div>
            <div className="stat-value text-2xl">{activeCount}</div>
            <div className="stat-desc">Running or fired timers</div>
          </div>
          <div className="stat">
            <div className="stat-title">Schedules</div>
            <div className="stat-value text-2xl">{schedules.length}</div>
            <div className="stat-desc">Saved reminder rules</div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Tabs ──────────────────────────────────────────────────────────────────

function TabButton({
  tab,
  active,
  onClick,
}: {
  tab: TabDef
  active: boolean
  onClick: () => void
}) {
  const Icon = tab.icon
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`tab tab-bordered gap-1.5 min-h-[44px] ${active ? 'tab-active text-primary' : 'text-base-content'}`}
    >
      <Icon className="h-4 w-4" />
      <span>{tab.label}</span>
    </button>
  )
}

// ─── Active Session tab ────────────────────────────────────────────────────

function ActiveSessionTab() {
  return (
    <div className="space-y-6">
      <ActiveReminders />

      <section className="card border border-base-300 bg-base-100 shadow-sm">
        <div className="card-body gap-1.5 p-4 pb-0 md:p-5 md:pb-0">
          <h2 className="card-title text-base font-semibold">
            <Activity className="h-5 w-5 text-primary" />
            Intensity Timeline
          </h2>
          <p className="text-sm text-neutral-content">
            Live view of active doses and their estimated intensity over time.
          </p>
        </div>
        <div className="card-body p-4 pt-4 md:p-5 md:pt-4">
          <IntensityTimelineChart />
        </div>
      </section>
    </div>
  )
}

// ─── Reminders tab ─────────────────────────────────────────────────────────

function RemindersTab() {
  return (
    <div className="space-y-6">
      <ActiveReminders />

      <section className="card border border-base-300 bg-base-100 shadow-sm">
        <div className="card-body gap-1.5 p-4 pb-0 md:p-5 md:pb-0">
          <h2 className="card-title text-base font-semibold">
            <Activity className="h-5 w-5 text-primary" />
            Reminder Settings
          </h2>
          <p className="text-sm text-neutral-content">
            Adjust auto-start behavior, notification permissions, sounds, and recurring schedules.
          </p>
        </div>
        <div className="card-body p-4 pt-4 md:p-5 md:pt-4">
          <ReminderSettings />
        </div>
      </section>
    </div>
  )
}

// ─── Insights tab ──────────────────────────────────────────────────────────

function InsightsTab() {
  return (
    <div className="space-y-6">
      <DoseStats />
      <SyncConflicts />
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────

function DoseLogPageContent() {
  const [tab, setTab] = useState<TrackTab>('session')
  const router = useRouter()

  const handleRefresh = useCallback(async () => {
    router.refresh()
  }, [router])

  return (
    <PullToRefresh onRefresh={handleRefresh} threshold={60}>
      <div className="container mx-auto px-4 py-6 lg:px-6 lg:py-10">
        <div className="mx-auto max-w-5xl space-y-6">
          <TrackHero />

          {/* Sync conflicts surface above the tabs so they can't be missed. */}
          <SyncConflicts />

          {/* Tab bar — single source of truth for navigation within Track. */}
          <div
            role="tablist"
            aria-label="Track sections"
            className="tabs tabs-boxed w-full justify-center overflow-x-auto border border-base-300 bg-base-200/60"
          >
            {TABS.map((t) => (
              <TabButton key={t.id} tab={t} active={tab === t.id} onClick={() => setTab(t.id)} />
            ))}
          </div>

          <div role="tabpanel">
            {tab === 'session' && <ActiveSessionTab />}
            {tab === 'history' && <DoseHistory />}
            {tab === 'reminders' && <RemindersTab />}
            {tab === 'insights' && <InsightsTab />}
          </div>
        </div>
      </div>
    </PullToRefresh>
  )
}

export default function DoseLogPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="loading loading-spinner loading-lg text-primary" />
        </div>
      }
    >
      <DoseLogPageContent />
    </Suspense>
  )
}
