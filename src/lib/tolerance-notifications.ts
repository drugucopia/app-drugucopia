/**
 * Tolerance Notification Engine
 *
 * Periodically checks tolerance levels using the analytics engine and sends
 * notifications when substances cross user-configured thresholds.
 */

import { useDoseStore } from "@/store/dose-store";
import { useToleranceNotificationStore } from "@/store/tolerance-notification-store";
import { estimateTolerance, ToleranceEstimate } from "@/lib/analytics";
import {
  isTauri,
  sendGenericNotification,
  requestNotificationPermission,
  checkNotificationPermission,
} from "./tauri-bridge";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NotificationCooldown {
  substanceName: string;
  lastSent: number;
}

// ─── State ────────────────────────────────────────────────────────────────────

let intervalId: ReturnType<typeof setInterval> | null = null;
let hasPrimed = false;

const COOLDOWN_STORAGE_KEY = "drugucopia-tolerance-cooldown";
const COOLDOWN_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

const notificationCooldowns = new Map<string, number>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadCooldownState(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(COOLDOWN_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, number>;
    const now = Date.now();
    for (const [key, ts] of Object.entries(parsed)) {
      if (typeof ts === "number" && now - ts < COOLDOWN_MAX_AGE_MS) {
        notificationCooldowns.set(key, ts);
      }
    }
  } catch { }
}

function persistCooldownState(): void {
  if (typeof window === "undefined") return;
  try {
    const obj: Record<string, number> = {};
    const now = Date.now();
    for (const [key, ts] of notificationCooldowns) {
      if (now - ts < COOLDOWN_MAX_AGE_MS) {
        obj[key] = ts;
      }
    }
    localStorage.setItem(COOLDOWN_STORAGE_KEY, JSON.stringify(obj));
  } catch { }
}

function substanceKey(name: string): string {
  return name.toLowerCase().trim();
}

async function ensureNotificationPermission(): Promise<boolean> {
  try {
    const current = await checkNotificationPermission().catch(() => "default" as any);
    if (current === "granted") return true;
    const result = await requestNotificationPermission().catch(() => "denied" as any);
    return result === "granted";
  } catch {
    return false;
  }
}

async function sendToleranceNotification(
  substanceName: string,
  body: string,
  tag: string
): Promise<void> {
  const hasPerm = await ensureNotificationPermission();
  if (!hasPerm) {
    console.warn("[tolerance-notif] no permission — skipping notification", substanceName);
    return;
  }

  try {
    await sendGenericNotification(substanceName, body, tag);
    console.log("[tolerance-notif] ✅ sent notification:", substanceName, body);
  } catch (e) {
    console.warn("[tolerance-notif] sendGenericNotification failed:", e);
  }
}

function canSendNotification(
  key: string,
  cooldownMinutes: number
): boolean {
  const now = Date.now();
  const lastSent = notificationCooldowns.get(key);
  const cooldownMs = cooldownMinutes * 60_000;
  if (lastSent && now - lastSent < cooldownMs) {
    console.log(
      `[tolerance-notif] Cooldown active for ${key} (${Math.round((cooldownMs - (now - lastSent)) / 1000)}s remaining)`
    );
    return false;
  }
  return true;
}

function recordNotificationSent(key: string): void {
  const now = Date.now();
  notificationCooldowns.set(key, now);
  persistCooldownState();
}

// ─── Core ─────────────────────────────────────────────────────────────────────

async function checkAndNotify(force = false): Promise<void> {
  try {
    const settings = useToleranceNotificationStore.getState().settings;

    if (!settings.enabled) {
      console.log("[tolerance-notif] disabled via settings — skipping");
      return;
    }

    const ds = useDoseStore.getState();
    if (!ds.isLoaded && typeof ds.initialize === "function") {
      try {
        ds.initialize();
      } catch { }
    }
    const doses = useDoseStore.getState().doses;

    // Priming: on first check after module load, just observe without sending
    if (!hasPrimed && !force) {
      const freshState = useDoseStore.getState();
      if (!freshState.isLoaded || doses.length === 0) {
        console.log(
          "[tolerance-notif] PRIMING deferred — dose store not yet hydrated (isLoaded=",
          freshState.isLoaded,
          "doses=",
          doses.length,
          ")"
        );
        return;
      }

      console.log("[tolerance-notif] PRIMING — computing tolerance without sending notifications");
      hasPrimed = true;
      loadCooldownState();

      // Schedule a real check after a short delay
      setTimeout(() => {
        checkAndNotify(false).catch(() => {});
      }, 2000);
      return;
    }

    console.log(
      "[tolerance-notif] checkAndNotify running — force=",
      force,
      "doses in store:",
      doses.length,
      "isLoaded:",
      ds.isLoaded,
      "hasPrimed:",
      hasPrimed
    );

    if (doses.length === 0) return;

    const tolerance = estimateTolerance(doses);
    if (tolerance.length === 0) return;

    const { notifyOnHigh, notifyOnLow, notifyOnBaseline, notificationCooldownMinutes } = settings;

    for (const t of tolerance) {
      const key = substanceKey(t.substanceName);
      const level = t.level;
      const isHigh = level === "high" || level === "very-high";
      const isLow = level === "low" || level === "moderate";
      const isBaseline = level === "baseline";

      const shouldNotify =
        (notifyOnHigh && isHigh) ||
        (notifyOnLow && isLow) ||
        (notifyOnBaseline && isBaseline);

      if (!shouldNotify) continue;

      if (!canSendNotification(key, notificationCooldownMinutes)) {
        console.log(`[tolerance-notif] Skipping ${key} due to cooldown`);
        continue;
      }

      const pct = Math.round(t.currentLevel * 100);
      const daysInfo = t.daysToBaseline > 0 ? ` ~${t.daysToBaseline}d to baseline` : " at baseline";
      const body = `${pct}% tolerance${daysInfo}`;

      const tag = `drugucopia-tolerance-${key}`;
      await sendToleranceNotification(t.substanceName, body, tag);

      recordNotificationSent(key);
    }
  } catch (err) {
    console.error("[tolerance-notif] checkAndNotify failed:", err);
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

export function startToleranceNotifications(): void {
  if (intervalId) return;

  const settings = useToleranceNotificationStore.getState().settings;
  if (!settings.enabled) {
    console.log("[tolerance-notif] Not starting — disabled in settings");
    return;
  }

  console.log("[tolerance-notif] starting tolerance notification engine");

  ensureNotificationPermission().catch(() => {});

  checkAndNotify(false);

  const intervalMs = settings.checkIntervalMinutes * 60_000;
  intervalId = setInterval(() => {
    checkAndNotify();
  }, intervalMs);
}

export function stopToleranceNotifications(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  hasPrimed = false;
}

export function resetToleranceNotifications(): void {
  notificationCooldowns.clear();
  hasPrimed = false;
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(COOLDOWN_STORAGE_KEY);
    } catch { }
  }
}

export async function forceToleranceCheck(): Promise<void> {
  try {
    await ensureNotificationPermission().catch(() => {});
    await checkAndNotify(true);
  } catch (e) {
    console.warn("[tolerance-notif] forceToleranceCheck failed", e);
  }
}