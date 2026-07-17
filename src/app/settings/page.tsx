'use client'

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Collapse } from '@/components/ui/collapse'
import { Bell, BellOff, Plus, Trash2, Pencil, ShieldCheck, ShieldAlert, Play, Volume2, VolumeX, AlertTriangle, Search, X } from 'lucide-react'
import { useReminderStore } from '@/store/reminder-store'
import { askNotificationPermission } from '@/lib/reminder-engine'
import { formatIntervalMinutes } from '@/lib/notification-utils'
import { previewReminderSound } from '@/lib/sound-utils'
import { searchSubstancesRanked } from '@/lib/substances/index'
import { ReminderSchedule } from '@/types'
import { toast } from '@/hooks/use-toast'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { useToleranceNotificationStore } from '@/store/tolerance-notification-store'
import { SubstanceSelectionList } from '@/components/SubstanceSelectionList'

// ─── Category dots (matches Header & dose-logger-modal) ─────────────────────
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
  other: 'bg-zinc-500',
}

function highlightMatch(text: string, query: string) {
  if (!query.trim()) return text
  const lower = text.toLowerCase()
  const lowerQuery = query.toLowerCase().trim()
  const index = lower.indexOf(lowerQuery)
  if (index === -1) return text
  return (
    <>
      {text.slice(0, index)}
      <span className="font-semibold text-primary">{text.slice(index, index + lowerQuery.length)}</span>
      {text.slice(index + lowerQuery.length)}
    </>
  )
}

// ─── Schedule Editor ─────────────────────────────────────────────────────────

