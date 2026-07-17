'use client'

import React, { createContext, useContext, useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import {
  getFirestore,
  type Firestore,
  initializeFirestore,
  doc,
  onSnapshot,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { toast } from '../hooks/use-toast'
import { useDoseStore } from '../store/dose-store'
import { useReminderStore } from '../store/reminder-store'
import { useCustomSubstanceStore, type CustomSubstance } from '../store/custom-substance-store'
import { useMedicationStore, type UserMedication } from '../store/medication-store'
import { DoseLog, ReminderSchedule, ActiveReminder } from '../types'

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
}

// Helper to check which Firebase env vars are missing at runtime
function getMissingFirebaseKeys(): string[] {
  const required: (keyof typeof firebaseConfig)[] = [
    'apiKey',
    'authDomain',
    'projectId',
    'storageBucket',
    'messagingSenderId',
    'appId',
  ]
  return required.filter((k) => !firebaseConfig[k])
}

export function isFirebaseConfigured(): boolean {
  return getMissingFirebaseKeys().length === 0
}

export function getFirebaseConfigDebug(): Record<string, boolean> {
  return {
    apiKey: !!firebaseConfig.apiKey,
    authDomain: !!firebaseConfig.authDomain,
    projectId: !!firebaseConfig.projectId,
    storageBucket: !!firebaseConfig.storageBucket,
    messagingSenderId: !!firebaseConfig.messagingSenderId,
    appId: !!firebaseConfig.appId,
  }
}

// Lazy-initialize Firebase so the app doesn't crash if env vars are missing.
// getDb() returns null when Firebase can't be initialized, and every caller
// checks for null before proceeding — no TypeScript "Firestore | null" error.
let _app: FirebaseApp | null = null
let _db: Firestore | null = null

function getDb(): Firestore | null {
  if (_db) return _db
  const missing = getMissingFirebaseKeys()
  if (missing.length > 0) {
    console.warn('[sync] Firebase misconfigured - missing:', missing.join(', '), 'config present:', getFirebaseConfigDebug())
    return null
  }
  try {
    _app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig)

    // Use initializeFirestore() instead of getFirestore() so we can pass
    // experimentalAutoDetectLongPolling. Firebase defaults to WebSocket for
    // onSnapshot, which is blocked by many corporate/cellular networks and
    // some browser/CSP configurations — causing the 15s "sync connection
    // timeout" with no error callback. Auto-detect falls back to HTTP
    // long-polling when WebSocket fails or is unreachable.
    try {
      _db = initializeFirestore(_app, {
        experimentalAutoDetectLongPolling: true,
        // Don't force long-polling — let the SDK try WebSocket first, then
        // fall back. Forcing long-polling adds ~100ms latency per snapshot.
      })
    } catch (initErr) {
      // initializeFirestore throws if getFirestore was already called for
      // this app (e.g. by HMR in dev). Fall back to getFirestore, which
      // returns the existing instance.
      console.debug('[sync] initializeFirestore fell back to getFirestore (likely HMR):', initErr)
      _db = getFirestore(_app)
    }
    console.debug(
      '[sync] Firebase initialized successfully, project:', firebaseConfig.projectId,
      'longPolling: auto-detect',
    )
    return _db
  } catch (e) {
    console.warn('Firebase initialization failed', e, 'config presence:', getFirebaseConfigDebug())
    return null
  }
}
const SYNC_AUTH_KEY = 'drugucopia-sync-auth'
// D3 — Split credential storage:
//   - Room name lives in localStorage so the UI can pre-fill it on
//     every page load (room names are not secret).
//   - Password: on web, sessionStorage (cleared when tab closes).
//     On Tauri (Android/Desktop), localStorage so it survives app restarts.
//     This is because Tauri's webview is destroyed on app close, wiping
//     sessionStorage. The trade-off is slightly lower security on Tauri
//     but much better UX — users don't re-enter password on every launch.
const SYNC_ROOM_KEY = 'drugucopia-sync-room'
const SYNC_PASS_KEY = 'drugucopia-sync-pass'

// Check if running in Tauri (where sessionStorage doesn't persist)
function isTauri(): boolean {
  return typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__
}

// Get the appropriate storage for password
function getPassStorage(): Storage {
  return isTauri() ? localStorage : sessionStorage
}

// D2 — localStorage key for the "last synced" dose baseline.
// Stored as a JSON object: { [doseId]: updatedAtTimestamp }.
// Used by mergeDoses to detect true conflicts (both local and remote
// edited the same dose since the last sync).
const DOSE_BASELINE_KEY = 'drugucopia-sync-dose-baseline'

function loadDoseBaseline(): Map<string, number> {
  if (typeof window === 'undefined') return new Map()
  try {
    const raw = localStorage.getItem(DOSE_BASELINE_KEY)
    if (!raw) return new Map()
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return new Map()
    const map = new Map<string, number>()
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && !isNaN(v)) map.set(k, v)
    }
    return map
  } catch {
    return new Map()
  }
}

function saveDoseBaseline(doses: DoseLog[]) {
  if (typeof window === 'undefined') return
  try {
    const obj: Record<string, number> = {}
    for (const d of doses) {
      obj[d.id] = new Date(d.updatedAt || d.createdAt).getTime()
    }
    localStorage.setItem(DOSE_BASELINE_KEY, JSON.stringify(obj))
  } catch {
    /* ignore quota errors */
  }
}

function clearDoseBaseline() {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(DOSE_BASELINE_KEY)
  } catch {
    /* ignore */
  }
}

// D3 — Track whether we've ever successfully synced before (persists across sessions).
// This distinguishes "first ever sync" (where we ignore local deletions to avoid
// wiping a new remote room) from "reconnect" (where we should respect local deletions).
const SYNC_HAS_SYNCED_KEY = 'drugucopia-sync-has-synced'

function hasSyncedBefore(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(SYNC_HAS_SYNCED_KEY) === 'true'
  } catch {
    return false
  }
}

function markHasSynced() {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(SYNC_HAS_SYNCED_KEY, 'true')
  } catch {
    /* ignore quota errors */
  }
}

// D3 — Credential storage helpers. Room name → localStorage (not
// secret, used for UI pre-fill). Password → sessionStorage on web,
// localStorage on Tauri (so it survives app restarts). Combined read
// returns null if either piece is missing.
function saveSyncCredentials(room: string, pass: string) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(SYNC_ROOM_KEY, room)
    getPassStorage().setItem(SYNC_PASS_KEY, pass)
  } catch {
    /* ignore quota errors */
  }
}

function loadSyncCredentials(): { room: string; pass: string } | null {
  if (typeof window === 'undefined') return null
  try {
    const room = localStorage.getItem(SYNC_ROOM_KEY)
    const pass = getPassStorage().getItem(SYNC_PASS_KEY)
    if (!room || !pass) return null
    return { room, pass }
  } catch {
    return null
  }
}

function hasStoredRoom(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(SYNC_ROOM_KEY)
  } catch {
    return null
  }
}

