'use client'

import { useEffect } from 'react'
import { useReminderStore } from '@/store/reminder-store'
import { useToleranceNotificationStore } from '@/store/tolerance-notification-store'
import { startReminderEngine, stopReminderEngine } from '@/lib/reminder-engine'
import { startTimelineNotifications, stopTimelineNotifications } from '@/lib/timeline-notifications'
import { startToleranceNotifications, stopToleranceNotifications } from '@/lib/tolerance-notifications'
import { preloadReminderSound } from '@/lib/sound-utils'
import { shouldRegisterServiceWorker, shouldPlayWebSound, isTauri } from '@/lib/tauri-bridge'

/** Whether we've already prompted for notification permission this session */
let permissionPrompted = false

/**
 * Client-only provider that initializes the reminder store,
 * starts the engine tick loop, and registers the Service Worker.
 * When running in Tauri, skips SW registration (not needed) and
 * web audio preloading (native OS sound is used instead).
 *
 * Also requests native notification permission on first launch
 * when running inside Tauri (Android/iOS require an explicit prompt).
 * Wrap your app (or just the main content) with this provider.
 */
export function ReminderProvider({ children }: { children: React.ReactNode }) {
  const initialize = useReminderStore((s) => s.initialize)
  const initializeTolerance = useToleranceNotificationStore((s) => s.initialize)

  useEffect(() => {
    // Initialize both stores
    const cleanup = initialize()
    initializeTolerance()

    // Preload sound for web (Tauri uses OS sound)
    if (shouldPlayWebSound()) {
      preloadReminderSound()
    }

    // Start all notification engines
    startReminderEngine()
    startTimelineNotifications()
    startToleranceNotifications()

    // Service Worker registration (web only)
    if (shouldRegisterServiceWorker() && !isTauri()) {
      navigator.serviceWorker
        .register('/sw.js')
        .then(() => console.log('[SW] Registered'))
        .catch((e) => console.warn('[SW] Registration failed:', e))
    }

    // 2b. Async: check Tauri native notification permission and update store.
    if (typeof window !== 'undefined') {
      import('@/lib/notification-utils').then(
        async ({ checkNotificationPermissionStatus, requestNotificationPermission }) => {
          const currentPerm = await checkNotificationPermissionStatus()

          // Update store with the real permission state
          if (
            currentPerm &&
            currentPerm !== useReminderStore.getState().notificationPermission
          ) {
            useReminderStore.getState().setNotificationPermission(currentPerm)
          }

          // In Tauri (mobile), auto-request permission on first launch if not decided.
          if (isTauri() && currentPerm === 'default' && !permissionPrompted) {
            permissionPrompted = true
            try {
              const result = await requestNotificationPermission()
              useReminderStore.getState().setNotificationPermission(result)
            } catch {
              // User denied or prompt failed — non-critical
            }
          }
        }
      ).catch(() => {
        // Non-critical — the sync check is sufficient for web
      })
    }

    return () => {
      stopReminderEngine()
      stopTimelineNotifications()
      stopToleranceNotifications()
      cleanup?.()
    }
  }, [initialize, initializeTolerance])

  return <>{children}</>
}