import { create } from "zustand";

const SETTINGS_KEY = "drugucopia-tolerance-notification-settings";

export interface ToleranceNotificationSettings {
  enabled: boolean;
  notifyOnHigh: boolean;
  notifyOnLow: boolean;
  notifyOnBaseline: boolean;
  notificationCooldownMinutes: number;
  checkIntervalMinutes: number;
}

export const DEFAULT_SETTINGS: ToleranceNotificationSettings = {
  enabled: true,
  notifyOnHigh: true,
  notifyOnLow: false,
  notifyOnBaseline: false,
  notificationCooldownMinutes: 1440, // 24 hours default
  checkIntervalMinutes: 1440, // 24 hours default
};

function loadSettings(): ToleranceNotificationSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      notificationCooldownMinutes: Math.max(1, Math.min(10080, parsed.notificationCooldownMinutes ?? 1440)),
      checkIntervalMinutes: Math.max(15, Math.min(10080, parsed.checkIntervalMinutes ?? 1440)),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persistSettings(settings: ToleranceNotificationSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore quota errors */
  }
}

interface ToleranceNotificationState {
  settings: ToleranceNotificationSettings;
  isLoaded: boolean;
  initialize: () => (() => void) | void;
  updateSettings: (patch: Partial<ToleranceNotificationSettings>) => void;
}

export const useToleranceNotificationStore = create<ToleranceNotificationState>(
  (set, get) => ({
    settings: DEFAULT_SETTINGS,
    isLoaded: false,

    initialize: () => {
      if (get().isLoaded) return;

      const settings = loadSettings();
      set({ settings, isLoaded: true });

      // Cross-tab sync
      const onStorage = (e: StorageEvent) => {
        if (e.key === SETTINGS_KEY && e.newValue) {
          try {
            const parsed = JSON.parse(e.newValue);
            set({
              settings: {
                ...DEFAULT_SETTINGS,
                ...parsed,
                notificationCooldownMinutes: Math.max(1, Math.min(10080, parsed.notificationCooldownMinutes ?? 1440)),
                checkIntervalMinutes: Math.max(15, Math.min(10080, parsed.checkIntervalMinutes ?? 1440)),
              },
            });
          } catch { }
        }
      };
      window.addEventListener("storage", onStorage);
      return () => window.removeEventListener("storage", onStorage);
    },

    updateSettings: (patch) => {
      const next = { ...get().settings, ...patch };
      // Clamp cooldown to 1-10080 minutes (1 min to 1 week)
      if (patch.notificationCooldownMinutes !== undefined) {
        next.notificationCooldownMinutes = Math.max(1, Math.min(10080, patch.notificationCooldownMinutes));
      }
      // Clamp check interval to 15-10080 minutes (15 min to 1 week)
      if (patch.checkIntervalMinutes !== undefined) {
        next.checkIntervalMinutes = Math.max(15, Math.min(10080, patch.checkIntervalMinutes));
      }
      persistSettings(next);
      set({ settings: next });
    },
  })
);