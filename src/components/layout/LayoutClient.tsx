'use client'

import { AlertTriangle } from 'lucide-react'
import { useState, useEffect, useSyncExternalStore, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { AppSidebar } from './AppSidebar'
import { TopBar } from './TopBar'
import { BottomNav } from './BottomNav'
import { Toaster } from '@/components/ui/toaster'
import { VisualizerControls } from '@/components/visualizer-controls'
import { MilkdropBackgroundWrapper } from '@/components/milkdrop-background-wrapper'
import { SyncProvider } from '@/contexts/sync-context'
import { ReminderProvider } from '@/components/reminder-provider'
import { CommandPalette } from '@/components/command-palette'
import { OnboardingTour } from '@/components/onboarding-tour'
import { UpdateCheckPopupWrapper } from '@/components/update-check-popup-wrapper'
import { useUIStore } from '@/store/ui-store'

// Keep the logger out of the shell while closed. The module is warmed during
// idle time below so the first deliberate open is normally instant.
const loadDoseLogger = () => import('@/components/dose-logger-modal').then((mod) => mod.DoseLoggerModal)
const DoseLoggerModal = dynamic(loadDoseLogger, { ssr: false, loading: () => null })

interface LayoutClientProps {
  children: ReactNode
}

const DRAWER_ID = 'app-shell-drawer'

export function LayoutClient({ children }: LayoutClientProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [sidebarExpanded, setSidebarExpanded] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('drugucopia-sidebar-expanded') === 'true'
  })
  const { doseLoggerOpen, doseLoggerPreselect, closeDoseLogger, showOnboardingTour, setOnboardingCompleted } = useUIStore()
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  )
  const [isMobile, setIsMobile] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)

  // Warm the chunk without mounting its large form, effects, or store
  // subscriptions. requestIdleCallback is unavailable in some WebViews.
  useEffect(() => {
    const warm = () => { void loadDoseLogger() }
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
      cancelIdleCallback?: (id: number) => void
    }
    if (idleWindow.requestIdleCallback) {
      const id = idleWindow.requestIdleCallback(warm, { timeout: 2500 })
      return () => idleWindow.cancelIdleCallback?.(id)
    }
    const id = window.setTimeout(warm, 1200)
    return () => window.clearTimeout(id)
  }, [])

  // Onboarding tour: auto-open on first visit (when the localStorage
  // flag `drugucopia-tour-complete` is unset). Re-triggerable via the
  // `showOnboardingTour()` store action (Ctrl+Shift+O shortcut below),
  // which sets `showOnboarding` directly inside its keydown handler.
  useEffect(() => {
    try {
      const done = window.localStorage.getItem('drugucopia-tour-complete') === 'true'
      setOnboardingCompleted(done)
      if (!done) {
        const t = window.setTimeout(() => setShowOnboarding(true), 1200)
        return () => window.clearTimeout(t)
      }
    } catch {
      /* ignore */
    }
  }, [setOnboardingCompleted])

  // Ctrl+Shift+O keyboard shortcut to re-open the onboarding tour.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'O' || e.key === 'o')) {
        e.preventDefault()
        showOnboardingTour()
        setShowOnboarding(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showOnboardingTour])

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // ── Android back button: close drawer / dose logger when open ──
  useEffect(() => {
    const handlePopState = () => {
      // If the drawer is open, close it and consume the back navigation
      if (drawerOpen) {
        setDrawerOpen(false)
        return
      }
      // If the dose logger modal is open, close it
      if (doseLoggerOpen) {
        closeDoseLogger()
        return
      }
    }

    // Push a history entry when the drawer/modal opens so the back
    // button has something to pop. When it closes, we don't push.
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [drawerOpen, doseLoggerOpen, closeDoseLogger])

  // Push a history entry when drawer opens (so Android back can pop it)
  useEffect(() => {
    if (drawerOpen) {
      window.history.pushState({ drawerOpen: true }, '')
    }
  }, [drawerOpen])

  // Push a history entry when dose logger opens
  useEffect(() => {
    if (doseLoggerOpen) {
      window.history.pushState({ doseLoggerOpen: true }, '')
    }
  }, [doseLoggerOpen])

  if (!mounted) {
    return (
      <div className="min-h-[100dvh] bg-transparent">
        <div className="flex h-[100dvh] items-center justify-center">
          <div className="loading loading-spinner loading-lg text-primary" />
        </div>
      </div>
    )
  }

  const toggleSidebar = () => {
    const next = !sidebarExpanded
    setSidebarExpanded(next)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('drugucopia-sidebar-expanded', String(next))
    }
  }

  const closeDrawer = () => {
    setDrawerOpen(false)
  }

  return (
    <SyncProvider>
      <ReminderProvider>
        <div className="h-[100dvh] overflow-hidden bg-transparent">
          <MilkdropBackgroundWrapper />

          {isMobile ? (
            <div className="drawer h-[100dvh] overflow-hidden">
              <input
                id={DRAWER_ID}
                type="checkbox"
                className="drawer-toggle"
                checked={drawerOpen}
                onChange={(event) => setDrawerOpen(event.target.checked)}
              />

              <div className="drawer-content flex min-h-[100dvh] flex-col">
                <TopBar
                  onMenuClick={() => setDrawerOpen(true)}
                />

                <main className="relative flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom,0px)+64px)]">
                  {children}
                </main>

                <BottomNav onMoreClick={() => setDrawerOpen(true)} />
              </div>

              <div className="drawer-side z-40 pb-[calc(env(safe-area-inset-bottom,0px)+64px)]">
                {/* Click overlay closes drawer — using a div instead of
                    a <label> so we have full control and can also prevent
                    the click from toggling the checkbox unexpectedly */}
                <div
                  aria-label="close navigation"
                  className="drawer-overlay"
                  onClick={closeDrawer}
                  onKeyDown={(e) => { if (e.key === 'Escape') closeDrawer() }}
                  role="button"
                  tabIndex={-1}
                />
                <AppSidebar
                  expanded
                  onNavigate={closeDrawer}
                  onToggle={toggleSidebar}
                />
              </div>
            </div>
          ) : (
            <div className="flex min-h-[100dvh]">
              <AppSidebar
                expanded={sidebarExpanded}
                onNavigate={() => { }} // no-op for desktop, but keeps prop consistent
                onToggle={toggleSidebar}
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <TopBar
                  onMenuClick={() => setDrawerOpen(true)}
                />
                <main className="relative flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom,0px)]">
                  {children}
                </main>
              </div>
            </div>
          )}

          {!isMobile && (
            <div
              className={[
                'pointer-events-none fixed bottom-0 right-0 z-30 hidden border-t border-warning/20 bg-base-100/95 backdrop-blur-sm md:block',
                sidebarExpanded ? 'left-60' : 'left-16',
              ].join(' ')}
            >
              <div className="flex items-center justify-center gap-2 px-4 py-1.5 text-xs text-warning">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>Educational and harm reduction purposes only. Always consult medical professionals.</span>
              </div>
            </div>
          )}

          {doseLoggerOpen && (
            <DoseLoggerModal
              open
              onOpenChange={(open) => !open && closeDoseLogger()}
              preselectedSubstanceId={doseLoggerPreselect?.substanceId}
              preselectedSubstanceName={doseLoggerPreselect?.substanceName}
              preselectedCategory={doseLoggerPreselect?.category}
              preselectedRoute={doseLoggerPreselect?.route}
            />
          )}
          <CommandPalette />
          {!isMobile && <VisualizerControls />}
          <Toaster />
          <OnboardingTour
            isOpen={showOnboarding}
            onClose={() => {
              setShowOnboarding(false)
              setOnboardingCompleted(true)
            }}
          />
          <UpdateCheckPopupWrapper />
        </div>
      </ReminderProvider>
    </SyncProvider>
  )
}
