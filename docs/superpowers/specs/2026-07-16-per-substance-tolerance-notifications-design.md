# Per-Substance Tolerance Notifications — Design Spec

**Date:** 2026-07-16  
**Status:** Draft — awaiting user review

---

## Overview

Add per-substance notification selection to the existing tolerance notification system. Users can:

1. **Opt-in per substance** — choose exactly which substances trigger notifications
2. **Override thresholds per substance** — customize High/Low/Baseline triggers per substance (falls back to global settings)

---

## Current State

- `ToleranceNotificationSettings`: global `enabled`, `notifyOnHigh`, `notifyOnLow`, `notifyOnBaseline`, `notificationCooldownMinutes`, `checkIntervalMinutes`
- `checkAndNotify()` iterates all substances with tolerance > 0, applies global triggers
- Settings UI: global toggles + cooldown/interval inputs

---

## Data Model Changes

### `ToleranceNotificationSettings` (extended)

```ts
export interface ToleranceNotificationSettings {
  // Existing
  enabled: boolean;
  notifyOnHigh: boolean;
  notifyOnLow: boolean;
  notifyOnBaseline: boolean;
  notificationCooldownMinutes: number;
  checkIntervalMinutes: number;

  // New
  /** Substance IDs explicitly enabled for notifications */
  enabledSubstances: Record<string, boolean>; // e.g. { "caffeine": true, "mdma": false }
  /** Per-substance threshold overrides. Undefined = use global. */
  substanceThresholds: Record<string, {
    notifyOnHigh?: boolean;
    notifyOnLow?: boolean;
    notifyOnBaseline?: boolean;
  }>;
}
```

### Defaults

```ts
export const DEFAULT_SETTINGS: ToleranceNotificationSettings = {
  // ...existing defaults
  enabledSubstances: {},
  substanceThresholds: {},
};
```

### Migration (in `loadSettings`)

```ts
enabledSubstances: parsed.enabledSubstances ?? {},
substanceThresholds: parsed.substanceThresholds ?? {},
```

---

## Logic Changes

### `checkAndNotify()` in `tolerance-notifications.ts`

```ts
// Get substance ID from display name
const substanceId = getSubstanceId(t.substanceName);
if (!substanceId) continue; // unknown substance, skip

// Check if substance is enabled
if (!settings.enabledSubstances[substanceId]) continue;

// Get effective thresholds (per-substance override || global)
const override = settings.substanceThresholds[substanceId];
const notifyOnHigh = override?.notifyOnHigh ?? settings.notifyOnHigh;
const notifyOnLow = override?.notifyOnLow ?? settings.notifyOnLow;
const notifyOnBaseline = override?.notifyOnBaseline ?? settings.notifyOnBaseline;

const shouldNotify =
  (notifyOnHigh && isHigh) ||
  (notifyOnLow && isLow) ||
  (notifyOnBaseline && isBaseline);
```

### Helper: `getSubstanceId(name: string): string | undefined`

```ts
import { getAllSubstances } from '@/lib/substances';

function getSubstanceId(name: string): string | undefined {
  const all = getAllSubstances();
  const normalized = name.toLowerCase().trim();
  // Exact match on name or commonNames
  for (const s of all) {
    if (s.name.toLowerCase() === normalized) return s.id;
    if (s.commonNames?.some(cn => cn.toLowerCase() === normalized)) return s.id;
  }
  // Fallback: fuzzy match via existing toleranceHalfLifeDays logic
  // (returns undefined if not found)
}
```

---

## UI Changes

### Settings Page: New Collapsible Section

```
Tolerance Notifications
├─ Enabled          [On]
├─ Notify when:  High/Low/Baseline toggles
├─ Cooldown / Interval inputs
└─ ▼ Substance Selection (collapsible)
    ├─ 🔍 Search substances...
    ├─ Stimulants (12)      [Select all]
    │  ├─ ☑ caffeine          ▸
    │  │   [High: ☐] [Low: ☐] [Baseline: ☐]
    │  ├─ ☑ modafinil         ▸
    │  │   [High: ☑] [Low: ☐] [Baseline: ☐]
    ├─ Hallucinogens (8)  [Select all]
    │  ├─ ☐ lsd               ▸
    │  │   ...
```

### Component: `SubstanceSelectionList`

**Props:** none (reads/writes store directly)

**State:**
- `searchQuery: string`
- `expandedIds: Set<string>`

**Data source:** `getAllSubstances()` from `@/lib/substances` (includes custom substances)

**Category grouping:** Use `substance.categories[0]` as primary, fall back to `'other'`

**Row render:**
```tsx
<SubstanceRow
  substance={s}
  enabled={settings.enabledSubstances[s.id]}
  override={settings.substanceThresholds[s.id]}
  onToggleEnabled={() => updateSettings({ 
    enabledSubstances: { ...settings.enabledSubstances, [s.id]: !enabled } 
  })}
  onToggleOverride={/* update substanceThresholds[s.id] */}
/>
```

**Override UI (expanded):**
- Three toggles: High / Low / Baseline
- Each toggle: `true` | `false` | `undefined` (use global)
- Visual: indeterminate checkbox or "Use global" label

---

## Behavior Details

| Scenario | Result |
|----------|--------|
| Global `notifyOnHigh=true`, substance enabled, no override | Notify on High |
| Global `notifyOnHigh=true`, substance enabled, override `notifyOnHigh=false` | No High notify for this substance |
| Global `notifyOnHigh=false`, substance enabled, override `notifyOnHigh=true` | Notify on High for this substance |
| Substance not in `enabledSubstances` | No notifications (regardless of override) |
| Custom substance added | Appears in list automatically via `getAllSubstances()` |
| Substance renamed/removed from library | Orphaned keys in settings harmless (ignored) |

---

## Testing Strategy

### Unit Tests (`tolerance-notifications.test.ts`)

```ts
describe('per-substance thresholds', () => {
  it('uses global threshold when no override', () => {});
  it('uses override when set to true', () => {});
  it('uses override when set to false', () => {});
  it('skips substance when not in enabledSubstances', () => {});
  it('falls back gracefully for unknown substance name', () => {});
});
```

### Integration Tests
- Settings persistence round-trip (localStorage)
- Cross-tab sync via storage event
- UI toggles correctly update store

### Manual Verification Checklist

1. Enable global High trigger
2. Open Substance Selection, enable only "Caffeine"
3. Trigger tolerance check → verify caffeine notifies, others don't
4. Override caffeine: disable High, enable Low
5. Trigger check → verify caffeine Low notifies, High doesn't
6. Disable caffeine in list → verify no notifications
7. Add custom substance → verify appears in list and works

---

## Implementation Order

1. **Store** — `tolerance-notification-store.ts`: add fields, defaults, migration
2. **Logic** — `tolerance-notifications.ts`: update `checkAndNotify()`, add `getSubstanceId()`
3. **UI** — `settings/page.tsx`: add `SubstanceSelectionList` component
4. **Tests** — extend `tolerance-notifications.test.ts`
5. **Verify** — manual checklist above

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/store/tolerance-notification-store.ts` | +2 fields, defaults, migration |
| `src/lib/tolerance-notifications.ts` | `checkAndNotify()` logic, `getSubstanceId()` helper |
| `src/app/settings/page.tsx` | `SubstanceSelectionList` component + integration |
| `src/lib/tolerance-notifications.test.ts` | Unit tests for new logic |

---

## Non-Goals (Out of Scope)

- Per-substance cooldown/interval
- Per-substance notification channels/sounds
- Scheduled checks per substance (global interval only)
- Import/export substance notification profiles
- Bulk operations beyond "Select all" per category