function clearSyncCredentials() {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(SYNC_ROOM_KEY)
    localStorage.removeItem(SYNC_AUTH_KEY) // legacy cleanup
    getPassStorage().removeItem(SYNC_PASS_KEY)
  } catch {
    /* ignore */
  }
}

// --- CRYPTO UTILS ---
// Chunked to avoid "Maximum call stack size exceeded" on large payloads
const buf2base64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = new Uint8Array(buf)
  const chunkSize = 8192
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize) as unknown as number[])
  }
  return btoa(binary)
}

const base642buf = (b64: string) => {
  const binaryStr = atob(b64)
  const bytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i)
  }
  return bytes
}

const hashRoomName = async (roomName: string, password: string) => {
  const data = new TextEncoder().encode(roomName + password + 'drugucopia-salt')
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32)
}

const deriveKey = async (password: string, salt: string) => {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits', 'deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
  )
}

const encryptData = async (dataObj: any, key: CryptoKey) => {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(dataObj)))
  return { iv: buf2base64(iv), ciphertext: buf2base64(ciphertext) }
}

const decryptData = async (encryptedObj: { iv: string; ciphertext: string }, key: CryptoKey) => {
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base642buf(encryptedObj.iv) }, key, base642buf(encryptedObj.ciphertext))
  return JSON.parse(new TextDecoder().decode(decrypted))
}

// --- MERGE UTILS ---

const getUpdateTime = (d: DoseLog) => new Date(d.updatedAt || d.createdAt).getTime()

const getScheduleUpdateTime = (s: ReminderSchedule) => new Date(s.updatedAt || s.createdAt).getTime()

type VersionedSyncItem = {
  id: string
  createdAt: string
  updatedAt: string
}

/** Merge an encrypted profile collection using tombstones for deletions and
 * updatedAt for edits. This is shared by custom substances and medications. */
const mergeVersionedCollection = <T extends VersionedSyncItem>(
  local: T[],
  remote: T[],
  localDeleted: Set<string>,
  remoteDeleted: Set<string>,
) => {
  const deleted = new Set([...localDeleted, ...remoteDeleted])
  const items = new Map<string, T>()

  for (const item of local) {
    if (!deleted.has(item.id)) items.set(item.id, item)
  }

  for (const item of remote) {
    if (deleted.has(item.id)) continue
    const existing = items.get(item.id)
    const existingTime = existing
      ? new Date(existing.updatedAt || existing.createdAt).getTime()
      : Number.NEGATIVE_INFINITY
    const remoteTime = new Date(item.updatedAt || item.createdAt).getTime()
    if (!existing || remoteTime > existingTime) items.set(item.id, item)
  }

  return { items: Array.from(items.values()), deleted }
}

const versionedCollectionSignature = <T extends VersionedSyncItem>(
  items: T[],
  deleted: Set<string>,
) => JSON.stringify({
  items: items
    .map((item) => `${item.id}:${item.updatedAt || item.createdAt}`)
    .sort(),
  deleted: [...deleted].sort(),
})

/**
 * D2 — A pending sync conflict for a single dose.
 * The user must pick "keep local", "keep remote", or "keep both"
 * (keep both creates a new dose from the local version with a fresh ID).
 */
export interface DoseConflict {
  id: string
  local: DoseLog
  remote: DoseLog
  /** Why we flagged it: both sides changed since the last sync baseline */
  reason: 'both-edited'
}

/**
 * Merge local + remote dose lists. Takes a "baseline" map of
 * `doseId → updatedAt-as-of-last-sync` so we can detect true conflicts
 * (both sides changed since the last sync). When a conflict is detected:
 *   - The newer version wins in the merged output (preserves the old
 *     behavior so the UI doesn't break), BUT
 *   - The conflict is also returned in `conflicts` so the UI can prompt
 *     the user to confirm or override the choice.
 *
 * When baseline is empty (first-ever sync, or baseline was lost), this
 * falls back to pure updatedAt-wins with no conflicts surfaced.
 */
const mergeDoses = (
  local: DoseLog[],
  remote: DoseLog[],
  localDeleted: Set<string>,
  remoteDeleted: Set<string>,
  baseline: Map<string, number> = new Map(),
) => {
  const allDeleted = new Set([...localDeleted, ...remoteDeleted])
  const map = new Map<string, DoseLog>()
  const conflicts: DoseConflict[] = []

  // "Undelete" protection: if a local dose was recently added/modified, it
  // should NOT be deleted by a stale remote `deleted` array entry — the user
  // intentionally re-added it (e.g. via import). We consider a dose "recently
  // modified" if either:
  //   a) its updatedAt is newer than the last sync baseline, OR
  //   b) its updatedAt is within the last 10 minutes (covers the no-baseline
  //      case, e.g. first-ever sync after an import)
  const TEN_MINUTES_MS = 10 * 60 * 1000
  const nowMs = Date.now()
  const localUndeleted = new Set<string>()
  for (const d of local) {
    const updateTime = getUpdateTime(d)
    const baselineTime = baseline.get(d.id)
    const isNewerThanBaseline = baselineTime !== undefined && updateTime > baselineTime
    const isVeryRecent = Math.abs(nowMs - updateTime) < TEN_MINUTES_MS
    if (isNewerThanBaseline || isVeryRecent) {
      localUndeleted.add(d.id)
    }
  }
  for (const id of localUndeleted) {
    allDeleted.delete(id)
  }

  for (const d of local) {
    if (!allDeleted.has(d.id)) map.set(d.id, d)
  }

  for (const d of remote) {
    if (allDeleted.has(d.id)) { map.delete(d.id); continue }
    const existing = map.get(d.id)

    if (!existing) {
      // New remote dose — just take it.
      map.set(d.id, d)
      continue
    }

    const localTime = getUpdateTime(existing)
    const remoteTime = getUpdateTime(d)
    const baselineTime = baseline.get(d.id)

    // D2 — conflict detection: both sides have an updatedAt newer than
    // the last sync baseline. That means both clients edited the same
    // dose independently since they last synced.
    if (
      baselineTime !== undefined &&
      localTime > baselineTime &&
      remoteTime > baselineTime
    ) {
      // Check that the two versions are actually different (not just
      // identical timestamps). If they're equal content-wise, no
      // conflict needs surfacing.
      const sameContent =
        existing.substanceName === d.substanceName &&
        existing.amount === d.amount &&
        existing.unit === d.unit &&
        existing.route === d.route &&
        existing.notes === d.notes &&
        existing.mood === d.mood &&
        existing.setting === d.setting &&
        getUpdateTime(existing) === getUpdateTime(d)
      if (!sameContent) {
        conflicts.push({ id: d.id, local: existing, remote: d, reason: 'both-edited' })
      }
    }

    // Default: remote wins if newer. Same as before D2.
    if (remoteTime > localTime) {
      map.set(d.id, d)
    }
  }

  const doses = Array.from(map.values()).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  return { doses, deleted: allDeleted, conflicts }
}

/**
 * Merge reminder schedules using the same conflict-resolution strategy as doses:
 * - Deleted IDs from both sides are unioned and take priority
 * - For duplicate IDs, the one with the newer updatedAt (or createdAt) wins
 */
