'use client';

import { useState, useMemo } from 'react';
import { CheckSquare, Square } from 'lucide-react';
import { useToleranceNotificationStore } from '@/store/tolerance-notification-store';
import { getAllSubstances, type Substance } from '@/lib/substances';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Collapse } from '@/components/ui/collapse';
import { cn } from '@/lib/utils';

const CATEGORY_DOTS: Record<string, string> = {
  stimulants: 'bg-amber-500',
  depressants: 'bg-indigo-500',
  hallucinogens: 'bg-purple-500',
  dissociatives: 'bg-cyan-500',
  empathogens: 'bg-pink-500',
  cannabinoids: 'bg-green-500',
  opioids: 'bg-red-500',
  deliriants: 'bg-slate-500',
  nootropics: 'bg-teal-500',
  medications: 'bg-blue-500',
  other: 'bg-zinc-500',
};

interface OverrideOption {
  value: 'global' | 'on' | 'off';
  label: string;
}

const OVERRIDE_OPTIONS: OverrideOption[] = [
  { value: 'global', label: 'Use global' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];

export function SubstanceSelectionList() {
  const { settings, updateSettings, isLoaded } = useToleranceNotificationStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const allSubstances = useMemo(() => getAllSubstances(), []);

  const grouped = useMemo(() => {
    const groups: Record<string, Substance[]> = {};
    for (const s of allSubstances) {
      const cat = s.categories[0] ?? 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(s);
    }
    return groups;
  }, [allSubstances]);

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return grouped;
    const q = searchQuery.toLowerCase().trim();
    const filtered: Record<string, Substance[]> = {};
    for (const [cat, subs] of Object.entries(grouped)) {
      const matches = subs.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.commonNames?.some((cn) => cn.toLowerCase().includes(q)) ||
          s.id.toLowerCase().includes(q)
      );
      if (matches.length) filtered[cat] = matches;
    }
    return filtered;
  }, [grouped, searchQuery]);

  if (!isLoaded) {
    return <div className="flex justify-center py-8" role="status"><span className="loading loading-spinner loading-lg" /></div>;
  }

  const toggleSubstance = (id: string) => {
    updateSettings({
      enabledSubstances: { ...settings.enabledSubstances, [id]: !settings.enabledSubstances[id] },
    });
  };

  const getOverrideValue = (
    id: string,
    field: 'notifyOnHigh' | 'notifyOnLow' | 'notifyOnBaseline'
  ): 'global' | 'on' | 'off' => {
    const override = settings.substanceThresholds[id];
    if (!override || override[field] === undefined) return 'global';
    return override[field] ? 'on' : 'off';
  };

  const setOverride = (
    id: string,
    field: 'notifyOnHigh' | 'notifyOnLow' | 'notifyOnBaseline',
    value: 'global' | 'on' | 'off'
  ) => {
    const current = settings.substanceThresholds[id] ?? {};
    const next = { ...current };
    if (value === 'global') {
      delete next[field];
    } else {
      next[field] = value === 'on';
    }
    const nextThresholds = Object.keys(next).length ? next : undefined;
    updateSettings({
      substanceThresholds: { ...settings.substanceThresholds, [id]: nextThresholds },
    } as Partial<typeof settings>);
  };

  const toggleExpanded = (id: string) => {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedIds(next);
  };

  const selectAllVisible = () => {
    const visibleIds: string[] = [];
    for (const subs of Object.values(filteredGroups)) {
      for (const s of subs) {
        visibleIds.push(s.id);
      }
    }
    if (visibleIds.length === 0) return;
    updateSettings({
      enabledSubstances: { ...settings.enabledSubstances, ...Object.fromEntries(visibleIds.map((id) => [id, true])) },
    });
  };

  const categoryLabel = (cat: string) =>
    cat.charAt(0).toUpperCase() + cat.slice(1).replace(/-/g, ' ');

  if (Object.keys(filteredGroups).length === 0 && searchQuery.trim()) {
    return (
      <div className="text-center py-4 text-neutral-content/50">
        No substances match &ldquo;{searchQuery}&rdquo;
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Input
        placeholder="Search substances..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="w-full max-w-xs"
      />

      {searchQuery.trim() && (
        <Button
          variant="outline"
          size="sm"
          className="w-full max-w-xs"
          onClick={selectAllVisible}
        >
          <CheckSquare className="w-4 h-4 mr-2" />
          Select all visible
        </Button>
      )}

      {Object.entries(filteredGroups).map(([cat, subs]) => (
        <div key={cat} className="space-y-2">
          <div className="flex items-center justify-between">
            <h5 className="font-medium capitalize">{categoryLabel(cat)}</h5>
          </div>

          {subs.map((s) => (
            <SubstanceRow
              key={s.id}
              substance={s}
              enabled={settings.enabledSubstances[s.id] ?? false}
              onToggle={toggleSubstance}
              expanded={expandedIds.has(s.id)}
              onToggleExpanded={toggleExpanded}
              getOverrideValue={getOverrideValue}
              onSetOverride={setOverride}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

interface SubstanceRowProps {
  substance: Substance;
  enabled: boolean;
  onToggle: (id: string) => void;
  expanded: boolean;
  onToggleExpanded: (id: string) => void;
  getOverrideValue: (id: string, field: 'notifyOnHigh' | 'notifyOnLow' | 'notifyOnBaseline') => 'global' | 'on' | 'off';
  onSetOverride: (id: string, field: 'notifyOnHigh' | 'notifyOnLow' | 'notifyOnBaseline', value: 'global' | 'on' | 'off') => void;
}

function SubstanceRow({
  substance,
  enabled,
  onToggle,
  expanded,
  onToggleExpanded,
  getOverrideValue,
  onSetOverride,
}: SubstanceRowProps) {
  const id = substance.id;

  return (
    <div className="bg-base-100 rounded-lg border p-3 space-y-2">
      <label className="flex items-center justify-between gap-3 cursor-pointer">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span
            className={cn(
              'w-2 h-2 rounded-full shrink-0',
              CATEGORY_DOTS[substance.categories[0]] || 'bg-zinc-500'
            )}
          />
          <input
            type="checkbox"
            checked={enabled}
            onChange={() => onToggle(id)}
            className="checkbox checkbox-primary"
            id={`substance-${id}`}
          />
          <label
            htmlFor={`substance-${id}`}
            className="font-medium truncate cursor-pointer"
          >
            {substance.name}
          </label>
          {substance.commonNames?.[0] && (
            <span className="text-xs text-neutral-content/60">
              ({substance.commonNames[0]})
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          onClick={() => onToggleExpanded(id)}
        >
          {expanded ? '▼' : '▶'}
        </Button>
      </label>

      <Collapse open={expanded}>
        <div className="pl-8 pt-2 space-y-2 border-t border-base-300">
          {([
            { field: 'notifyOnHigh' as const, label: 'High / Very High' },
            { field: 'notifyOnLow' as const, label: 'Low / Moderate' },
            { field: 'notifyOnBaseline' as const, label: 'Baseline recovered' },
          ]).map(({ field, label }) => (
            <div key={field} className="flex items-center justify-between gap-3">
              <Label className="text-sm">{label}</Label>
              <Select
                value={getOverrideValue(id, field)}
                onChange={(e) => onSetOverride(id, field, e.target.value as 'global' | 'on' | 'off')}
                className="w-32"
              >
                {OVERRIDE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </div>
      </Collapse>
    </div>
  );
}