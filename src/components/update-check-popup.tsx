'use client'

import { useState, type MouseEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import { X, Github, ArrowUpRight, Bell } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isTauri } from '@/lib/tauri-bridge'

// Suppression is intentionally SESSION-scoped (sessionStorage, not
// localStorage): a fresh app launch starts a new browsing session, so the
// stored snooze/dismiss is wiped and the update check always runs and is able
// to re-show the popup. Within a single session the values persist, which is
// what keeps the popup from re-appearing on every in-app route change (the
// WebView remounts this component on navigation).
const STORAGE_KEY = 'drugucopia-last-checked-version'
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours

const GITHUB_REPO = 'drugucopia/app-drugucopia'
const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`

interface UpdateCheckPopupProps {
  currentVersion: string
  latestVersion: string
  releaseNotes: string
  releaseUrl: string
}

export function UpdateCheckPopup({
  currentVersion,
  latestVersion,
  releaseNotes,
  releaseUrl,
}: UpdateCheckPopupProps) {
  const [isOpen, setIsOpen] = useState(() =>
    shouldShowUpdate(currentVersion, latestVersion),
  )

  const handleClose = () => {
    setIsOpen(false)
    setLastCheckedVersion(latestVersion)
    setLastCheckTime(Date.now())
  }

  const handleLater = () => {
    // Just update check time, don't mark version as seen
    setIsOpen(false)
    setLastCheckTime(Date.now())
  }

  const handleOpenGithub = async (event: MouseEvent<HTMLAnchorElement>) => {
    // A normal target="_blank" link stays inside the Android WebView. Use
    // Tauri's opener plugin so Android delegates the URL to the user's
    // default browser. Keep native anchor behavior for the regular web app.
    if (!isTauri()) {
      handleClose()
      return
    }

    event.preventDefault()

    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      await openUrl(releaseUrl)
      handleClose()
    } catch (error) {
      console.error('Failed to open the GitHub release in the browser:', error)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={handleClose}>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative z-10 card bg-base-100 shadow-2xl w-full max-w-md mx-4 max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-body overflow-y-auto">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <div className="bg-warning/10 p-2 rounded-box">
                <Bell className="h-6 w-6 text-warning" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-base-content">
                  Update Available
                </h3>
                <p className="text-sm text-base-content/60">
                  Drugucopia v{latestVersion} is now available
                </p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="btn btn-ghost btn-sm btn-circle"
              aria-label="Dismiss update notification"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mb-4 p-3 bg-base-200/50 rounded-box">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-base-content/60">Current version</span>
              <span className="font-mono text-base-content">v{currentVersion}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-base-content/60">Latest version</span>
              <span className="font-mono text-primary font-semibold">v{latestVersion}</span>
            </div>
          </div>

          {releaseNotes && (
            <div className="bg-base-200/50 rounded-box p-4 max-h-64 overflow-y-auto mb-4">
              <h4 className="text-sm font-semibold text-base-content mb-3">What's New</h4>
              <div className="prose prose-sm max-w-none text-base-content/80 dark:prose-invert prose-headings:text-base-content prose-p:text-base-content/80 prose-li:text-base-content/80 prose-a:text-primary">
                <ReactMarkdown>{releaseNotes}</ReactMarkdown>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <button onClick={handleLater} className="btn btn-ghost">
              Remind Me Later
            </button>
            <a
              href={releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleOpenGithub}
              className={cn('btn btn-primary', 'flex items-center gap-2')}
            >
              <Github className="h-4 w-4" />
              View on GitHub
              <ArrowUpRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

function shouldShowUpdate(currentVersion: string, latestVersion: string): boolean {
  if (!latestVersion || latestVersion === currentVersion) return false

  const lastChecked = getLastCheckedVersion()
  const lastCheckTime = getLastCheckTime()
  const recentlyDeferred =
    lastCheckTime !== null && Date.now() - lastCheckTime < CHECK_INTERVAL_MS

  // Route transitions can remount this component in the Android WebView.
  // The suppression state lives in sessionStorage, so it is honored for the
  // rest of the current session but is automatically cleared on the next app
  // launch — which is what makes the update check run on every launch.
  return lastChecked !== latestVersion && !recentlyDeferred
}

function getLastCheckedVersion(): string | null {
  if (typeof window === 'undefined') return null
  return window.sessionStorage.getItem(STORAGE_KEY)
}

function setLastCheckedVersion(version: string) {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(STORAGE_KEY, version)
}

function getLastCheckTime(): number | null {
  if (typeof window === 'undefined') return null
  const time = window.sessionStorage.getItem(`${STORAGE_KEY}-time`)
  return time ? parseInt(time, 10) : null
}

function setLastCheckTime(time: number) {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(`${STORAGE_KEY}-time`, time.toString())
}

export { GITHUB_REPO, GITHUB_RELEASES_URL, GITHUB_API_URL }