const mergeSchedules = (
  local: ReminderSchedule[],
  remote: ReminderSchedule[],
  localDeleted: Set<string>,
  remoteDeleted: Set<string>,
) => {
  const allDeleted = new Set([...localDeleted, ...remoteDeleted])
  const map = new Map<string, ReminderSchedule>()

  for (const s of local) {
    if (!allDeleted.has(s.id)) map.set(s.id, s)
  }

  for (const s of remote) {
    if (allDeleted.has(s.id)) { map.delete(s.id); continue }
    const existing = map.get(s.id)
    if (!existing || getScheduleUpdateTime(s) > getScheduleUpdateTime(existing)) {
      map.set(s.id, s)
    }
  }

  return { schedules: Array.from(map.values()), deleted: allDeleted }
}

/**
 * Merge active reminders:
 * - Combine local + remote, dedup by ID
 * - For duplicates, keep the one with the later startedAt (most recent timer)
 * - Filter out stale fired reminders (> 2 hours old)
 */
const mergeActiveReminders = (local: ActiveReminder[], remote: ActiveReminder[]) => {
  const now = Date.now()
  const map = new Map<string, ActiveReminder>()

  const addIfValid = (r: ActiveReminder) => {
    // Skip stale fired reminders (> 2 hours old)
    if (r.status === 'fired' && now - new Date(r.firesAt).getTime() > 2 * 60 * 60_000) return
    // Skip dismissed
    if (r.status === 'dismissed') return

    const existing = map.get(r.id)
    if (!existing || new Date(r.startedAt).getTime() > new Date(existing.startedAt).getTime()) {
      map.set(r.id, r)
    }
  }

  for (const r of local) addIfValid(r)
  for (const r of remote) addIfValid(r)

  return Array.from(map.values())
}

// --- CONTEXT ---
interface SyncContextType {
  syncStatus: 'idle' | 'connecting' | 'synced' | 'error'
  // D1 — ISO timestamp of the last successful snapshot received from
  // Firestore. Used by the Header's sync indicator to show "synced 2m ago".
  lastSyncedAt: string | null
  roomId: string
  password: string
  setRoomId: (id: string) => void
  setPassword: (pw: string) => void
  connectToSync: (rId?: string, pass?: string) => Promise<void>
  disconnectSync: () => void
  // Manually trigger a push to Firestore (useful for debugging / force-sync).
  pushToSync: (options?: { bypassRateLimit?: boolean }) => Promise<void>
  // D2 — Pending sync conflicts awaiting user resolution.
  pendingConflicts: DoseConflict[]
  // Resolve a conflict by ID. Choices:
  //   'local'  — keep the local version (will overwrite remote on next push)
  //   'remote' — keep the remote version (local changes discarded)
  //   'both'   — keep both: the remote stays, and a new dose is created
  //              from the local version with a fresh ID
  resolveConflict: (conflictId: string, choice: 'local' | 'remote' | 'both') => void
  dismissConflict: (conflictId: string) => void
  // True when there are local changes that haven't been pushed to the server yet.
  hasPendingChanges: boolean
}

const SyncContext = createContext<SyncContextType | null>(null)

