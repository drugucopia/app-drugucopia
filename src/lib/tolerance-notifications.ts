/**
 * Tolerance Notification Engine
 *
 * Periodically checks tolerance levels using the analytics engine and sends
 * notifications when substances cross user-configured thresholds.
 */

import { useDoseStore } from "@/store/dose-store";
import { useToleranceNotificationStore } from "@/store/tolerance-notification-store";
import { estimateTolerance, ToleranceEstimate } from "@/lib/analytics";
import { getAllSubstances } from "@/lib/substances";
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

export function getSubstanceId(name: string): string | undefined {
  if (!name || !name.trim()) return undefined;
  const normalizedInput = name.toLowerCase().trim();

  const substances = getAllSubstances();

  // First pass: exact name match (case-insensitive, trimmed)
  for (const substance of substances) {
    if (substance.name.toLowerCase().trim() === normalizedInput) {
      return substance.id;
    }
  }

  // Second pass: common names match (case-insensitive, trimmed)
  for (const substance of substances) {
    for (const commonName of substance.commonNames) {
      if (commonName.toLowerCase().trim() === normalizedInput) {
        return substance.id;
      }
    }
  }

  return undefined;
}

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
  } catch {}
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
  } catch {}
}

function substanceKey(name: string): string {
  return name.toLowerCase().trim();
}

async function ensureNotificationPermission(): Promise<boolean> {
  try {
    const current = await checkNotificationPermission().catch(
      () => "default" as any,
    );
    if (current === "granted") return true;
    const result = await requestNotificationPermission().catch(
      () => "denied" as any,
    );
    return result === "granted";
  } catch {
    return false;
  }
}

async function sendToleranceNotification(
  substanceName: string,
  body: string,
  tag: string,
): Promise<void> {
  const hasPerm = await ensureNotificationPermission();
  if (!hasPerm) {
    console.warn(
      "[tolerance-notif] no permission — skipping notification",
      substanceName,
    );
    return;
  }

  try {
    await sendGenericNotification(substanceName, body, tag);
    console.log("[tolerance-notif] ✅ sent notification:", substanceName, body);
  } catch (e) {
    console.warn("[tolerance-notif] sendGenericNotification failed:", e);
  }
}