function ScheduleEditor({
  schedule,
  onSave,
  onCancel,
}: {
  schedule?: ReminderSchedule
  onSave: (data: {
    substanceName: string
    substanceId?: string
    intervalMinutes: number
    maxDosesPerDay: number
    customMessage?: string
    enabled: boolean
  }) => void
  onCancel: () => void
}) {
  const [substanceName, setSubstanceName] = useState(
    schedule?.substanceName || '',
  )
  const [substanceId, setSubstanceId] = useState(
    schedule?.substanceId || '',
  )
  const [searchQuery, setSearchQuery] = useState(schedule?.substanceName || '')
  const [searchOpen, setSearchOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const searchRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const [intervalHours, setIntervalHours] = useState(
    schedule ? Math.floor(schedule.intervalMinutes / 60) : 4,
  )
  const [intervalMinutes, setIntervalMinutes] = useState(
    schedule ? schedule.intervalMinutes % 60 : 0,
  )
  const [maxDosesPerDay, setMaxDosesPerDay] = useState(
    schedule?.maxDosesPerDay || 0,
  )
  const [customMessage, setCustomMessage] = useState(
    schedule?.customMessage || '',
  )
  const [enabled, setEnabled] = useState(schedule?.enabled ?? true)

  // ── Search results (same engine as SharedNav & Quick Input) ──
  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || !searchOpen) return []
    return searchSubstancesRanked(searchQuery, { limit: 8 })
  }, [searchQuery, searchOpen])

  // Reset active index when results change
  useEffect(() => {
    setActiveIndex(-1)
  }, [searchResults.length])

  // Close dropdown on outside click
  useEffect(() => {
    if (!searchOpen) return
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [searchOpen])

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value)
    setSearchOpen(true)
    if (!value.trim()) {
      setSubstanceId('')
      setSubstanceName('')
    }
  }, [])

  const selectSubstance = useCallback((id: string, name: string) => {
    setSubstanceId(id)
    setSubstanceName(name)
    setSearchQuery(name)
    setSearchOpen(false)
    setActiveIndex(-1)
  }, [])

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!searchOpen || searchResults.length === 0) {
      if (e.key === 'Enter' && searchQuery.trim() && !substanceId) {
        e.preventDefault()
        setSubstanceId('')
        setSubstanceName(searchQuery.trim())
        setSearchOpen(false)
      }
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex((prev) => (prev < searchResults.length - 1 ? prev + 1 : 0))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : searchResults.length - 1))
        break
      case 'Tab':
        e.preventDefault()
        if (e.shiftKey) {
          setActiveIndex((prev) => (prev > 0 ? prev - 1 : searchResults.length - 1))
        } else {
          setActiveIndex((prev) => (prev < searchResults.length - 1 ? prev + 1 : 0))
        }
        break
      case 'Enter':
        e.preventDefault()
        if (activeIndex >= 0) {
          const sel = searchResults[activeIndex]
          selectSubstance(sel.substance.id, sel.substance.name)
        } else if (searchQuery.trim()) {
          setSubstanceId('')
          setSubstanceName(searchQuery.trim())
          setSearchOpen(false)
        }
        break
      case 'Escape':
        e.preventDefault()
        setSearchOpen(false)
        setActiveIndex(-1)
        break
    }
  }, [searchOpen, searchResults, activeIndex, searchQuery, substanceId, selectSubstance])

  const clearSearch = useCallback(() => {
    setSearchQuery('')
    setSubstanceId('')
    setSubstanceName('')
    setSearchOpen(false)
    setActiveIndex(-1)
    inputRef.current?.focus()
  }, [])

  const totalMinutes = intervalHours * 60 + intervalMinutes

  const handleSave = () => {
    const nameToSave = substanceName || searchQuery.trim()
    if (!nameToSave) {
      toast({
        title: 'Missing substance name',
        variant: 'destructive',
      })
      return
    }
    if (totalMinutes <= 0) {
      toast({
        title: 'Invalid interval',
        description: 'Interval must be greater than 0',
        variant: 'destructive',
      })
      return
    }
    onSave({
      substanceName: nameToSave.trim(),
      substanceId: substanceId || undefined,
      intervalMinutes: totalMinutes,
      maxDosesPerDay,
      customMessage: customMessage.trim() || undefined,
      enabled,
    })
  }

  return (
    <div className="space-y-4 py-2">
      <div className="space-y-2">
        <Label>Substance</Label>
        <div ref={searchRef} className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-content pointer-events-none" />
          <Input
            ref={inputRef}
            type="text"
            placeholder="Search substances..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            onFocus={() => { if (searchQuery.trim()) setSearchOpen(true) }}
            onKeyDown={handleSearchKeyDown}
            className="pl-9 pr-9"
          />
          {searchQuery && (
            <button
              onClick={clearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-content hover:text-base-content transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}

          {/* Search results dropdown (matches SharedNav style) */}
          <AnimatePresence>
            {searchOpen && searchResults.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.12 }}
                className="absolute z-50 top-full mt-1 w-full rounded-lg border border-base-300 bg-base-100 shadow-xl overflow-hidden"
              >
                <div className="max-h-60 overflow-y-auto p-1">
                  {searchResults.map((result, idx) => {
                    const sub = result.substance
                    const isActive = idx === activeIndex
                    const matchedAlias = result.matchField !== 'name'
                      && result.matchField !== 'class'
                      && result.matchField !== 'category'
                      && result.matchField !== 'description'
                      ? result.matchField
                      : null

                    return (
                      <button
                        key={sub.id}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          selectSubstance(sub.id, sub.name)
                        }}
                        onMouseEnter={() => setActiveIndex(idx)}
                        className={cn(
                          'flex items-center gap-2.5 w-full px-2.5 py-2 rounded-md text-sm transition-colors text-left',
                          isActive ? 'bg-accent text-accent-content' : 'hover:bg-accent/50',
                        )}
                      >
                        <div
                          className={cn(
                            'w-2 h-2 rounded-full shrink-0',
                            CATEGORY_DOTS[sub.categories[0]] || 'bg-zinc-500',
                          )}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="truncate">
                            {result.matchField === 'name'
                              ? highlightMatch(sub.name, searchQuery)
                              : sub.name}
                          </div>
                          <div className="text-[10px] text-neutral-content truncate">
                            {sub.class}
                          </div>
                        </div>
                        {matchedAlias && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-base-200 text-neutral-content truncate max-w-[90px] shrink-0">
                            {matchedAlias}
                          </span>
                        )}
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-base-300 text-neutral-content whitespace-nowrap shrink-0">
                          {sub.categories[0]}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <div className="px-2.5 py-1.5 border-t border-base-300 text-[10px] text-neutral-content flex items-center justify-between">
                  <span>{searchResults.length} result{searchResults.length !== 1 ? 's' : ''}</span>
                  <span>
                    <kbd className="px-1 py-0.5 rounded bg-base-200 border border-base-300 text-[9px] font-mono">&uarr;&darr;</kbd>
                    {' / '}
                    <kbd className="px-1 py-0.5 rounded bg-base-200 border border-base-300 text-[9px] font-mono">Tab</kbd>
                    {' '}navigate{' '}
                    <kbd className="px-1 py-0.5 rounded bg-base-200 border border-base-300 text-[9px] font-mono">&crarr;</kbd>
                    {' '}select
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Interval between doses</Label>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              min={0}
              max={24}
              step={1}
              value={intervalHours}
              onChange={(e) =>
                setIntervalHours(
                  Math.min(24, Math.max(0, parseInt(e.target.value) || 0)),
                )
              }
              onBlur={() => {
                if (isNaN(intervalHours) || intervalHours < 0) setIntervalHours(0)
                if (intervalHours > 24) setIntervalHours(24)
              }}
              className="w-20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-sm text-neutral-content whitespace-nowrap">hours</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              min={0}
              max={59}
              step={1}
              value={intervalMinutes}
              onChange={(e) =>
                setIntervalMinutes(
                  Math.min(59, Math.max(0, parseInt(e.target.value) || 0)),
                )
              }
              onBlur={() => {
                if (isNaN(intervalMinutes) || intervalMinutes < 0) setIntervalMinutes(0)
                if (intervalMinutes > 59) setIntervalMinutes(59)
              }}
              className="w-20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-sm text-neutral-content whitespace-nowrap">min</span>
          </div>
        </div>
        {totalMinutes > 0 && (
          <p className="text-xs text-neutral-content">
            Timer will fire every {formatIntervalMinutes(totalMinutes)}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label>Max doses per day</Label>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            max={24}
            value={maxDosesPerDay}
            onChange={(e) =>
              setMaxDosesPerDay(parseInt(e.target.value) || 0)
            }
            className="w-20"
          />
          <span className="text-sm text-neutral-content">
            {maxDosesPerDay === 0 ? '(unlimited)' : `dose${maxDosesPerDay !== 1 ? 's' : ''}`}
          </span>
        </div>
        <p className="text-xs text-neutral-content">
          Set to 0 for unlimited reminders per day
        </p>
      </div>

      <div className="space-y-2">
        <Label>
          Custom message <span className="text-neutral-content">(optional)</span>
        </Label>
        <Input
          value={customMessage}
          onChange={(e) => setCustomMessage(e.target.value)}
          placeholder={`Time for your next dose of ${substanceName || '...'}`}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant={enabled ? 'default' : 'outline'}
          size="sm"
          className="gap-1"
          onClick={() => setEnabled(!enabled)}
        >
          {enabled ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
          {enabled ? 'Enabled' : 'Disabled'}
        </Button>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={totalMinutes <= 0 || !substanceName.trim()}>
          {schedule ? 'Save Changes' : 'Add Schedule'}
        </Button>
      </DialogFooter>
    </div>
  )
}

// ─── Reminder Settings Section ─────────────────────────────────────────────────

function ReminderSettingsSection() {
  const schedules = useReminderStore((s) => s.schedules)
  const addSchedule = useReminderStore((s) => s.addSchedule)
  const updateSchedule = useReminderStore((s) => s.updateSchedule)
  const removeSchedule = useReminderStore((s) => s.removeSchedule)
  const autoStartEnabled = useReminderStore((s) => s.autoStartEnabled)
  const setAutoStartEnabled = useReminderStore((s) => s.setAutoStartEnabled)
  const notificationPermission = useReminderStore(
    (s) => s.notificationPermission,
  )
  const soundEnabled = useReminderStore((s) => s.soundEnabled)
  const setSoundEnabled = useReminderStore((s) => s.setSoundEnabled)

  const [showAddDialog, setShowAddDialog] = useState(false)
  const [editingSchedule, setEditingSchedule] =
    useState<ReminderSchedule | null>(null)

  const handleAddSchedule = (data: {
    substanceName: string
    substanceId?: string
    intervalMinutes: number
    maxDosesPerDay: number
    customMessage?: string
    enabled: boolean
  }) => {
    addSchedule({
      id: crypto.randomUUID(),
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    setShowAddDialog(false)
    toast({
      title: 'Reminder schedule added',
      description: `${data.substanceName} — every ${formatIntervalMinutes(data.intervalMinutes)}`,
    })
  }

  const handleEditSchedule = (data: {
    substanceName: string
    substanceId?: string
    intervalMinutes: number
    maxDosesPerDay: number
    customMessage?: string
    enabled: boolean
  }) => {
    if (!editingSchedule) return
    updateSchedule(editingSchedule.id, { ...data, updatedAt: new Date().toISOString() })
    setEditingSchedule(null)
    toast({
      title: 'Schedule updated',
      description: `${data.substanceName} reminder saved`,
    })
  }

  const handleRequestPermission = async () => {
    const result = await askNotificationPermission()
    if (result === 'granted') {
      toast({ title: 'Notifications enabled' })
    } else {
      toast({
        title: 'Notifications blocked',
        description: 'Please enable notifications in your browser settings',
        variant: 'destructive',
      })
    }
  }

  return (
    <Card className="py-3 gap-2">
      <CardHeader className="pb-1">
        <CardTitle className="text-lg flex items-center gap-2">
          <Bell className="h-5 w-5 text-amber-500" />
          Dose Reminders
        </CardTitle>
        <CardDescription>
          Auto-start timers when you log a dose
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* ── Global settings ── */}
        <div className="space-y-3">
          {/* Auto-start toggle */}
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Auto-start reminders</p>
              <p className="text-xs text-neutral-content">
                Start a timer automatically when you log a dose
              </p>
            </div>
            <Button
              variant={autoStartEnabled ? 'default' : 'outline'}
              size="sm"
              className="gap-1 shrink-0"
              onClick={() => setAutoStartEnabled(!autoStartEnabled)}
            >
              {autoStartEnabled ? (
                <Bell className="h-3.5 w-3.5" />
              ) : (
                <BellOff className="h-3.5 w-3.5" />
              )}
              {autoStartEnabled ? 'On' : 'Off'}
            </Button>
          </div>

          {/* Notification permission */}
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Browser notifications</p>
              <p className="text-xs text-neutral-content">
                {notificationPermission === 'granted'
                  ? 'Notifications are enabled'
                  : 'Required for reminders when the tab is in the background'}
              </p>
            </div>
            {notificationPermission === 'granted' ? (
              <Badge
                variant="outline"
                className="border-green-500/30 text-green-500 gap-1"
              >
                <ShieldCheck className="h-3 w-3" />
                Enabled
              </Badge>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="gap-1 shrink-0"
                onClick={handleRequestPermission}
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                Enable
              </Button>
            )}
          </div>

          {/* Notification sound toggle */}
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Notification sound</p>
              <p className="text-xs text-neutral-content">
                Play a chime when a reminder fires
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={previewReminderSound}
                title="Preview sound"
              >
                <Play className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant={soundEnabled ? 'default' : 'outline'}
                size="sm"
                className="gap-1"
                onClick={() => setSoundEnabled(!soundEnabled)}
              >
                {soundEnabled ? (
                  <Volume2 className="h-3.5 w-3.5" />
                ) : (
                  <VolumeX className="h-3.5 w-3.5" />
                )}
                {soundEnabled ? 'On' : 'Off'}
              </Button>
            </div>
          </div>
        </div>

        <div className="divider my-1" />

        {/* ── Existing schedules ── */}
        {schedules.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-neutral-content uppercase tracking-wide">
                Schedules ({schedules.length})
              </p>
              <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                    <Plus className="h-3 w-3" />
                    Add
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>Add Reminder Schedule</DialogTitle>
                    <DialogDescription>
                      Set up a timer that starts automatically when you log this
                      substance
                    </DialogDescription>
                  </DialogHeader>
                  <ScheduleEditor
                    onSave={handleAddSchedule}
                    onCancel={() => setShowAddDialog(false)}
                  />
                </DialogContent>
              </Dialog>
            </div>

            <div className="space-y-1.5">
              {schedules.map((s) => (
                <div
                  key={s.id}
                  className={`flex items-center justify-between gap-2 rounded-lg border p-2.5 transition-colors ${s.enabled
                      ? 'border-base-300'
                      : 'border-base-300/50 opacity-60'
                    }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">
                        {s.substanceName}
                      </span>
                      {!s.enabled && (
                        <Badge
                          variant="outline"
                          className="text-[10px] border-neutral-content/30 text-neutral-content"
                        >
                          Disabled
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-neutral-content mt-0.5 ml-5.5">
                      Every {formatIntervalMinutes(s.intervalMinutes)}
                      {s.maxDosesPerDay > 0 &&
                        ` · max ${s.maxDosesPerDay}x/day`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setEditingSchedule(s)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-error hover:text-error"
                      onClick={() => removeSchedule(s.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state + add button */}
        {schedules.length === 0 && (
          <div className="text-center py-2">
            <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1">
                  <Plus className="h-3.5 w-3.5" />
                  Add Reminder Schedule
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Add Reminder Schedule</DialogTitle>
                  <DialogDescription>
                    Set up a timer that starts automatically when you log this
                    substance
                  </DialogDescription>
                </DialogHeader>
                <ScheduleEditor
                  onSave={handleAddSchedule}
                  onCancel={() => setShowAddDialog(false)}
                />
              </DialogContent>
            </Dialog>
          </div>
        )}

        {/* Edit dialog */}
        <Dialog
          open={!!editingSchedule}
          onOpenChange={(open) => !open && setEditingSchedule(null)}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Reminder</DialogTitle>
              <DialogDescription>
                Update the schedule for {editingSchedule?.substanceName}
              </DialogDescription>
            </DialogHeader>
            {editingSchedule && (
              <ScheduleEditor
                schedule={editingSchedule}
                onSave={handleEditSchedule}
                onCancel={() => setEditingSchedule(null)}
              />
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

// ─── Tolerance Notification Settings Section ──────────────────────────────────
function ToleranceNotificationSettingsSection() {
  const settings = useToleranceNotificationStore((s) => s.settings)
  const updateSettings = useToleranceNotificationStore((s) => s.updateSettings)
  const initialize = useToleranceNotificationStore((s) => s.initialize)
  const notificationPermission = useReminderStore(
    (s) => s.notificationPermission,
  )
  const [substanceExpanded, setSubstanceExpanded] = useState(false)

  // Initialize on mount
  useEffect(() => {
    initialize()
  }, [initialize])

  return (
    <Card className="py-3 gap-2">
      <CardHeader className="pb-1">
        <CardTitle className="text-lg flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-warning" />
          Tolerance Notifications
        </CardTitle>
        <CardDescription>
          Get notified when tolerance reaches configured levels based on substance half-lives
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Enabled toggle */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Enabled</p>
            <p className="text-xs text-neutral-content">
              Receive notifications when tolerance thresholds are crossed
            </p>
          </div>
          <Button
            variant={settings.enabled ? 'default' : 'outline'}
            size="sm"
            className="gap-1 shrink-0"
            onClick={() => updateSettings({ enabled: !settings.enabled })}
          >
            {settings.enabled ? 'On' : 'Off'}
          </Button>
        </div>

        {/* Notification permission check */}
        {notificationPermission !== 'granted' && (
          <div role="alert" className="alert alert-warning gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <div className="text-xs leading-relaxed">
              <strong className="font-semibold">Notifications disabled:</strong> Enable browser notifications in the Dose Reminders section above for tolerance alerts to work.
            </div>
          </div>
        )}

        <div className="divider my-1" />

        {/* Trigger settings */}
        <div className="space-y-3">
          <h4 className="text-xs font-medium text-neutral-content uppercase tracking-wide">Notify when tolerance reaches</h4>
          
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <p className="text-sm font-medium">High / Very High</p>
              <p className="text-xs text-neutral-content">
                Tolerance ≥ 65% (high) or ≥ 85% (very high)
              </p>
            </div>
            <Button
              variant={settings.notifyOnHigh ? 'default' : 'outline'}
              size="sm"
              className="gap-1 shrink-0"
              onClick={() => updateSettings({ notifyOnHigh: !settings.notifyOnHigh })}
            >
              {settings.notifyOnHigh ? 'On' : 'Off'}
            </Button>
          </label>

          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <p className="text-sm font-medium">Low / Moderate</p>
              <p className="text-xs text-neutral-content">
                Tolerance ≥ 25% (low) or ≥ 45% (moderate)
              </p>
            </div>
            <Button
              variant={settings.notifyOnLow ? 'default' : 'outline'}
              size="sm"
              className="gap-1 shrink-0"
              onClick={() => updateSettings({ notifyOnLow: !settings.notifyOnLow })}
            >
              {settings.notifyOnLow ? 'On' : 'Off'}
            </Button>
          </label>

          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <p className="text-sm font-medium">Baseline recovered</p>
              <p className="text-xs text-neutral-content">
                Tolerance has returned to baseline (≤ 25%)
              </p>
            </div>
            <Button
              variant={settings.notifyOnBaseline ? 'default' : 'outline'}
              size="sm"
              className="gap-1 shrink-0"
              onClick={() => updateSettings({ notifyOnBaseline: !settings.notifyOnBaseline })}
            >
              {settings.notifyOnBaseline ? 'On' : 'Off'}
            </Button>
          </label>
        </div>

        <div className="divider my-1" />

        {/* Cooldown & Interval settings */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Notification cooldown</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={10080}
                value={settings.notificationCooldownMinutes}
                onChange={(e) =>
                  updateSettings({ notificationCooldownMinutes: parseInt(e.target.value) || 1 })
                }
                className="w-24"
              />
              <span className="text-sm text-neutral-content">minutes (1–10080)</span>
            </div>
            <p className="text-xs text-neutral-content">
              Minimum time between notifications for the same substance. Default: 1440 min (24 hours).
            </p>
          </div>

          <div className="space-y-2">
            <Label>Check interval</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={15}
                max={10080}
                value={settings.checkIntervalMinutes}
                onChange={(e) =>
                  updateSettings({ checkIntervalMinutes: parseInt(e.target.value) || 15 })
                }
                className="w-24"
              />
              <span className="text-sm text-neutral-content">minutes (15–10080)</span>
            </div>
            <p className="text-xs text-neutral-content">
              How often to check tolerance levels. Default: 1440 min (24 hours).
            </p>
          </div>
        </div>

        <div className="divider my-1" />

        {/* Substance Selection - Collapsible */}
        <Collapse open={substanceExpanded}>
          <div className="pt-2">
            <SubstanceSelectionList />
          </div>
        </Collapse>
        <Button
          variant="ghost"
          className="w-full justify-between"
          onClick={() => setSubstanceExpanded(!substanceExpanded)}
        >
          <span>Substance Selection</span>
          {substanceExpanded ? '▼' : '▶'}
        </Button>

        {/* Test button */}
        <div className="pt-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={async () => {
              const { forceToleranceCheck } = await import('@/lib/tolerance-notifications')
              await forceToleranceCheck()
              toast({ title: 'Test check triggered' })
            }}
          >
            <Play className="h-3.5 w-3.5" />
            Test Check Now
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Settings Page ───────────────────────────────────────────────────────────

export default function SettingsPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-6 space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-neutral-content">
          Configure reminders, notifications, and app behavior
        </p>
      </div>

      <div className="space-y-6">
        <ReminderSettingsSection />
        <ToleranceNotificationSettingsSection />
      </div>
    </div>
  )
}