export function SyncProvider({ children }: { children: React.ReactNode }) {
  // Use individual Zustand selectors to avoid subscribing to the entire store.
  // Only subscribe to what the UI actually renders (syncStatus, isLoaded for conditionals).
  // Read doses/deletedIds via getState() inside effects/callbacks to avoid re-renders.
  const isLoaded = useDoseStore(s => s.isLoaded)
  const initialize = useDoseStore(s => s.initialize)
  const setDosesFromSync = useDoseStore(s => s.setDosesFromSync)

  const reminderIsLoaded = useReminderStore(s => s.isLoaded)
  const initializeReminders = useReminderStore(s => s.initialize)
  const setRemindersFromSync = useReminderStore(s => s.setRemindersFromSync)

  const customSubstancesLoaded = useCustomSubstanceStore(s => s.loaded)
  const initializeCustomSubstances = useCustomSubstanceStore(s => s.initialize)
  const setCustomSubstancesFromSync = useCustomSubstanceStore(s => s.setSubstancesFromSync)

  const medicationsLoaded = useMedicationStore(s => s.loaded)
  const initializeMedications = useMedicationStore(s => s.initialize)
  const setMedicationsFromSync = useMedicationStore(s => s.setMedicationsFromSync)

  const [syncStatus, setSyncStatusRaw] = useState<'idle' | 'connecting' | 'synced' | 'error'>('idle')
  // D1 — last time we got a successful snapshot from Firestore.
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  // D2 — pending conflicts awaiting user resolution. Cleared on disconnect.
  const [pendingConflicts, setPendingConflicts] = useState<DoseConflict[]>([])
  // Track if there are local changes that haven't been pushed yet.
  const [hasPendingChanges, setHasPendingChanges] = useState(false)
  const [roomId, setRoomId] = useState('')
  const [password, setPassword] = useState('')

  const cryptoKeyRef = useRef<CryptoKey | null>(null)
  const hashedRoomRef = useRef<string | null>(null)
  const unsubscribeRef = useRef<(() => void) | null>(null)
  const lastPushedHashRef = useRef<string | null>(null)
  const isPushingRef = useRef(false)
  const initialSyncDoneRef = useRef(false)
  const syncStatusRef = useRef<'idle' | 'connecting' | 'synced' | 'error'>('idle')
  const pushDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Session-level guard: the "Secure Sync Active" toast should fire at most
  // once per page session, even if connectToSync re-runs (e.g. when isLoaded
  // / reminderIsLoaded flip after hydration and the auto-connect effect
  // re-subscribes). Without this, every snapshot listener re-attach can
  // re-trigger the toast because markHasSynced() is only persisted after
  // a successful *data* merge, not after an empty-room or echo snapshot.
  const hasShownActiveToastRef = useRef(false)

  // Guard against feedback loop: when setDosesFromSync / setRemindersFromSync updates
  // the Zustand stores, the subscription listeners fire and would schedule another push.
  // This counter tracks how many sync-originated updates are in flight.
  const skipAutoPushCountRef = useRef(0)

  // Rate-limit: minimum milliseconds between actual Firestore writes.
  // Prevents rapid-fire setDoc calls that exhaust the write stream.
  const MIN_WRITE_INTERVAL_MS = 3000
  const lastWriteTimeRef = useRef<number>(0)

  // Keep refs in sync with roomId/password state so connectToSync can read
  // current values without depending on them in its useCallback dependency array.
  // This prevents the callback (and the entire context value) from being
  // recreated on every keystroke in the room/password inputs.
  const roomIdRef = useRef(roomId)
  const passwordRef = useRef(password)
  useEffect(() => { roomIdRef.current = roomId }, [roomId])
  useEffect(() => { passwordRef.current = password }, [password])

  // Wrapper that keeps both React state and ref in sync
  const setSyncStatus = useCallback((status: 'idle' | 'connecting' | 'synced' | 'error') => {
    syncStatusRef.current = status
    setSyncStatusRaw(status)
  }, [])

  // Initialize Zustand stores on mount
  useEffect(() => {
    initialize()
    initializeReminders()
    initializeCustomSubstances()
    initializeMedications()
  }, [initialize, initializeReminders, initializeCustomSubstances, initializeMedications])

  // Use refs for store data so pushToSync doesn't recreate on every state change.
  // This prevents unnecessary effect triggers in the auto-push subscription.
  const dosesRef = useRef(useDoseStore.getState().doses)
  const deletedIdsRef = useRef(useDoseStore.getState().deletedIds)

  const schedulesRef = useRef(useReminderStore.getState().schedules)
  const activeRemindersRef = useRef(useReminderStore.getState().activeReminders)
  const deletedScheduleIdsRef = useRef(useReminderStore.getState().deletedScheduleIds)
  const reminderSettingsRef = useRef({
    autoStartEnabled: useReminderStore.getState().autoStartEnabled,
    soundEnabled: useReminderStore.getState().soundEnabled,
  })

  const customSubstancesRef = useRef(useCustomSubstanceStore.getState().substances)
  const deletedCustomSubstanceIdsRef = useRef(useCustomSubstanceStore.getState().deletedIds)
  const medicationsRef = useRef(useMedicationStore.getState().medications)
  const deletedMedicationIdsRef = useRef(useMedicationStore.getState().deletedIds)

  // Initialization can complete before the vanilla Zustand subscriptions below
  // are attached. Refresh every payload ref once hydration finishes so the
  // first Firebase write cannot accidentally upload empty profile arrays.
  useEffect(() => {
    if (isLoaded) {
      dosesRef.current = useDoseStore.getState().doses
      deletedIdsRef.current = useDoseStore.getState().deletedIds
    }
    if (reminderIsLoaded) {
      const reminderState = useReminderStore.getState()
      schedulesRef.current = reminderState.schedules
      activeRemindersRef.current = reminderState.activeReminders
      deletedScheduleIdsRef.current = reminderState.deletedScheduleIds
      reminderSettingsRef.current = {
        autoStartEnabled: reminderState.autoStartEnabled,
        soundEnabled: reminderState.soundEnabled,
      }
    }
    if (customSubstancesLoaded) {
      customSubstancesRef.current = useCustomSubstanceStore.getState().substances
      deletedCustomSubstanceIdsRef.current = useCustomSubstanceStore.getState().deletedIds
    }
    if (medicationsLoaded) {
      medicationsRef.current = useMedicationStore.getState().medications
      deletedMedicationIdsRef.current = useMedicationStore.getState().deletedIds
    }
  }, [isLoaded, reminderIsLoaded, customSubstancesLoaded, medicationsLoaded])

  // Ref to hold pushToSync so it can call itself recursively
  const pushToSyncRef = useRef<typeof pushToSync>(null)

  const pushToSync = useCallback(async (options?: { bypassRateLimit?: boolean }) => {
    // Debug: log all guard values so we can see exactly why pushes might not happen
    const guard = {
      hasCryptoKey: !!cryptoKeyRef.current,
      hasHashedRoom: !!hashedRoomRef.current,
      isPushing: isPushingRef.current,
      isLoaded,
      reminderIsLoaded,
      customSubstancesLoaded,
      medicationsLoaded,
      syncStatus: syncStatusRef.current,
      initialSyncDone: initialSyncDoneRef.current,
    }

    // If a push is already in progress, reschedule this call for later
    // instead of silently dropping it. This is critical for bulk operations
    // (import, delete-all) that call pushToSync() explicitly — without this,
    // the push would be lost if it coincides with another push.
    if (cryptoKeyRef.current && hashedRoomRef.current && isPushingRef.current) {
      console.debug('[sync] pushToSync skipped — push in progress, rescheduling in 1s')
      if (pushDebounceRef.current) clearTimeout(pushDebounceRef.current)
      pushDebounceRef.current = setTimeout(() => {
        pushDebounceRef.current = null
        pushToSyncRef.current?.(options)
      }, 1000)
      return
    }

    if (
      !cryptoKeyRef.current ||
      !hashedRoomRef.current ||
      !isLoaded ||
      !reminderIsLoaded ||
      !customSubstancesLoaded ||
      !medicationsLoaded
    ) {
      console.debug('[sync] pushToSync skipped — guards:', guard)
      return
    }
    const db = getDb()
    if (!db) {
      console.debug('[sync] pushToSync skipped — no db')
      return
    }

    // Rate-limit: enforce minimum interval between Firestore writes
    // Can be bypassed for manual "Force Sync" (but not for concurrent pushes)
    const bypassRateLimit = options?.bypassRateLimit === true
    if (!bypassRateLimit) {
      const now = Date.now()
      const elapsed = now - lastWriteTimeRef.current
      if (elapsed < MIN_WRITE_INTERVAL_MS) {
        const delay = MIN_WRITE_INTERVAL_MS - elapsed
        console.debug(`[sync] pushToSync rate-limited, retrying in ${delay}ms`)
        if (pushDebounceRef.current) clearTimeout(pushDebounceRef.current)
        pushDebounceRef.current = setTimeout(() => {
          pushDebounceRef.current = null
          pushToSyncRef.current?.(options)
        }, delay)
        return
      }
    }

    isPushingRef.current = true
    console.debug('[sync] pushToSync starting — writing to secure_rooms/' + hashedRoomRef.current)
    try {
      const currentDoses = dosesRef.current
      const currentDeleted = deletedIdsRef.current
      const currentSchedules = schedulesRef.current
      const currentActiveReminders = activeRemindersRef.current
      const currentDeletedScheduleIds = deletedScheduleIdsRef.current
      const currentReminderSettings = reminderSettingsRef.current
      const currentCustomSubstances = customSubstancesRef.current
      const currentDeletedCustomSubstances = deletedCustomSubstanceIdsRef.current
      const currentMedications = medicationsRef.current
      const currentDeletedMedications = deletedMedicationIdsRef.current

      const payload = {
        doses: currentDoses,
        deleted: [...currentDeleted],
        customSubstances: currentCustomSubstances,
        deletedCustomSubstances: [...currentDeletedCustomSubstances],
        medications: currentMedications,
        deletedMedications: [...currentDeletedMedications],
        // Reminder sync data
        schedules: currentSchedules,
        deletedSchedules: [...currentDeletedScheduleIds],
        activeReminders: currentActiveReminders,
        reminderSettings: {
          autoStartEnabled: currentReminderSettings.autoStartEnabled,
          soundEnabled: currentReminderSettings.soundEnabled,
        },
      }
      const encrypted = await encryptData(payload, cryptoKeyRef.current)
      lastPushedHashRef.current = encrypted.ciphertext.substring(0, 32)
      console.debug(
        `[sync] setDoc writing ${currentDoses.length} doses, ${currentSchedules.length} schedules, ` +
        `${currentCustomSubstances.length} custom substances, ${currentMedications.length} medications`,
      )
      await setDoc(doc(db, 'secure_rooms', hashedRoomRef.current), {
        encrypted,
        updatedAt: serverTimestamp(),
      })
      lastWriteTimeRef.current = Date.now()
      console.debug('[sync] setDoc succeeded')
      // Clear pending changes flag on successful push
      setHasPendingChanges(false)
    } catch (e) {
      console.error('[sync] Failed to push sync:', e)
      // Surface the error to the user — include the FULL error message so the
      // exact Firebase error code is visible without needing the console.
      const msg = e instanceof Error ? e.message : String(e)
      const isPermissionError = msg.includes('permission') || msg.includes('PERMISSION_DENIED')
      if (isPermissionError) {
        setSyncStatus('error')
      }
      toast({
        title: 'Sync write failed',
        description: isPermissionError
          ? 'Firestore rules block writes to secure_rooms. Apply the firestore.rules from the repo to your Firebase project.'
          : `Error: ${msg.substring(0, 120)}`,
        variant: 'destructive',
      })
    } finally {
      isPushingRef.current = false
    }
  }, [isLoaded, reminderIsLoaded, customSubstancesLoaded, medicationsLoaded])

  // Store pushToSync in ref so it can call itself recursively
  useEffect(() => {
    pushToSyncRef.current = pushToSync
  }, [pushToSync])

  // Subscribe to Zustand store changes OUTSIDE of React render cycle.
  // Updates refs and triggers debounced push without causing re-renders.
  useEffect(() => {
    const unsubDose = useDoseStore.subscribe((state) => {
      dosesRef.current = state.doses
      deletedIdsRef.current = state.deletedIds

      // Skip auto-push if this state change came from a sync merge.
      if (skipAutoPushCountRef.current > 0) {
        skipAutoPushCountRef.current = Math.max(0, skipAutoPushCountRef.current - 1)
        console.debug('[sync] auto-push skipped (sync merge), remaining skips:', skipAutoPushCountRef.current)
        return
      }

      // Mark that we have pending local changes to sync
      setHasPendingChanges(true)

      if (syncStatusRef.current === 'synced' && state.isLoaded && reminderIsLoaded && initialSyncDoneRef.current) {
        console.debug('[sync] dose store changed — scheduling push in 2s')
        if (pushDebounceRef.current) {
          clearTimeout(pushDebounceRef.current)
          pushDebounceRef.current = null
        }
        pushDebounceRef.current = setTimeout(() => {
          pushDebounceRef.current = null
          pushToSync()
        }, 2000)
      } else {
        console.debug('[sync] dose store changed but auto-push guard failed:', {
          syncStatus: syncStatusRef.current,
          stateIsLoaded: state.isLoaded,
          reminderIsLoaded,
          initialSyncDone: initialSyncDoneRef.current,
        })
      }
    })

    const unsubReminder = useReminderStore.subscribe((state) => {
      schedulesRef.current = state.schedules
      activeRemindersRef.current = state.activeReminders
      deletedScheduleIdsRef.current = state.deletedScheduleIds
      reminderSettingsRef.current = {
        autoStartEnabled: state.autoStartEnabled,
        soundEnabled: state.soundEnabled,
      }

      // Skip auto-push if this state change came from a sync merge.
      if (skipAutoPushCountRef.current > 0) {
        skipAutoPushCountRef.current = Math.max(0, skipAutoPushCountRef.current - 1)
        console.debug('[sync] auto-push skipped (sync merge), remaining skips:', skipAutoPushCountRef.current)
        return
      }

      // Mark that we have pending local changes to sync
      setHasPendingChanges(true)

      if (syncStatusRef.current === 'synced' && isLoaded && state.isLoaded && initialSyncDoneRef.current) {
        console.debug('[sync] reminder store changed — scheduling push in 2s')
        if (pushDebounceRef.current) {
          clearTimeout(pushDebounceRef.current)
          pushDebounceRef.current = null
        }
        pushDebounceRef.current = setTimeout(() => {
          pushDebounceRef.current = null
          pushToSync()
        }, 2000)
      }
    })

    const unsubCustomSubstances = useCustomSubstanceStore.subscribe((state) => {
      customSubstancesRef.current = state.substances
      deletedCustomSubstanceIdsRef.current = state.deletedIds

      if (skipAutoPushCountRef.current > 0) {
        skipAutoPushCountRef.current = Math.max(0, skipAutoPushCountRef.current - 1)
        return
      }

      setHasPendingChanges(true)
      if (
        syncStatusRef.current === 'synced' &&
        state.loaded &&
        isLoaded &&
        reminderIsLoaded &&
        medicationsLoaded &&
        initialSyncDoneRef.current
      ) {
        if (pushDebounceRef.current) clearTimeout(pushDebounceRef.current)
        pushDebounceRef.current = setTimeout(() => {
          pushDebounceRef.current = null
          pushToSync()
        }, 2000)
      }
    })

    const unsubMedications = useMedicationStore.subscribe((state) => {
      medicationsRef.current = state.medications
      deletedMedicationIdsRef.current = state.deletedIds

      if (skipAutoPushCountRef.current > 0) {
        skipAutoPushCountRef.current = Math.max(0, skipAutoPushCountRef.current - 1)
        return
      }

      setHasPendingChanges(true)
      if (
        syncStatusRef.current === 'synced' &&
        state.loaded &&
        isLoaded &&
        reminderIsLoaded &&
        customSubstancesLoaded &&
        initialSyncDoneRef.current
      ) {
        if (pushDebounceRef.current) clearTimeout(pushDebounceRef.current)
        pushDebounceRef.current = setTimeout(() => {
          pushDebounceRef.current = null
          pushToSync()
        }, 2000)
      }
    })

    return () => {
      unsubDose()
      unsubReminder()
      unsubCustomSubstances()
      unsubMedications()
      if (pushDebounceRef.current) {
        clearTimeout(pushDebounceRef.current)
        pushDebounceRef.current = null
      }
    }
  }, [
    pushToSync,
    isLoaded,
    reminderIsLoaded,
    customSubstancesLoaded,
    medicationsLoaded,
  ])

  // Timeout guard to prevent endless "connecting" - if Firestore never calls back (no network, bad config, blocked CSP etc)
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const connectToSync = useCallback(async (rId?: string, pass?: string) => {
    const effectiveRId = rId ?? roomIdRef.current
    const effectivePass = pass ?? passwordRef.current
    if (!effectiveRId || !effectivePass) return
    if (!window.crypto?.subtle) {
      toast({ title: 'Encryption Blocked', description: 'HTTPS is required for syncing.', variant: 'destructive' })
      return
    }

    if (unsubscribeRef.current) {
      unsubscribeRef.current()
      unsubscribeRef.current = null
    }
    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current)
      connectTimeoutRef.current = null
    }

    setSyncStatus('connecting')
    try {
      cryptoKeyRef.current = await deriveKey(effectivePass, effectiveRId)
      hashedRoomRef.current = await hashRoomName(effectiveRId, effectivePass)
      // B4 fix: do NOT persist credentials yet. The snapshot listener may
      // fail (permissions, wrong password-derived hash, network). We only
      // persist once the first snapshot arrives successfully — see the
      // `if (!initialSyncDoneRef.current)` block inside processSnapshot.
      initialSyncDoneRef.current = false

      const db = getDb()
      if (!db) {
        const missing = getMissingFirebaseKeys()
        const debug = getFirebaseConfigDebug()
        console.error('[sync] Firebase not configured, missing:', missing, 'present:', debug)
        setSyncStatus('error')
        toast({
          title: 'Sync Unavailable',
          description: missing.length
            ? `Missing Firebase config: ${missing.join(', ')}. This build was created without Firebase env vars. Check GitHub Actions secrets and rebuild. Presence: ${Object.entries(debug).map(([k, v]) => `${k}=${v ? 'ok' : 'MISSING'}`).join(', ')}`
            : 'Firebase is not configured. Check your environment variables.',
          variant: 'destructive',
        })
        return
      }

      const docRef = doc(db, 'secure_rooms', hashedRoomRef.current)

      // Track the latest unprocessed snapshot so we don't lose data
      // when a push is in progress.  Instead of dropping the snapshot
      // entirely, we queue it and process it once the push completes.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let pendingSnap: any = null
      let isProcessingSnap = false

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const processSnapshot = async (docSnap: any) => {
        isProcessingSnap = true
        console.debug('[sync] processSnapshot starting, doc exists:', docSnap.exists())
        try {
          // Determine if this is the FIRST EVER sync (not just first this session).
          // Used to gate the "Secure Sync Active" toast and credential persistence.
          const isFirstEverSync = !hasSyncedBefore()

          if (!docSnap.exists()) {
            // New room — nothing to pull, push local state immediately.
            console.debug('[sync] new empty room — pushing local state')
            initialSyncDoneRef.current = true
            setSyncStatus('synced')
            setLastSyncedAt(new Date().toISOString())
            if (isFirstEverSync && !hasShownActiveToastRef.current) {
              hasShownActiveToastRef.current = true
              toast({ title: 'Secure Sync Active', description: 'Your data is now end-to-end encrypted and syncing.' })
            }
            // Persist "has synced" so isFirstEverSync is false on reconnects —
            // otherwise the toast fires every time the listener re-attaches.
            if (isFirstEverSync) markHasSynced()
            saveSyncCredentials(effectiveRId, effectivePass)
            // Route through pushToSyncRef so we always invoke the latest
            // pushToSync (whose closure has the current isLoaded /
            // reminderIsLoaded). Calling pushToSync() directly here would
            // capture the version from when connectToSync was created —
            // which, with the ref-based auto-connect effect, may be from
            // before Zustand hydration (isLoaded=false), causing every
            // push to be silently skipped.
            pushToSyncRef.current?.()
            return
          }

          const remoteData = docSnap.data()
          const remoteHash = remoteData.encrypted?.ciphertext?.substring(0, 32)
          console.debug('[sync] remote data received, remoteHash:', remoteHash?.substring(0, 8) + '...', 'lastPushedHash:', lastPushedHashRef.current?.substring(0, 8) + '...')
          if (remoteHash && remoteHash === lastPushedHashRef.current) {
            // Even for echo-suppressed snapshots, mark initial sync done
            // so the auto-push can resume
            console.debug('[sync] snapshot is echo of our own push — skipping merge')
            initialSyncDoneRef.current = true
            setSyncStatus('synced')
            setLastSyncedAt(new Date().toISOString())
            // Echo of our own push — credentials are already valid.
            // D3: use the split storage helpers instead of plaintext blob.
            if (!loadSyncCredentials()) {
              saveSyncCredentials(effectiveRId, effectivePass)
            }
            // An echo is still proof that we are connected and writing
            // successfully — persist the "has synced" flag so a later
            // listener re-attach (e.g. hydration flipping isLoaded) does
            // not re-fire the "first ever sync" toast.
            if (isFirstEverSync) markHasSynced()
            return
          }

          try {
            const payload = await decryptData(remoteData.encrypted, cryptoKeyRef.current!)
            console.debug('[sync] decrypt succeeded — remote doses:', Array.isArray(payload) ? payload.length : payload.doses?.length ?? 0)

            // ─── Dose merge (backward-compatible with old format) ───
            const remoteDoses: DoseLog[] = Array.isArray(payload) ? payload : payload.doses ?? []
            const remoteDeleted: Set<string> = new Set(Array.isArray(payload) ? [] : payload.deleted ?? [])

            const localDoses = useDoseStore.getState().doses
            const localDeleted = useDoseStore.getState().deletedIds
            console.debug('[sync] merging — local:', localDoses.length, 'doses, remote:', remoteDoses.length, 'doses')

            // Determine if this is the FIRST EVER sync (not just first this session).
            // On first-ever sync, we ignore local deletions to avoid wiping a new remote room.
            // On reconnect, we respect local deletions so they propagate to the remote.
            const isFirstEverSync = !hasSyncedBefore()
            const isFirstSyncThisSession = !initialSyncDoneRef.current
            initialSyncDoneRef.current = true
            setSyncStatus('synced')
            if (isFirstEverSync && !hasShownActiveToastRef.current) {
              hasShownActiveToastRef.current = true
              toast({ title: 'Secure Sync Active', description: 'Your data is now end-to-end encrypted and syncing.' })
            }
            setLastSyncedAt(new Date().toISOString())

            // B4 fix: now that we've successfully decrypted the remote payload,
            // we know the credentials are valid. Persist them so we can
            // auto-reconnect on next page load.
            // D3: use the split storage helpers instead of plaintext blob.
            if (isFirstEverSync) {
              saveSyncCredentials(effectiveRId, effectivePass)
            }

            // Only ignore local deletions on the FIRST EVER sync, not on reconnect.
            const effectiveLocalDeleted = isFirstEverSync ? new Set<string>() : localDeleted

            // D2 — Load the "last synced" baseline so we can detect
            // true conflicts (both sides edited the same dose since the
            // last sync). The baseline is a map of doseId → updatedAt.
            // On first sync (no baseline yet), this is empty and we
            // fall back to pure updatedAt-wins with no conflicts.
            const baseline = loadDoseBaseline()
            const { doses: merged, deleted: mergedDeleted, conflicts: newConflicts } = mergeDoses(
              localDoses, remoteDoses, effectiveLocalDeleted, remoteDeleted, baseline,
            )

            // D2 — Queue any new conflicts for user resolution. We
            // don't overwrite already-pending conflicts (the user may
            // still be reviewing an earlier batch).
            if (newConflicts.length > 0) {
              setPendingConflicts((prev) => {
                const seen = new Set(prev.map((c) => c.id))
                const merged = [...prev]
                for (const c of newConflicts) {
                  if (!seen.has(c.id)) {
                    merged.push(c)
                    seen.add(c.id)
                  }
                }
                return merged
              })
            }

            // D2 — Update the baseline to the merged state. Next sync
            // will compare against this. We snapshot updatedAt for
            // every dose in the merged result.
            saveDoseBaseline(merged)

            // Mark that we've successfully synced at least once.
            // This ensures future reconnects respect local deletions.
            if (isFirstEverSync) {
              markHasSynced()
            }

            // ─── Reminder merge ───
            const remoteSchedules: ReminderSchedule[] = payload.schedules ?? []
            const remoteDeletedSchedules: Set<string> = new Set(payload.deletedSchedules ?? [])
            const remoteActiveReminders: ActiveReminder[] = payload.activeReminders ?? []
            const remoteReminderSettings = payload.reminderSettings ?? {}

            const localSchedules = useReminderStore.getState().schedules
            const localDeletedScheduleIds = useReminderStore.getState().deletedScheduleIds
            const localActiveReminders = useReminderStore.getState().activeReminders

            // On first EVER sync, ignore local schedule deletions (same as doses)
            const effectiveLocalDeletedSchedules = isFirstEverSync ? new Set<string>() : localDeletedScheduleIds

            const { schedules: mergedSchedules, deleted: mergedDeletedSchedules } = mergeSchedules(
              localSchedules, remoteSchedules, effectiveLocalDeletedSchedules, remoteDeletedSchedules,
            )
            const mergedActiveReminders = mergeActiveReminders(localActiveReminders, remoteActiveReminders)

            // ─── Custom substance + medication profile merge ───
            const customState = useCustomSubstanceStore.getState()
            const medicationState = useMedicationStore.getState()
            const remoteCustomSubstances: CustomSubstance[] = payload.customSubstances ?? []
            const remoteDeletedCustomSubstances = new Set<string>(payload.deletedCustomSubstances ?? [])
            const remoteMedications: UserMedication[] = payload.medications ?? []
            const remoteDeletedMedications = new Set<string>(payload.deletedMedications ?? [])

            const { items: mergedCustomSubstances, deleted: mergedDeletedCustomSubstances } =
              mergeVersionedCollection(
                customState.substances,
                remoteCustomSubstances,
                isFirstEverSync ? new Set<string>() : customState.deletedIds,
                remoteDeletedCustomSubstances,
              )
            const { items: mergedMedications, deleted: mergedDeletedMedications } =
              mergeVersionedCollection(
                medicationState.medications,
                remoteMedications,
                isFirstEverSync ? new Set<string>() : medicationState.deletedIds,
                remoteDeletedMedications,
              )

            const profileNeedsConsolidatedPush =
              versionedCollectionSignature(mergedCustomSubstances, mergedDeletedCustomSubstances) !==
              versionedCollectionSignature(remoteCustomSubstances, remoteDeletedCustomSubstances) ||
              versionedCollectionSignature(mergedMedications, mergedDeletedMedications) !==
              versionedCollectionSignature(remoteMedications, remoteDeletedMedications)

            // Prevent the incoming sync merge from triggering auto-pushes.
            // Four stores are updated below, so each subscription receives one
            // skip token and does not echo the snapshot straight back.
            skipAutoPushCountRef.current += 4

            setDosesFromSync(merged, mergedDeleted)
            setRemindersFromSync(
              mergedSchedules,
              mergedActiveReminders,
              mergedDeletedSchedules,
              {
                autoStartEnabled: remoteReminderSettings.autoStartEnabled,
                soundEnabled: remoteReminderSettings.soundEnabled,
              },
            )
            setCustomSubstancesFromSync(mergedCustomSubstances, mergedDeletedCustomSubstances)
            setMedicationsFromSync(mergedMedications, mergedDeletedMedications)

            // If this device contributed records that were not in the remote
            // snapshot, persist the consolidated profile after all store refs
            // have been updated. Echo snapshots are suppressed by ciphertext.
            if (profileNeedsConsolidatedPush) {
              setHasPendingChanges(true)
              if (pushDebounceRef.current) clearTimeout(pushDebounceRef.current)
              pushDebounceRef.current = setTimeout(() => {
                pushDebounceRef.current = null
                pushToSyncRef.current?.()
              }, 250)
            }

          } catch (e) {
            console.error('[sync] Decryption failed:', e)
            setSyncStatus('error')
            toast({ title: 'Sync Decryption Failed', description: 'Wrong password or corrupted data. Disconnect and reconnect with the correct password.', variant: 'destructive' })
          }
        } finally {
          isProcessingSnap = false
          console.debug('[sync] processSnapshot finished, isProcessingSnap reset to false, pendingSnap:', !!pendingSnap)
          // Process any snapshot that arrived while we were busy
          if (pendingSnap) {
            const next = pendingSnap
            pendingSnap = null
            console.debug('[sync] processing queued pending snapshot')
            processSnapshot(next)
          }
        }
      }

      // Clear any previous timeout
      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current)
        connectTimeoutRef.current = null
      }

      // Timeout: if Firestore doesn't respond within 30s, show error instead
      // of endless connecting.
      //
      // Why 30s (was 15s): a brand-new Firestore database in "production mode"
      // can take 20-25 seconds to provision the first onSnapshot listener.
      // 15s was too aggressive and gave false-positive timeouts on cold starts.
      // 30s is still short enough that a real network failure is surfaced
      // before the user gives up.
      connectTimeoutRef.current = setTimeout(() => {
        if (syncStatusRef.current === 'connecting' && !initialSyncDoneRef.current) {
          const missing = getMissingFirebaseKeys()
          const debug = getFirebaseConfigDebug()
          console.error('[sync] Connection timeout after 30s - no snapshot received. Firebase present:', debug, 'missing:', missing)
          setSyncStatus('error')
          toast({
            title: 'Sync connection timeout',
            description: missing.length > 0
              ? `Build missing Firebase config (${missing.join(', ')}). Rebuild with env vars from GitHub secrets.`
              : `No response from Firestore after 30s. Most common fixes: (1) create the Firestore database in Firebase Console (it is NOT auto-created), (2) deploy firestore.rules from the repo, (3) check that you are not on a network blocking WebSockets. Project: ${firebaseConfig.projectId || 'unknown'}`,
            variant: 'destructive',
          })
        }
      }, 30000)

      unsubscribeRef.current = onSnapshot(docRef, {
        next: async (docSnap) => {
          // First successful snapshot - clear timeout
          if (connectTimeoutRef.current) {
            clearTimeout(connectTimeoutRef.current)
            connectTimeoutRef.current = null
          }
          console.debug('[sync] snapshot received:', {
            exists: docSnap.exists(),
            isPushing: isPushingRef.current,
            isProcessingSnap,
          })
          // If we're currently pushing or processing a previous snapshot,
          // queue this one for later instead of dropping it.
          if (isPushingRef.current || isProcessingSnap) {
            pendingSnap = docSnap
            console.debug('[sync] snapshot queued (push/processing in progress)')
            return
          }
          processSnapshot(docSnap)
        },
        error: (err) => {
          if (connectTimeoutRef.current) {
            clearTimeout(connectTimeoutRef.current)
            connectTimeoutRef.current = null
          }
          console.error('[sync] Firestore snapshot error:', err)
          setSyncStatus('error')
          // Surface the Firestore error code so the user can act on it.
          // Common codes:
          //   - permission-denied: rules block access → deploy firestore.rules
          //   - not-found: database doesn't exist → create it in Firebase Console
          //   - unavailable: temporarily down or region issue → retry later
          //   - unauthenticated: this code path doesn't use Firebase Auth,
          //     so this usually means the project ID is wrong
          const code = (err as { code?: string })?.code || ''
          const msg = err instanceof Error ? err.message : String(err)
          let hint = ''
          if (code.includes('permission-denied') || msg.includes('PERMISSION_DENIED')) {
            hint = ' Firestore rules block access. Deploy firestore.rules from the repo: firebase deploy --only firestore:rules'
          } else if (code.includes('not-found')) {
            hint = ' Firestore database not created. Go to Firebase Console → Firestore Database → Create database.'
          } else if (code.includes('unauthenticated')) {
            hint = ' Project ID may be wrong. Verify NEXT_PUBLIC_FIREBASE_PROJECT_ID.'
          }
          toast({
            title: 'Sync Error',
            description: `Lost connection: ${msg.substring(0, 100)}${hint}`,
            variant: 'destructive',
          })
        }
      })

      // Note: we do NOT set status to 'synced' here. The status is set to
      // 'synced' inside processSnapshot() only after the first real snapshot
      // arrives successfully. This avoids a misleading "Synced" flash if
      // Firestore rules deny access (the onSnapshot error callback would
      // then fire and set 'error', but the user would have already seen
      // "Secure Sync Active" momentarily).
      // Status already set to 'connecting' at start, with timeout guard above
    } catch (error) {
      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current)
        connectTimeoutRef.current = null
      }
      console.error('Sync connection error:', error)
      setSyncStatus('error')
    }
    // roomId and password are read via refs to avoid recreating on every keystroke
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isLoaded,
    reminderIsLoaded,
    customSubstancesLoaded,
    medicationsLoaded,
    setDosesFromSync,
    setRemindersFromSync,
    setCustomSubstancesFromSync,
    setMedicationsFromSync,
    pushToSync,
    setSyncStatus,
  ])

  const disconnectSync = useCallback(() => {
    if (unsubscribeRef.current) unsubscribeRef.current()
    unsubscribeRef.current = null
    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current)
      connectTimeoutRef.current = null
    }
    cryptoKeyRef.current = null
    hashedRoomRef.current = null
    lastPushedHashRef.current = null
    skipAutoPushCountRef.current = 0
    lastWriteTimeRef.current = 0
    if (pushDebounceRef.current) {
      clearTimeout(pushDebounceRef.current)
      pushDebounceRef.current = null
    }
    localStorage.removeItem(SYNC_AUTH_KEY)
    // D3 — clear both room and password from their split storage.
    clearSyncCredentials()
    // D2 — clear the baseline and pending conflicts so a reconnect
    // starts fresh (no stale "last synced" state).
    clearDoseBaseline()
    setPendingConflicts([])
    setSyncStatus('idle')
    setLastSyncedAt(null)
    setRoomId('')
    setPassword('')
    toast({ title: 'Sync Disconnected', description: 'Data will only save locally.' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSyncStatus])

  // D2 — Resolve a pending conflict.
  //   'local'  — overwrite the remote by writing local back with a fresh
  //              updatedAt (next push propagates it).
  //   'remote' — discard the local version; the merged state already
  //              kept the remote (since remote-wins is the default), so
  //              we just need to remove the conflict from the queue.
  //   'both'   — keep the remote (already in the store) AND create a
  //              new dose from the local version with a fresh ID.
  const resolveConflict = useCallback((conflictId: string, choice: 'local' | 'remote' | 'both') => {
    const conflict = pendingConflicts.find((c) => c.id === conflictId)
    if (!conflict) return

    if (choice === 'local') {
      // Re-apply local version with bumped updatedAt so it wins next push
      const now = new Date().toISOString()
      useDoseStore.getState().updateDose({ ...conflict.local, updatedAt: now })
      toast({
        title: 'Conflict resolved',
        description: `Kept your version of ${conflict.local.substanceName}.`,
      })
    } else if (choice === 'both') {
      // Create a new dose from the local version with a fresh ID
      const now = new Date().toISOString()
      const newId = `dose_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      useDoseStore.getState().addDose({
        ...conflict.local,
        id: newId,
        notes: conflict.local.notes ? `${conflict.local.notes}\n[duplicate from sync conflict]` : '[duplicate from sync conflict]',
        createdAt: now,
        updatedAt: now,
      })
      toast({
        title: 'Conflict resolved',
        description: `Kept both versions of ${conflict.local.substanceName}.`,
      })
    } else {
      // 'remote' — nothing to do, the merge already kept the remote.
      toast({
        title: 'Conflict resolved',
        description: `Kept the synced version of ${conflict.local.substanceName}.`,
      })
    }

    setPendingConflicts((prev) => prev.filter((c) => c.id !== conflictId))
  }, [pendingConflicts])

  const dismissConflict = useCallback((conflictId: string) => {
    setPendingConflicts((prev) => prev.filter((c) => c.id !== conflictId))
  }, [])

  // Keep a live ref to connectToSync so the auto-connect effect can call
  // the latest version without re-subscribing every time connectToSync's
  // identity changes (which happens when isLoaded / reminderIsLoaded flip
  // after Zustand hydration). Previously, the effect had `connectToSync`
  // in its deps, so each hydration flip would: run cleanup (unsubscribe
  // the Firestore onSnapshot listener) → re-run the effect → call
  // connectToSync again → attach a new listener → first snapshot arrives
  // → "Secure Sync Active" toast fired again. Using a ref breaks that
  // cycle: the effect runs once on mount, and the cleanup only runs on
  // unmount.
  const connectToSyncRef = useRef(connectToSync)
  useEffect(() => { connectToSyncRef.current = connectToSync }, [connectToSync])

  // Auto-connect on load.
  // D3 — Only the room name is in localStorage (not sensitive). The
  // password is in sessionStorage, so auto-reconnect only works within
  // the same tab session. If the user closed the tab, the room name
  // is pre-filled but they'll need to re-enter the password.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setState in useEffect is intentional for auto-connect
  useEffect(() => {
    const creds = loadSyncCredentials()
    if (creds) {
      setRoomId(creds.room)
      setPassword(creds.pass)
      connectToSyncRef.current(creds.room, creds.pass)
    } else {
      // No password in sessionStorage — but maybe the room name is in
      // localStorage from a previous session. Pre-fill it so the user
      // only has to type the password.
      const storedRoom = hasStoredRoom()
      if (storedRoom) setRoomId(storedRoom)
    }
    return () => { if (unsubscribeRef.current) unsubscribeRef.current() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const contextValue = useMemo(() => ({
    syncStatus, lastSyncedAt, roomId, password, setRoomId, setPassword, connectToSync, disconnectSync, pushToSync,
    pendingConflicts, resolveConflict, dismissConflict,
    hasPendingChanges,
  }), [syncStatus, lastSyncedAt, roomId, password, connectToSync, disconnectSync, pushToSync, pendingConflicts, resolveConflict, dismissConflict, hasPendingChanges])

  return (
    <SyncContext.Provider value={contextValue}>
      {children}
    </SyncContext.Provider>
  )
}

export const useSync = () => {
  const context = useContext(SyncContext)
  if (!context) throw new Error("useSync must be used within a SyncProvider")
  return context
}