function canSendNotification(key: string, cooldownMinutes: number): boolean {
  const now = Date.now();
  const lastSent = notificationCooldowns.get(key);
  const cooldownMs = cooldownMinutes * 60_000;
  if (lastSent && now - lastSent < cooldownMs) {
    console.log(
      `[tolerance-notif] Cooldown active for ${key} (${Math.round((cooldownMs - (now - lastSent)) / 1000)}s remaining)`,
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

/**
 * Result of a single tolerance check. Returned by `checkAndNotify` so callers
 * (e.g. the "Test Check Now" button) can give the user meaningful feedback
 * about what happened, instead of silently doing nothing.
 */
export interface ToleranceCheckResult {
  /** Whether tolerance notifications are enabled in settings. */
  enabled: boolean;
  /** Whether the check actually ran (false = priming/early-return). */
  ran: boolean;
  /** Total substances with any tolerance data in the dose store. */
  candidateCount: number;
  /** Substances that passed every filter and were included in the summary. */
  triggered: Array<{ substanceName: string; pct: number; level: string }>;
  /** Substances skipped because they're not selected in the Substance list. */
  skippedNotEnabled: number;
  /** Substances skipped because their level didn't match any threshold. */
  skippedThreshold: number;
  /** Substances skipped due to cooldown (only counted when bypassCooldown=false). */
  skippedCooldown: number;
  /** Substances skipped because we couldn't resolve them to a known substance ID. */
  skippedUnknown: number;
  /** Whether a notification was actually sent to the OS. */
  sent: boolean;
  /** Short, user-facing reason when nothing was sent. Empty string when sent. */
  reason: string;
}

function emptyResult(): ToleranceCheckResult {
  return {
    enabled: false,
    ran: false,
    candidateCount: 0,
    triggered: [],
    skippedNotEnabled: 0,
    skippedThreshold: 0,
    skippedCooldown: 0,
    skippedUnknown: 0,
    sent: false,
    reason: "",
  };
}

/**
 * Run a tolerance check and (optionally) send a combined summary notification.
 *
 * @param forceOrOpts - Backwards-compatible: pass `true` to bypass priming.
 *                      Pass an options object to also bypass cooldown
 *                      (`{ force: true, bypassCooldown: true }`) — this is
 *                      what `forceToleranceCheck` uses so the "Test Check Now"
 *                      button always produces a notification when there's
 *                      something to notify about.
 */
export async function checkAndNotify(
  forceOrOpts: boolean | { force?: boolean; bypassCooldown?: boolean } = false,
): Promise<ToleranceCheckResult> {
  const opts =
    typeof forceOrOpts === "boolean"
      ? { force: forceOrOpts, bypassCooldown: false }
      : forceOrOpts;
  const { force = false, bypassCooldown = false } = opts;

  const result = emptyResult();

  try {
    const settings = useToleranceNotificationStore.getState().settings;

    result.enabled = settings.enabled;

    if (!settings.enabled) {
      console.log("[tolerance-notif] disabled via settings — skipping");
      result.reason = "Tolerance notifications are disabled in settings.";
      return result;
    }

    const ds = useDoseStore.getState();
    if (!ds.isLoaded && typeof ds.initialize === "function") {
      try {
        ds.initialize();
      } catch {}
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
          ")",
        );
        result.reason = "Dose store is still loading — try again in a moment.";
        return result;
      }

      console.log(
        "[tolerance-notif] PRIMING — computing tolerance without sending notifications",
      );
      hasPrimed = true;
      loadCooldownState();

      // Schedule a real check after a short delay
      setTimeout(() => {
        checkAndNotify(false).catch(() => {});
      }, 2000);
      result.reason = "Priming — a real check will run in a few seconds.";
      return result;
    }

    console.log(
      "[tolerance-notif] checkAndNotify running — force=",
      force,
      "bypassCooldown=",
      bypassCooldown,
      "doses in store:",
      doses.length,
      "isLoaded:",
      ds.isLoaded,
      "hasPrimed:",
      hasPrimed,
    );

    result.ran = true;

    if (doses.length === 0) {
      result.reason =
        "No doses logged yet — log a dose to see tolerance updates.";
      return result;
    }

    const tolerance = estimateTolerance(doses);
    if (tolerance.length === 0) {
      result.reason = "No substances with tolerance data found in your doses.";
      return result;
    }

    result.candidateCount = tolerance.length;

    const {
      notifyOnHigh,
      notifyOnLow,
      notifyOnBaseline,
      notificationCooldownMinutes,
      enabledSubstances,
      substanceThresholds,
    } = settings;

    // Collect every substance that should trigger a notification this round.
    // We send ONE combined summary notification (with a stable tag) instead
    // of one notification per substance so the OS notification center does
    // not group/stack them into a collapsed list that requires expanding.
    const triggered: Array<{
      substanceName: string;
      key: string;
      pct: number;
      daysToBaseline: number;
      level: string;
    }> = [];

    for (const t of tolerance) {
      // Resolve substance ID for per-substance settings lookup
      const substanceId = getSubstanceId(t.substanceName);
      if (!substanceId) {
        console.log(
          `[tolerance-notif] Unknown substance "${t.substanceName}", skipping`,
        );
        result.skippedUnknown += 1;
        continue;
      }

      // Per design spec: a substance only triggers notifications when it is
      // explicitly enabled in `enabledSubstances` (value === true).
      // Substances that are absent from the map OR explicitly set to false
      // are skipped. This makes the Substance Selection list the source of
      // truth for which substances can notify.
      if (enabledSubstances[substanceId] !== true) {
        console.log(
          `[tolerance-notif] Substance ${substanceId} not enabled, skipping`,
        );
        result.skippedNotEnabled += 1;
        continue;
      }

      // Get effective thresholds: per-substance override || global setting
      const override = substanceThresholds[substanceId];
      const effectiveNotifyOnHigh = override?.notifyOnHigh ?? notifyOnHigh;
      const effectiveNotifyOnLow = override?.notifyOnLow ?? notifyOnLow;
      const effectiveNotifyOnBaseline =
        override?.notifyOnBaseline ?? notifyOnBaseline;

      const key = substanceKey(t.substanceName);
      const level = t.level;
      const isHigh = level === "high" || level === "very-high";
      const isLow = level === "low" || level === "moderate";
      const isBaseline = level === "baseline";

      const shouldNotify =
        (effectiveNotifyOnHigh && isHigh) ||
        (effectiveNotifyOnLow && isLow) ||
        (effectiveNotifyOnBaseline && isBaseline);

      if (!shouldNotify) {
        result.skippedThreshold += 1;
        continue;
      }

      if (
        !bypassCooldown &&
        !canSendNotification(key, notificationCooldownMinutes)
      ) {
        console.log(`[tolerance-notif] Skipping ${key} due to cooldown`);
        result.skippedCooldown += 1;
        continue;
      }

      triggered.push({
        substanceName: t.substanceName,
        key,
        pct: Math.round(t.currentLevel * 100),
        daysToBaseline: t.daysToBaseline,
        level,
      });
      // Only record the cooldown timestamp if we're not bypassing it —
      // otherwise a "Test Check Now" press would silently lock the user
      // out of real notifications for the next cooldown window.
      if (!bypassCooldown) {
        recordNotificationSent(key);
      }
    }

    result.triggered = triggered.map((t) => ({
      substanceName: t.substanceName,
      pct: t.pct,
      level: t.level,
    }));

    if (triggered.length === 0) {
      // Build a useful reason based on why nothing triggered.
      if (
        result.skippedNotEnabled > 0 &&
        result.skippedThreshold === 0 &&
        result.skippedCooldown === 0
      ) {
        result.reason = `No substances selected — enable substances in the Substance Selection list above.`;
      } else if (
        result.skippedThreshold > 0 &&
        result.skippedNotEnabled === 0 &&
        result.skippedCooldown === 0
      ) {
        result.reason = `All selected substances are below the configured notification thresholds.`;
      } else if (
        result.skippedCooldown > 0 &&
        result.skippedNotEnabled === 0 &&
        result.skippedThreshold === 0
      ) {
        result.reason = `All selected substances are in cooldown — wait or press Test again (cooldown is bypassed for tests).`;
      } else {
        const parts: string[] = [];
        if (result.skippedNotEnabled)
          parts.push(`${result.skippedNotEnabled} not selected`);
        if (result.skippedThreshold)
          parts.push(`${result.skippedThreshold} below threshold`);
        if (result.skippedCooldown)
          parts.push(`${result.skippedCooldown} in cooldown`);
        if (result.skippedUnknown)
          parts.push(`${result.skippedUnknown} unknown`);
        result.reason = `Nothing triggered (${parts.join(", ")}).`;
      }
      return result;
    }

    // Build a single summary body. Examples:
    //   1 substance: "Caffeine — 72% tolerance (~5d to baseline)"
    //   3 substances: "Caffeine — 72% (~5d) · MDMA — 85% (~28d) · Cannabis — 40% (~3d)"
    const lines = triggered.map((t) => {
      const daysInfo =
        t.daysToBaseline > 0
          ? ` (~${t.daysToBaseline}d to baseline)`
          : " (at baseline)";
      return `${t.substanceName} — ${t.pct}% tolerance${daysInfo}`;
    });

    const title =
      triggered.length === 1
        ? `${triggered[0].substanceName} tolerance update`
        : `Tolerance updates (${triggered.length})`;

    const body = lines.join(" · ");

    // Single stable tag — the OS / browser will REPLACE the prior tolerance
    // notification instead of stacking a new one each round. This is what
    // keeps the notification center from collapsing them into a group.
    const tag = "drugucopia-tolerance-summary";

    await sendToleranceNotification(title, body, tag);
    result.sent = true;
  } catch (err) {
    console.error("[tolerance-notif] checkAndNotify failed:", err);
    result.reason = `Check failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  return result;
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
    } catch {}
  }
}

export async function forceToleranceCheck(): Promise<ToleranceCheckResult> {
  try {
    await ensureNotificationPermission().catch(() => {});
    // `force: true` bypasses priming; `bypassCooldown: true` makes the Test
    // button actually fire even if a real check ran recently. Cooldown is
    // NOT recorded for forced checks (see checkAndNotify) so testing never
    // silences future real notifications.
    return await checkAndNotify({ force: true, bypassCooldown: true });
  } catch (e) {
    console.warn("[tolerance-notif] forceToleranceCheck failed", e);
    const result = emptyResult();
    result.reason = `Test failed: ${e instanceof Error ? e.message : String(e)}`;
    return result;
  }
}
