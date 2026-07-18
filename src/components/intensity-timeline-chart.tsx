'use client'

/**
 * Interactive intensity timeline — Recharts-based replacement for the old
 * SVG-based ActiveDosesTimeline component.
 *
 * Replicates the old functionality:
 *   • Per-substance grouping (one chart card per substance)
 *   • Multi-route support (route-colored curves, route isolation pills)
 *   • Multi-dose / redose support (one area per dose, dose isolation chips)
 *   • Phase band backgrounds (onset / comeup / peak / offset)
 *   • Phase labels above the chart
 *   • Time-based x-axis with clock-time markers
 *   • 0–100% intensity y-axis
 *   • Interactive tooltip: phase name, absolute time, combined intensity,
 *     per-dose breakdown, minutes-until-phase-change
 *   • "Now" indicator (pulsing red vertical line at current time)
 *   • Dose markers (dots at each dose start time)
 *   • Substance hide/show toggles (when >1 substance active)
 *   • Combined intensity badge + remaining-time in the header
 *   • Expandable per-dose phase details
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { format } from 'date-fns'
import Link from 'next/link'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
  ReferenceLine,
} from 'recharts'
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Activity, Layers, Loader2, Clock, Timer, ChevronDown, ChevronUp,
  FlaskConical, Pill, Sparkles, Download,
} from 'lucide-react'
import { useDoseStore } from '@/store/dose-store'
import { useReminderStore } from '@/store/reminder-store'
import { substances } from '@/lib/substances/index'
import { classifyDose } from '@/lib/dose-classification'
import { formatDoseAmount } from '@/lib/utils'
import { EstimatedDurationBadge } from '@/components/estimated-duration-badge'
import {
  parseDurationToMinutes,
  calculatePhaseTimings,
  calculateDoseScaledTimings,
  intensityAt,
  phaseNameAt,
  getPhaseStatus,
  combinedIntensityAt,
  formatMinutes,
  formatPhaseName,
  getDoseCategories,
  getPhaseBandRanges,
  phaseStart,
  phaseEnd,
} from '@/components/dose-timeline/dose-timeline-utils'
import {
  phaseColors,
  phaseIcons,
  markerHex,
  ROUTE_PALETTE,
  PHASE_BANDS,
  NOW_INDICATOR,
  ENDED_DOSE_RETENTION_MINS,
} from '@/components/dose-timeline/dose-timeline-constants'
import type {
  EnrichedDose, RouteGroup, SubstanceGroup,
  PhaseTimings, PhaseName,
} from '@/components/dose-timeline/dose-timeline-types'

// ─── Category → hex color map ──────────────────────────────────────────────
// The Tailwind `categoryColors` from `@/lib/categories` returns class strings
// (e.g. "text-amber-500 bg-amber-500/10 border-amber-500/20") which can't be
// used as inline `style={{ backgroundColor }}` values. This hex map is used
// wherever we need a real color value (header dots, substance toggle chips).

const CATEGORY_HEX_COLORS: Record<string, string> = {
  stimulants: '#f59e0b', // amber-500
  depressants: '#6366f1', // indigo-500
  hallucinogens: '#a855f7', // purple-500
  dissociatives: '#06b6d4', // cyan-500
  empathogens: '#ec4899', // pink-500
  cannabinoids: '#22c55e', // green-500
  opioids: '#ef4444', // red-500
  deliriants: '#64748b', // slate-500
  nootropics: '#14b8a6', // teal-500
  other: '#71717a', // zinc-500
  medications: '#10b981', // emerald-500
}

/** Resolve a substance's primary category to a hex color for inline styles. */
function categoryHexColor(categories: string[]): string {
  if (categories.length === 0) return '#71717a' // zinc-500 fallback
  return CATEGORY_HEX_COLORS[categories[0]] ?? '#71717a'
}

// ─── Substance lookup map (module-level — built once, not per-render) ──────
// Fix 3.1: hoisted out of computeGroups so it isn't rebuilt on every dose change.

const SUBSTANCE_BY_NAME: Map<string, typeof substances[number]> = (() => {
  const map = new Map<string, typeof substances[number]>()
  for (const s of substances) {
    map.set(s.name.toLowerCase(), s)
  }
  return map
})()

// ─── Types ─────────────────────────────────────────────────────────────────

interface ChartDataPoint {
  t: number // timestamp in ms
  [doseKey: string]: number
}

interface DoseSeries {
  dose: EnrichedDose
  route: RouteGroup
  dataKey: string
  palette: { stroke: string; fill: string }
  isEnded: boolean
  /** Dose-relative height = userDose / avgCommonDose. Curves are scaled by
   *  this so heavier doses visually tower over lighter ones. */
  doseHeight: number
}

interface PhaseBandConfig {
  phase: PhaseName
  startMs: number
  endMs: number
}

interface ChartConfig {
  data: ChartDataPoint[]
  series: DoseSeries[]
  phaseBands: PhaseBandConfig[]
  windowStartMs: number
  windowEndMs: number
}

/** Window zoom options for the timeline. `null` = auto-fit (show all doses). */
const WINDOW_OPTIONS = [
  { hours: 1, label: '1h' },
  { hours: 4, label: '4h' },
  { hours: 12, label: '12h' },
  { hours: 24, label: '24h' },
  { hours: null, label: 'All' },
] as const

export type WindowHours = number | null

/** Compute the dose-height-scaled intensity (0–100, clamped) for a single
 *  dose at a given timestamp. Used by the chart sampler, the tooltip, and
 *  the header combined-intensity badge so they all agree on the same value.
 *
 *  Fix 1.2: multiplies raw intensityAt() by doseHeight (userDose / avgCommon).
 *  Fix 5.2: edge fade removed — it was an SVG rendering nicety that caused
 *  the tooltip's reported intensity to disagree with the conceptual model.
 *  Recharts renders smooth area fills, so the fade isn't needed.
 */
function scaledIntensityAt(dose: EnrichedDose, t: number): number {
  const elapsedMins = (t - dose.doseTime.getTime()) / 60_000
  if (elapsedMins < 0 || elapsedMins > dose.timings.totalDuration) return 0
  const progress = (elapsedMins / dose.timings.totalDuration) * 100
  // Dose-height scaling — heavier doses rise above 100 (visual cue),
  // but clamp the *visible curve* at 100 so it stays in the chart bounds.
  const val = intensityAt(progress, dose.timings) * dose.doseHeight
  return Math.max(0, Math.min(100, val))
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function safeDate(s: string): Date {
  const d = new Date(s)
  return isNaN(d.getTime()) ? new Date(0) : d
}

/** Check if a dose's duration data is incomplete (has onset + total but is
 *  missing comeup/peak/offset). When true, the timeline curve was inferred
 *  from partial data and an "Est. timeline" badge is shown. (1.4) */
function hasIncompletePhases(
  duration: { onset?: string; comeup?: string; peak?: string; offset?: string; total?: string } | null | undefined,
): boolean {
  if (!duration) return false
  const hasOnset = duration.onset && duration.onset.trim() !== '' && duration.onset !== '—'
  const hasTotal = duration.total && duration.total.trim() !== '' && duration.total !== '—'
  const hasComeup = duration.comeup && duration.comeup.trim() !== '' && duration.comeup !== '—'
  const hasPeak = duration.peak && duration.peak.trim() !== '' && duration.peak !== '—'
  const hasOffset = duration.offset && duration.offset.trim() !== '' && duration.offset !== '—'
  if (hasOnset && hasTotal && (!hasComeup || !hasPeak || !hasOffset)) return true
  return false
}

/** Compute afterglow duration in minutes for a dose (1.5). Returns 0 if no
 *  afterglow phase exists. */
function afterglowDurationMins(d: EnrichedDose): number {
  const afterglowEnd = d.timings.afterglowEnd
  const offsetEnd = d.timings.offsetEnd
  return afterglowEnd > offsetEnd ? afterglowEnd - offsetEnd : 0
}

/** Export the Recharts SVG for a given group as a PNG download (2.7).
 *  Finds the chart's <svg> inside the group's card, serializes it, draws it
 *  to a canvas, and triggers a PNG download. No external deps — uses native
 *  browser canvas + XMLSerializer APIs. */
function exportChartPng(groupKey: string, substanceName: string) {
  if (typeof window === 'undefined') return
  // The chart's SVG lives inside a .recharts-surface or the ResponsiveContainer.
  // Find the card by looking for the svg within a container that has data-group-key.
  const svgs = document.querySelectorAll('svg.recharts-surface')
  if (!svgs.length) return
  // Find the SVG whose parent card contains this group's gradients
  let targetSvg: SVGSVGElement | null = null
  for (const svg of Array.from(svgs)) {
    const container = svg.closest('div')
    if (container?.querySelector(`linearGradient[id^="grad-${groupKey}-"]`)) {
      targetSvg = svg as SVGSVGElement
      break
    }
  }
  if (!targetSvg) return

  const serializer = new XMLSerializer()
  let svgStr = serializer.serializeToString(targetSvg)
  // Ensure XML namespace
  if (!svgStr.includes('xmlns=')) {
    svgStr = svgStr.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
  }

  const width = targetSvg.clientWidth || 800
  const height = targetSvg.clientHeight || 280
  const canvas = document.createElement('canvas')
  canvas.width = width * 2 // 2x for retina
  canvas.height = height * 2
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(2, 2)
  // Fill background (transparent SVG → dark bg)
  ctx.fillStyle = '#0f172a'
  ctx.fillRect(0, 0, width, height)

  const img = new Image()
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  img.onload = () => {
    ctx.drawImage(img, 0, 0, width, height)
    URL.revokeObjectURL(url)
    canvas.toBlob((pngBlob) => {
      if (!pngBlob) return
      const pngUrl = URL.createObjectURL(pngBlob)
      const a = document.createElement('a')
      a.href = pngUrl
      a.download = `${substanceName}-timeline-${format(new Date(), 'yyyy-MM-dd-HHmm')}.png`
      a.click()
      URL.revokeObjectURL(pngUrl)
    })
  }
  img.onerror = () => URL.revokeObjectURL(url)
  img.src = url
}

/** Mini SVG sparkline showing the intensity curve shape for a single phase (1.6).
 *  Width × height in px. Samples the phase's portion of the dose's intensity
 *  curve and renders it as a tiny polyline. */
function PhaseSparkline({
  dose,
  phase,
  width = 48,
  height = 18,
}: {
  dose: EnrichedDose
  phase: PhaseName
  width?: number
  height?: number
}) {
  const pStart = phaseStart(phase, dose.timings)
  const pEnd = phaseEnd(phase, dose.timings)
  const pDuration = pEnd - pStart
  if (pDuration <= 0) return null

  // Sample 12 points across the phase
  const points: string[] = []
  for (let i = 0; i <= 12; i++) {
    const frac = i / 12
    const globalProgress = ((pStart + frac * pDuration) / dose.timings.totalDuration) * 100
    const intensity = intensityAt(globalProgress, dose.timings)
    const x = frac * width
    const y = height - (intensity / 100) * height
    points.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)},${y.toFixed(1)}`)
  }

  return (
    <svg width={width} height={height} className="shrink-0" aria-hidden="true">
      <path
        d={points.join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.6"
      />
    </svg>
  )
}

/** Build enriched substance groups from raw doses — same logic as old component. */
function computeGroups(doses: ReturnType<typeof useDoseStore.getState>['doses']): SubstanceGroup[] {
  const now = Date.now()
  // Phase calculation/classification is much more expensive than a timestamp
  // check. A duration range is parsed as its midpoint, so retain up to twice
  // its declared total (the maximum possible range endpoint), plus a one-day
  // safety floor for incomplete/custom data.
  const MIN_CANDIDATE_WINDOW_MINS = 24 * 60

  // Step 1: filter + enrich
  const baseDoses: EnrichedDose[] = doses
    .filter(d => {
      if (!d.duration) return false
      const totalMins = parseDurationToMinutes(d.duration.total ?? '')
      if (totalMins <= 0) return false
      const elapsedMins = (now - safeDate(d.timestamp).getTime()) / 60_000
      const candidateWindow = Math.max(MIN_CANDIDATE_WINDOW_MINS, totalMins * 2)
      return elapsedMins < candidateWindow + ENDED_DOSE_RETENTION_MINS
    })
    .map(d => {
      const doseTime = safeDate(d.timestamp)
      const substanceEntry = SUBSTANCE_BY_NAME.get(d.substanceName.toLowerCase())
      const classification = substanceEntry
        ? classifyDose(d.amount, d.unit, substanceEntry, d.route)
        : null
      const horizontalWeight = classification?.horizontalWeight ?? 0.5
      // d.duration is non-null here (filtered above), but TS can't narrow
      // through .filter().map() — assert non-null.
      const duration = d.duration!
      const timings = classification
        ? calculateDoseScaledTimings(duration, horizontalWeight)
        : calculatePhaseTimings(duration)
      const status = getPhaseStatus(doseTime, timings)
      return {
        ...d,
        timings,
        status,
        doseTime,
        doseHeight: classification?.heightRelativeToCommon ?? 1,
        horizontalWeight,
        doseClass: classification?.doseClass,
      } as EnrichedDose
    })
    .sort((a, b) => a.doseTime.getTime() - b.doseTime.getTime())

  // Step 2: filter to active/recently-ended + group by substance → route
  const activeDoses = baseDoses.filter(d => {
    const elapsedMins = (now - d.doseTime.getTime()) / 60_000
    return elapsedMins < d.timings.offsetEnd + ENDED_DOSE_RETENTION_MINS
  })

  const bySubstance = new Map<string, EnrichedDose[]>()
  for (const d of activeDoses) {
    const key = d.substanceName.toLowerCase()
    if (!bySubstance.has(key)) bySubstance.set(key, [])
    bySubstance.get(key)!.push(d)
  }

  const result: SubstanceGroup[] = []
  for (const [, substanceDoses] of bySubstance) {
    const byRoute = new Map<string, EnrichedDose[]>()
    for (const d of substanceDoses) {
      const routeKey = d.route.toLowerCase()
      if (!byRoute.has(routeKey)) byRoute.set(routeKey, [])
      byRoute.get(routeKey)!.push(d)
    }

    const routes: RouteGroup[] = []
    let routeIdx = 0
    for (const [route, routeDoses] of byRoute) {
      const primary = routeDoses[0]
      const totalAmount = routeDoses.reduce((sum, d) => sum + d.amount, 0)
      const uniformUnit = routeDoses.every(d => d.unit === primary.unit)
      routes.push({
        route, doses: routeDoses, primary, totalAmount,
        unit: primary.unit, uniformUnit, paletteIndex: routeIdx,
      })
      routeIdx++
    }

    const earliest = substanceDoses[0]
    const latestEnd = substanceDoses.reduce((max, d) => {
      const end = d.doseTime.getTime() + d.timings.totalDuration * 60_000
      return Math.max(max, end)
    }, 0)
    const windowStart = new Date(earliest.doseTime.getTime() - 5 * 60_000)
    const windowEnd = new Date(latestEnd + 10 * 60_000)
    const windowDuration = (windowEnd.getTime() - windowStart.getTime()) / 60_000

    result.push({
      key: earliest.substanceName.toLowerCase(),
      substanceName: earliest.substanceName,
      categories: getDoseCategories(earliest),
      routes, primary: earliest, windowDuration, windowStart,
    })
  }

  result.sort((a, b) => a.primary.doseTime.getTime() - b.primary.doseTime.getTime())
  return result
}

/** Build Recharts chart data + series config for a single substance group.
 *
 *  Fix 3.2: this function is pure — it does NOT depend on `now`. The "now"
 *  line position is computed separately in GroupCard so the memoized chart
 *  config doesn't invalidate every 60 seconds.
 */
function buildChartConfig(
  group: SubstanceGroup,
  visibleRoutes: RouteGroup[],
  sampleCount: number,
  windowOverride?: { startMs: number; endMs: number } | null,
): ChartConfig {
  // Use the override window (from the zoom selector) if provided, otherwise
  // fall back to the auto-fit window that covers all doses in the group.
  const windowStartMs = windowOverride?.startMs ?? group.windowStart.getTime()
  const windowEndMs = windowOverride?.endMs ?? (windowStartMs + group.windowDuration * 60_000)
  const sampleIntervalMs = (windowEndMs - windowStartMs) / sampleCount

  // Build dose series
  const series: DoseSeries[] = []
  for (const rg of visibleRoutes) {
    for (const d of rg.doses) {
      const doseId = String(d.id ?? d.doseTime.getTime())
      const dataKey = `dose_${doseId}`
      const palette = ROUTE_PALETTE[rg.paletteIndex % ROUTE_PALETTE.length]
      // isEnded is computed at render time in GroupCard (it depends on `now`),
      // but we need a snapshot here for initial opacity. Use a lazy getter
      // pattern instead — store the dose, let the consumer compute endedness.
      // For simplicity we set isEnded=false here and let the <Area opacity=...>
      // logic in GroupCard compute the real value from `now` directly.
      series.push({
        dose: d,
        route: rg,
        dataKey,
        palette,
        isEnded: false,
        doseHeight: d.doseHeight,
      })
    }
  }

  // Build data array — sample the dose-height-scaled intensity curve
  // (Fix 1.2: scaling applied via scaledIntensityAt)
  const data: ChartDataPoint[] = []
  for (let i = 0; i <= sampleCount; i++) {
    const t = windowStartMs + i * sampleIntervalMs
    const point: ChartDataPoint = { t }
    for (const s of series) {
      point[s.dataKey] = scaledIntensityAt(s.dose, t)
    }
    data.push(point)
  }

  // Phase bands from the band dose (first visible dose, or group primary)
  const bandDose = visibleRoutes[0]?.doses[0] ?? group.primary
  const bandOffsetMins = (bandDose.doseTime.getTime() - windowStartMs) / 60_000
  const phaseBands: PhaseBandConfig[] = getPhaseBandRanges(bandDose.timings).map(band => ({
    phase: band.phase,
    startMs: windowStartMs + (bandOffsetMins + band.startFrac * bandDose.timings.totalDuration) * 60_000,
    endMs: windowStartMs + (bandOffsetMins + band.endFrac * bandDose.timings.totalDuration) * 60_000,
  }))

  return { data, series, phaseBands, windowStartMs, windowEndMs }
}

// ─── Main Component ────────────────────────────────────────────────────────

export function IntensityTimelineChart() {
  const doses = useDoseStore(s => s.doses)
  const isLoaded = useDoseStore(s => s.isLoaded)

  const [hiddenSubstances, setHiddenSubstances] = useState<Set<string>>(new Set())
  const [selectedRoutes, setSelectedRoutes] = useState<Record<string, string | null>>({})
  const [selectedDoses, setSelectedDoses] = useState<Record<string, string | null>>({})
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  // 2.1: window zoom selector. null = auto-fit (show all doses). When set to
  // a number, the chart clamps to [now - hours, now]. This lets users zoom
  // into recent activity instead of seeing a wide auto-fit window.
  const [windowHours, setWindowHours] = useState<WindowHours>(null)
  // Fix 3.2: nowTs is the ONLY thing that changes every 60s. It's passed down
  // as a prop so children can use it for the "now" line position and header
  // badges WITHOUT invalidating their memoized chart-data config.
  const [nowTs, setNowTs] = useState(() => Date.now())

  useEffect(() => {
    setNowTs(Date.now())
    const id = setInterval(() => setNowTs(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const groups = useMemo(() => computeGroups(doses), [doses])

  // Pass through to children as a stable callback. Returns a hex color
  // suitable for inline styles (the old version returned a Tailwind class
  // string which doesn't work as a backgroundColor value).
  const getCategoryColor = useCallback((categories: string[]): string => {
    return categoryHexColor(categories)
  }, [])

  const handleRouteClick = useCallback((groupKey: string, route: string) => {
    setSelectedRoutes(prev => ({
      ...prev,
      [groupKey]: prev[groupKey] === route ? null : route,
    }))
    setSelectedDoses(prev => ({ ...prev, [groupKey]: null }))
  }, [])

  const handleDoseChipClick = useCallback((groupKey: string, doseId: string) => {
    setSelectedDoses(prev => ({
      ...prev,
      [groupKey]: prev[groupKey] === doseId ? null : doseId,
    }))
    setSelectedRoutes(prev => ({ ...prev, [groupKey]: null }))
  }, [])

  if (!isLoaded) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-neutral-content" />
          <span className="ml-2 text-sm text-neutral-content">Loading active doses…</span>
        </CardContent>
      </Card>
    )
  }

  if (groups.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="h-5 w-5 text-purple-500" />
            Active Timeline
          </CardTitle>
          <CardDescription>No active doses to display</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-8 text-neutral-content">
          <Layers className="h-10 w-10 mb-3 opacity-40" />
          <p className="text-sm">Log a dose to see the intensity timeline</p>
        </CardContent>
      </Card>
    )
  }

  const visibleGroups = groups.filter(g => !hiddenSubstances.has(g.key))

  return (
    <div className="space-y-4">
      {/* Top toolbar: substance toggle chips + window zoom selector */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {/* Substance toggle chips (when >1 group) */}
        {groups.length > 1 ? (
          <div className="flex items-center gap-1.5 flex-wrap">
            {groups.map(g => {
              const hidden = hiddenSubstances.has(g.key)
              const color = getCategoryColor(g.categories)
              return (
                <button
                  key={g.key}
                  onClick={() => setHiddenSubstances(prev => {
                    const next = new Set(prev)
                    if (next.has(g.key)) next.delete(g.key)
                    else next.add(g.key)
                    return next
                  })}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-all ${hidden ? 'opacity-30 border-base-300 line-through' : 'opacity-90 hover:opacity-100'
                    }`}
                  style={{ borderColor: hidden ? undefined : color, color }}
                >
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color, opacity: hidden ? 0.3 : 1 }} />
                  {g.substanceName}
                </button>
              )
            })}
            {hiddenSubstances.size > 0 && (
              <button onClick={() => setHiddenSubstances(new Set())} className="text-[10px] text-neutral-content hover:text-base-content ml-0.5">
                Show all
              </button>
            )}
          </div>
        ) : (
          <div />
        )}

        {/* 2.1: Window zoom selector */}
        <div className="flex items-center gap-0.5 bg-base-200 rounded-lg p-0.5 shrink-0">
          {WINDOW_OPTIONS.map(opt => {
            const isActive = windowHours === opt.hours
            return (
              <button
                key={opt.label}
                onClick={() => setWindowHours(opt.hours)}
                className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-all ${isActive
                  ? 'bg-primary text-primary-content'
                  : 'text-neutral-content hover:text-base-content hover:bg-base-300/50'
                  }`}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Per-substance chart cards */}
      {visibleGroups.map(group => (
        <GroupCard
          key={group.key}
          group={group}
          substanceName={group.substanceName}
          getCategoryColor={getCategoryColor}
          selectedRoute={selectedRoutes[group.key] ?? null}
          selectedDose={selectedDoses[group.key] ?? null}
          onRouteClick={(route) => handleRouteClick(group.key, route)}
          onDoseClick={(doseId) => handleDoseChipClick(group.key, doseId)}
          isExpanded={expandedGroup === group.key}
          onToggleExpand={() => setExpandedGroup(prev => prev === group.key ? null : group.key)}
          nowTs={nowTs}
          windowHours={windowHours}
        />
      ))}
    </div>
  )
}

// ─── Per-substance card ────────────────────────────────────────────────────

interface GroupCardProps {
  group: SubstanceGroup
  substanceName: string
  getCategoryColor: (cats: string[]) => string
  selectedRoute: string | null
  selectedDose: string | null
  onRouteClick: (route: string) => void
  onDoseClick: (doseId: string) => void
  isExpanded: boolean
  onToggleExpand: () => void
  /** Current time in ms — passed from parent so the 60s tick re-renders
   *  the now-line / phase badges WITHOUT recomputing chart data. */
  nowTs: number
  /** 2.1: Window zoom override. null = auto-fit. A number = [now - hours, now]. */
  windowHours: WindowHours
}

function GroupCard({
  group, getCategoryColor, selectedRoute, selectedDose,
  onRouteClick, onDoseClick, isExpanded, onToggleExpand, nowTs, windowHours,
}: GroupCardProps) {
  const [isMobile, setIsMobile] = useState(false)
  // mounted gate — prevents ResponsiveContainer from rendering before the
  // browser has computed the parent's layout (which triggers a 0×0 warning).
  const [mounted, setMounted] = useState(false)

  const nowRef = useRef(nowTs)

  // Keep nowRef.current in sync with nowTs prop
  useEffect(() => {
    nowRef.current = nowTs
  }, [nowTs])

  // Sliding window override - updates every minute when windowHours is set
  // This allows the X-axis domain to slide without recomputing chart data.
  const [slidingWindowOverride, setSlidingWindowOverride] = useState<{ startMs: number; endMs: number } | null>(null)

  useEffect(() => {
    setMounted(true)
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Timer for sliding window - only runs when windowHours is set
  useEffect(() => {
    if (windowHours === null) {
      setSlidingWindowOverride(null)
      return
    }
    // Initial value
    const updateWindow = () => {
      const endMs = nowRef.current
      const startMs = endMs - windowHours * 60 * 60 * 1000
      setSlidingWindowOverride({ startMs, endMs })
    }
    updateWindow()
    const id = setInterval(updateWindow, 60_000)
    return () => clearInterval(id)
  }, [windowHours])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setState in effect is intentional for timer

  // Filter visible routes based on isolation
  const visibleRoutes: RouteGroup[] = useMemo(() => {
    if (selectedDose) {
      return group.routes
        .map(rg => ({
          ...rg,
          doses: rg.doses.filter(d => String(d.id ?? d.doseTime.getTime()) === selectedDose),
        }))
        .filter(rg => rg.doses.length > 0)
    }
    if (selectedRoute) {
      return group.routes.filter(r => r.route.toLowerCase() === selectedRoute)
    }
    return group.routes
  }, [group, selectedRoute, selectedDose])

  const sampleCount = isMobile ? 40 : 120
  // Window override: uses slidingWindowOverride when in zoom mode, null for auto-fit
  const windowOverride = slidingWindowOverride

  // Chart config is stable - does NOT depend on nowTs.
  // The now-indicator reads nowRef.current directly in JSX.
  const config = useMemo(
    () => buildChartConfig(group, visibleRoutes, sampleCount, windowOverride),
    [group, visibleRoutes, sampleCount, windowOverride],
  )

  // Time-dependent values for header badges - use nowTs prop so they update every minute
  const now = nowTs
  const primaryDose = group.primary
  // Fix 5.1: use the shared getPhaseStatus() instead of a local re-implementation.
  const primaryPhase = getPhaseStatus(primaryDose.doseTime, primaryDose.timings).phase
  const allActive = group.routes.some(rg => rg.doses.some(d => (now - d.doseTime.getTime()) / 60_000 < d.timings.offsetEnd))
  const allEnded = group.routes.every(rg => rg.doses.every(d => (now - d.doseTime.getTime()) / 60_000 >= d.timings.offsetEnd))

  // Combined intensity right now — uses combinedIntensityAt (Fix 1.1) so
  // redosing visually stacks with soft log dampening above 100%, matching
  // the old SVG behaviour. Intensities are dose-height-scaled (Fix 1.2) so
  // a heavy dose contributes more to the combined value than a light one.
  // Display is clamped to 100% — values above 100 from stacking are not
  // shown to avoid confusion (the chart curves themselves also cap at 100).
  const currentCombinedIntensity = useMemo(() => {
    if (!allActive) return null
    const activeDoses = group.routes.flatMap(rg => rg.doses).filter(d => {
      const elapsed = (now - d.doseTime.getTime()) / 60_000
      return elapsed >= 0 && elapsed < d.timings.offsetEnd
    })
    if (activeDoses.length === 0) return null
    const intensities = activeDoses.map(d => scaledIntensityAt(d, now))
    const combined = combinedIntensityAt(intensities)
    return Math.round(Math.min(100, combined))
  }, [group, allActive, now])

  // Remaining time for primary dose
  const primaryRemaining = Math.max(0, primaryDose.timings.offsetEnd - (now - primaryDose.doseTime.getTime()) / 60_000)

  const catColor = getCategoryColor(group.categories)
  const isMultiRoute = group.routes.length > 1
  const totalDoses = group.routes.reduce((s, rg) => s + rg.doses.length, 0)

  // 1.4: check if the primary dose's duration data is incomplete (curve was
  // inferred from partial data — show an "Est. timeline" badge).
  const primaryHasIncompletePhases = hasIncompletePhases(primaryDose.duration)

  // 2.3: cumulative dose counter — total amount + count for today.
  // Only shown when there's more than one dose (single-dose is redundant
  // with the dose chip already shown above).
  const todayCumulative = useMemo(() => {
    const allDoses = group.routes.flatMap(rg => rg.doses)
    if (allDoses.length <= 1) return null
    const todayStr = new Date(now).toISOString().slice(0, 10)
    const todayDoses = allDoses.filter(d => d.timestamp.slice(0, 10) === todayStr)
    if (todayDoses.length === 0) return null
    // Sum amounts only when units are uniform (can't add mg + drops)
    const firstUnit = todayDoses[0].unit
    const uniform = todayDoses.every(d => d.unit === firstUnit)
    const totalAmount = uniform ? todayDoses.reduce((s, d) => s + d.amount, 0) : null
    return {
      count: todayDoses.length,
      totalAmount,
      unit: firstUnit,
    }
  }, [group, now])

  // 2.5: night-hour background bands — 10pm to 6am segments within the chart
  // window. Subtle shaded <ReferenceArea>s give temporal context ("did I dose
  // at 3am?").
  const nightBands = useMemo(() => {
    const bands: Array<{ startMs: number; endMs: number }> = []
    const start = new Date(config.windowStartMs)
    const end = new Date(config.windowEndMs)
    // Walk day-by-day from the window start
    const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate())
    while (cursor.getTime() < end.getTime()) {
      // Night starts at 22:00 of the current day
      const nightStart = new Date(cursor)
      nightStart.setHours(22, 0, 0, 0)
      // Night ends at 06:00 of the next day
      const nightEnd = new Date(cursor)
      nightEnd.setDate(nightEnd.getDate() + 1)
      nightEnd.setHours(6, 0, 0, 0)
      // Clamp to window
      const ms1 = Math.max(nightStart.getTime(), config.windowStartMs)
      const ms2 = Math.min(nightEnd.getTime(), config.windowEndMs)
      if (ms1 < ms2) {
        bands.push({ startMs: ms1, endMs: ms2 })
      }
      cursor.setDate(cursor.getDate() + 1)
    }
    return bands
  }, [config.windowStartMs, config.windowEndMs])

  // 2.8: predictive projection — if a reminder schedule exists for this
  // substance, show a faded projected curve segment for the next scheduled
  // dose. Reads from the reminder store.
  const reminderSchedules = useReminderStore(s => s.schedules)
  const projectionSeries = useMemo(() => {
    if (!allActive) return null
    // Find a schedule for this substance
    const schedule = reminderSchedules.find(
      s => s.enabled && s.substanceName.toLowerCase() === group.substanceName.toLowerCase(),
    )
    if (!schedule) return null
    // Project the next dose at: last dose time + interval
    const lastDose = group.routes.flatMap(rg => rg.doses).reduce((latest, d) =>
      d.doseTime.getTime() > latest.doseTime.getTime() ? d : latest,
      group.routes[0].doses[0])
    const nextDoseTs = lastDose.doseTime.getTime() + schedule.intervalMinutes * 60_000
    if (nextDoseTs <= now || nextDoseTs > config.windowEndMs) return null
    // Use the last dose's timings as a template for the projected curve
    return {
      ts: nextDoseTs,
      dose: lastDose,
    }
  }, [reminderSchedules, group, allActive, now, config.windowEndMs])

  const PhaseIcon = phaseIcons[primaryPhase] || phaseIcons['onset']

  return (
    <Card className="chart-container">
      <CardHeader className="pb-2">
        {/* Header row */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: catColor }} />
            <h3 className="font-semibold text-base">
              <Link href={`/?substance=${group.substanceName}`} className="hover:underline underline-offset-4">
                {group.substanceName}
              </Link>
            </h3>
            <Badge variant="outline" className={`${phaseColors[primaryPhase]?.border || ''} ${phaseColors[primaryPhase]?.text || ''} text-[10px] px-1.5 py-0`}>
              <PhaseIcon className="h-3 w-3 mr-0.5" />
              {formatPhaseName(primaryPhase)}
            </Badge>
            {/* 1.4: Estimated-duration badge — shown when the primary dose's
                duration data is incomplete (curve was inferred). */}
            {primaryHasIncompletePhases && (
              <EstimatedDurationBadge sourceRoute={primaryDose.durationSourceRoute} />
            )}
            {allActive && currentCombinedIntensity !== null && (
              <Badge variant="outline" className="text-xs font-mono">
                <Activity className="h-3 w-3 mr-1 text-purple-400" />
                {currentCombinedIntensity}%
              </Badge>
            )}
            {/* 2.3: Cumulative dose counter for today — e.g. "120mg today · 3" */}
            {todayCumulative && (
              <Badge variant="outline" className="text-[10px] font-mono">
                <Pill className="h-3 w-3 mr-0.5 text-blue-400" />
                {todayCumulative.totalAmount !== null
                  ? `${todayCumulative.totalAmount}${todayCumulative.unit} · ${todayCumulative.count} today`
                  : `${todayCumulative.count} today`}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {allActive && primaryRemaining > 0 && (
              <span className="text-xs text-neutral-content flex items-center gap-1">
                <Timer className="h-3 w-3" />
                {formatMinutes(primaryRemaining)} remaining
              </span>
            )}
            {allEnded && (
              <span className="text-xs text-neutral-content/60 flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Ended
              </span>
            )}
          </div>
        </div>

        {/* Route pills */}
        {isMultiRoute && (
          <div className="flex items-center gap-1.5 flex-wrap mt-1">
            <span className="text-[10px] text-neutral-content mr-1">Routes:</span>
            {group.routes.map(rg => {
              const palette = ROUTE_PALETTE[rg.paletteIndex % ROUTE_PALETTE.length]
              const isSelected = selectedRoute === rg.route.toLowerCase()
              return (
                <button
                  key={rg.route}
                  onClick={() => onRouteClick(rg.route.toLowerCase())}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-all ${isSelected ? 'ring-1 ring-offset-1 ring-offset-background' : 'opacity-60 hover:opacity-100'}`}
                  style={{ borderColor: palette.stroke, color: palette.stroke }}
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: palette.fill }} />
                  {rg.route}
                </button>
              )
            })}
            {selectedRoute && (
              <button onClick={() => onRouteClick(selectedRoute)} className="text-[10px] text-neutral-content hover:text-base-content ml-1">
                Show all
              </button>
            )}
          </div>
        )}

        {/* Dose chips */}
        <div className="flex items-center gap-1.5 flex-wrap mt-1">
          {group.routes.map(rg => {
            const palette = ROUTE_PALETTE[rg.paletteIndex % ROUTE_PALETTE.length]
            return rg.doses.map(d => {
              const doseId = String(d.id ?? d.doseTime.getTime())
              const isIsolated = selectedDose === doseId
              const formatted = formatDoseAmount(d.amount, d.unit)
              const elapsed = (now - d.doseTime.getTime()) / 60_000
              const isDoseActive = elapsed >= 0 && elapsed < d.timings.offsetEnd
              const isDoseEnded = elapsed >= d.timings.offsetEnd
              const doseProgress = (elapsed / d.timings.totalDuration) * 100
              return (
                <button
                  key={`${rg.route}-${doseId}`}
                  onClick={() => onDoseClick(doseId)}
                  className={`relative inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border transition-all overflow-hidden ${isIsolated
                    ? 'ring-2 ring-purple-500/50 border-purple-500/50 bg-purple-500/10'
                    : isDoseEnded
                      ? 'border-base-300/50 opacity-50'
                      : 'border-base-300 hover:border-base-300/80'
                    }`}
                  style={{ color: palette.stroke }}
                >
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: palette.fill, opacity: isDoseActive ? 1 : 0.4 }} />
                  <span>{formatted.amount} {formatted.unit}</span>
                  <span className="text-neutral-content">{rg.route}</span>
                  {isDoseActive && (
                    <div className="absolute bottom-0 left-0 h-0.5 rounded-full transition-all duration-500" style={{ width: `${Math.min(100, Math.max(0, doseProgress))}%`, background: palette.stroke, opacity: 0.6 }} />
                  )}
                </button>
              )
            })
          })}
          {selectedDose && (
            <button onClick={() => onDoseClick(selectedDose)} className="text-[10px] text-neutral-content hover:text-base-content ml-1">
              Show all
            </button>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {/* 2.4: Mobile phase strip — a compact at-a-glance bar showing the 4
            phases (onset/comeup/peak/offset) with proportional widths and a
            "now" marker. Only shown on mobile, above the full chart. Gives a
            quick "which phase am I in" read without needing to parse the chart. */}
        {isMobile && allActive && (
          <MobilePhaseStrip
            group={group}
            nowTs={nowTs}
            windowStartMs={config.windowStartMs}
            windowEndMs={config.windowEndMs}
          />
        )}

        {/* Phase labels row — 2-row greedy collision resolution (3.5).
            Labels that would overlap on row 0 get bumped to row 1. */}
        <div className="relative h-6 mb-0.5">
          {(() => {
            // Build label specs: { leftPct, widthPct, midPct, name, color }
            const labels = config.phaseBands.map(band => {
              const pb = PHASE_BANDS.find(b => b.phase === band.phase)
              if (!pb) return null
              const startPct = ((band.startMs - config.windowStartMs) / (config.windowEndMs - config.windowStartMs)) * 100
              const endPct = ((band.endMs - config.windowStartMs) / (config.windowEndMs - config.windowStartMs)) * 100
              const midPct = (startPct + endPct) / 2
              const widthPct = endPct - startPct
              if (widthPct < 4) return null // too narrow to label
              return { midPct, widthPct, name: pb.name, color: pb.labelColor, phase: band.phase }
            }).filter(Boolean) as Array<{ midPct: number; widthPct: number; name: string; color: string; phase: PhaseName }>

            // Estimate label width as a percentage of the container width.
            // ~0.7% per character at 9px font in a typical chart width.
            const CHAR_W_PCT = 0.7
            const LABEL_GAP_PCT = 1.5 // minimum gap between adjacent labels

            // Greedy 2-row placement
            const rowEnds = [-Infinity, -Infinity] // right edge of last label on each row
            return labels.map(l => {
              const labelW = l.name.length * CHAR_W_PCT
              const leftEdge = l.midPct - labelW / 2
              // Pick the first row where the label doesn't collide
              let row = 0
              if (leftEdge < rowEnds[0] + LABEL_GAP_PCT) row = 1
              // If row 1 also collides, push the label right (clamp)
              let adjustedLeft = leftEdge
              if (leftEdge < rowEnds[row] + LABEL_GAP_PCT) {
                adjustedLeft = rowEnds[row] + LABEL_GAP_PCT
              }
              rowEnds[row] = adjustedLeft + labelW
              return { ...l, leftPct: adjustedLeft + labelW / 2, row }
            }).map(l => (
              <span
                key={l.phase}
                className="absolute text-[9px] font-medium -translate-x-1/2"
                style={{
                  left: `${l.leftPct}%`,
                  top: `${l.row * 11}px`,
                  color: l.color,
                  opacity: 0.75,
                }}
              >
                {l.name}
              </span>
            ))
          })()}
        </div>

        {/* Recharts chart — deferred until mounted to avoid the 0×0
            ResponsiveContainer warning on first paint.
            Wrapped in a relative container so we can overlay dose markers
            (4.1) and the pulsing now-dot (4.2) positioned by percentage. */}
        <div className="relative">
          {/* 4.1: Dose start markers — small downward triangles below the
              chart at each dose's start time. Positioned to match the chart's
              plot area (accounting for Y-axis width + left margin offset).
              Only shown for doses whose start time falls within the window. */}
          {mounted && config.series.map(s => {
            const doseStartMs = s.dose.doseTime.getTime()
            if (doseStartMs < config.windowStartMs || doseStartMs > config.windowEndMs) return null
            // The chart's plot area is offset from the container by:
            //   left = YAxisWidth(32) + leftMargin(-12) = 20px
            //   right = containerWidth - rightMargin(8)
            // So plotAreaWidth = 100% - 20px - 8px = 100% - 28px
            // Position = plotAreaLeft + pct * plotAreaWidth
            //          = 20px + (pct/100) * (100% - 28px)
            const pct = ((doseStartMs - config.windowStartMs) / (config.windowEndMs - config.windowStartMs)) * 100
            return (
              <div
                key={`dose-marker-${s.dataKey}`}
                className="absolute pointer-events-none z-10"
                style={{
                  left: `calc(20px + ${pct / 100} * (100% - 28px))`,
                  bottom: 0,
                  transform: 'translateX(-50%)',
                }}
                title={`${s.dose.substanceName} ${formatDoseAmount(s.dose.amount, s.dose.unit).amount}${formatDoseAmount(s.dose.amount, s.dose.unit).unit} · ${format(new Date(doseStartMs), 'h:mm a')}`}
              >
                {/* Downward triangle */}
                <div
                  className="w-0 h-0"
                  style={{
                    borderLeft: '4px solid transparent',
                    borderRight: '4px solid transparent',
                    borderTop: `5px solid ${s.palette.stroke}`,
                    opacity: 0.8,
                  }}
                />
              </div>
            )
          })}

          {/* Chart container — tabIndex + onKeyDown enable keyboard navigation (1.7).
            Arrow Left/Right move the tooltip, Escape clears it. */}
          <div
            style={{ width: '100%', height: isMobile ? 200 : 280 }}
            tabIndex={0}
            role="application"
            aria-label={`Intensity timeline chart for ${group.substanceName}. Use arrow keys to navigate, Escape to clear.`}
            onKeyDown={(e) => {
              // 1.7: Keyboard navigation — dispatch synthetic mousemove events
              // to move Recharts' tooltip. Finds the chart's <svg> and computes
              // a new X based on the current cursor position (or center on first press).
              const svg = e.currentTarget.querySelector('svg.recharts-surface')
              if (!svg) return
              const rect = svg.getBoundingClientRect()
              // Track current cursor X on the element (fallback to center)
              const currentX = (svg as any).__cursorX ?? rect.width / 2
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault()
                const step = rect.width * 0.03 // 3% per press
                const nextX = Math.max(0, Math.min(rect.width, currentX + (e.key === 'ArrowRight' ? step : -step)))
                  ; (svg as any).__cursorX = nextX
                // Dispatch synthetic mousemove
                const mouseEvent = new MouseEvent('mousemove', {
                  bubbles: true,
                  clientX: rect.left + nextX,
                  clientY: rect.top + rect.height / 2,
                })
                svg.dispatchEvent(mouseEvent)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                // Dispatch mouseout to clear the tooltip
                svg.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
                  ; (svg as any).__cursorX = undefined
              }
            }}
            onMouseMove={(e) => {
              // Track cursor X for keyboard nav + 2.6 hover-snap
              const svg = e.currentTarget.querySelector('svg.recharts-surface')
              if (!svg) return
              const rect = svg.getBoundingClientRect()
              const x = e.clientX - rect.left
                ; (svg as any).__cursorX = x

              // 2.6: Hover-snap to dose events — if the cursor is within ~5% of
              // a dose start time, snap the tooltip to that dose's exact start.
              // Implemented by finding the nearest dose start and, if close
              // enough, dispatching a synthetic mousemove at that X.
              const snapThresholdPx = rect.width * 0.03 // 3% of chart width
              let nearestDoseX: number | null = null
              let nearestDist = Infinity
              for (const s of config.series) {
                const doseStartMs = s.dose.doseTime.getTime()
                if (doseStartMs < config.windowStartMs || doseStartMs > config.windowEndMs) continue
                const dosePct = (doseStartMs - config.windowStartMs) / (config.windowEndMs - config.windowStartMs)
                const doseX = dosePct * rect.width
                const dist = Math.abs(doseX - x)
                if (dist < nearestDist) {
                  nearestDist = dist
                  nearestDoseX = doseX
                }
              }
              if (nearestDoseX !== null && nearestDist < snapThresholdPx && Math.abs(nearestDoseX - x) > 1) {
                // Snap — dispatch a synthetic mousemove at the dose start X.
                // Only do this if we're not already very close (avoids infinite loops).
                svg.dispatchEvent(new MouseEvent('mousemove', {
                  bubbles: true,
                  clientX: rect.left + nearestDoseX,
                  clientY: e.clientY,
                }))
              }
            }}
          >
            {mounted ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={config.data} margin={{ top: 4, right: 8, left: -12, bottom: 4 }}>
                  <defs>
                    {config.series.map((s, i) => (
                      <linearGradient key={`grad-${i}`} id={`grad-${group.key}-${i}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={s.palette.fill} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={s.palette.fill} stopOpacity={0.02} />
                      </linearGradient>
                    ))}
                    {/* 4.5: Chart background gradient */}
                    <linearGradient id={`bg-grad-${group.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgba(255,255,255,0.02)" />
                      <stop offset="100%" stopColor="rgba(0,0,0,0.15)" />
                    </linearGradient>
                  </defs>

                  {/* 4.5: background fill */}
                  <rect x={0} y={0} width="100%" height="100%" fill={`url(#bg-grad-${group.key})`} fillOpacity={0.5} />

                  {/* Phase band backgrounds */}
                  {config.phaseBands.map(band => {
                    const pb = PHASE_BANDS.find(b => b.phase === band.phase)
                    if (!pb) return null
                    return (
                      <ReferenceArea
                        key={`band-${band.phase}`}
                        x1={band.startMs}
                        x2={band.endMs}
                        strokeOpacity={0}
                        fill={pb.fill}
                        fillOpacity={0.06}
                      />
                    )
                  })}

                  {/* 2.5: Night-hour background bands (10pm–6am) */}
                  {nightBands.map((nb, i) => (
                    <ReferenceArea
                      key={`night-${i}`}
                      x1={nb.startMs}
                      x2={nb.endMs}
                      strokeOpacity={0}
                      fill="#1e293b"
                      fillOpacity={0.15}
                    />
                  ))}

                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis
                    dataKey="t"
                    type="number"
                    domain={[config.windowStartMs, config.windowEndMs]}
                    scale="time"
                    tick={{ fontSize: 10, fill: 'currentColor' }}
                    stroke="currentColor"
                    tickFormatter={(ts) => format(new Date(ts), 'h:mm a')}
                    minTickGap={40}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 10, fill: 'currentColor' }}
                    stroke="currentColor"
                    width={32}
                    tickFormatter={(v) => `${v}%`}
                    label={{ value: 'Intensity', angle: -90, position: 'insideLeft', fontSize: 9, fill: 'currentColor', opacity: 0.6, dy: 20 }}
                  />
                  <Tooltip
                    content={<ChartTooltip series={config.series} windowStartMs={config.windowStartMs} nowTs={nowTs} />}
                    cursor={{ stroke: 'rgba(255,255,255,0.3)', strokeWidth: 1, strokeDasharray: '4 4' }}
                  />

                  {/* Now indicator — position comes from nowRef.current, NOT from
                  config (which is memoized and stable across ticks).
                  The pulsing dot is rendered as a custom SVG label inside
                  the ReferenceLine so it's in the same coordinate space as
                  the dashed line (guarantees perfect horizontal alignment).
                  Uses SVG <animate> instead of CSS (4.2). */}
                  {nowRef.current >= config.windowStartMs && nowRef.current <= config.windowEndMs && (
                    <ReferenceLine
                      x={nowRef.current}
                      // eslint-disable-next-line react-hooks/rules-of-hooks -- ref access in JSX is intentional for live now-indicator
                      stroke={NOW_INDICATOR.color}
                      strokeWidth={NOW_INDICATOR.strokeWidth}
                      strokeDasharray={NOW_INDICATOR.dashArray}
                      label={(props: { viewBox?: { x?: number; y?: number } }) => {
                        // Render the "NOW" text + a pulsing SVG circle at the top
                        // of the line. props.viewBox.x is the exact SVG x-coordinate
                        // of the line, so the dot is always centered on it.
                        const cx = props.viewBox?.x ?? 0
                        const cy = 4 // near the top of the chart
                        return (
                          <g>
                            <text
                              x={cx}
                              y={cy - 6}
                              textAnchor="middle"
                              fontSize={8}
                              fill={NOW_INDICATOR.color}
                              opacity={0.8}
                            >
                              NOW
                            </text>
                            <circle cx={cx} cy={cy} r={NOW_INDICATOR.dotRadius} fill={NOW_INDICATOR.color}>
                              <animate
                                attributeName="opacity"
                                values="1;0.3;1"
                                dur={`${NOW_INDICATOR.pulseDurationMs}ms`}
                                repeatCount="indefinite"
                              />
                              <animate
                                attributeName="r"
                                values={`${NOW_INDICATOR.dotRadius};${NOW_INDICATOR.dotRadius * 0.7};${NOW_INDICATOR.dotRadius}`}
                                dur={`${NOW_INDICATOR.pulseDurationMs}ms`}
                                repeatCount="indefinite"
                              />
                            </circle>
                          </g>
                        )
                      }}
                    />
                  )}

                  {/* One Area per dose. isEnded is computed fresh from nowTs so
                  ended doses fade out without re-sampling the chart data.
                  4.4: ended doses get a dashed stroke + reduced opacity to
                  make "this is over" more obvious.
                  dot=false + activeDot=false ensures Recharts doesn't render
                  default dots at data points (which would look like stray
                  markers at curve peaks and start/end points). */}
                  {config.series.map((s, i) => {
                    const doseEnded = (nowTs - s.dose.doseTime.getTime()) / 60_000 >= s.dose.timings.offsetEnd
                    return (
                      <Area
                        key={s.dataKey}
                        type="monotone"
                        dataKey={s.dataKey}
                        stroke={s.palette.stroke}
                        strokeWidth={i === 0 ? 2.5 : 1.5}
                        strokeDasharray={doseEnded ? '4 4' : undefined}
                        fill={`url(#grad-${group.key}-${i})`}
                        opacity={doseEnded ? 0.4 : 1}
                        isAnimationActive={false}
                        connectNulls
                        dot={false}
                        activeDot={false}
                      />
                    )
                  })}

                  {/* 2.8: Predictive projection — a faded dashed line showing where
                  the next scheduled dose's curve would fall, based on the
                  reminder schedule. Only renders if a schedule exists and the
                  projected dose time is within the chart window. Rendered as
                  a ReferenceLine at the projected dose time (simpler than
                  sampling a full curve). */}
                  {projectionSeries && (
                    <ReferenceLine
                      x={projectionSeries.ts}
                      stroke={ROUTE_PALETTE[0].stroke}
                      strokeWidth={1}
                      strokeDasharray="2 4"
                      opacity={0.4}
                      label={{ value: 'Next?', fontSize: 8, fill: ROUTE_PALETTE[0].stroke, position: 'top', opacity: 0.6 }}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            ) : null}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-[10px] text-neutral-content mt-2 gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span>
              {visibleRoutes.length} route{visibleRoutes.length !== 1 ? 's' : ''} · {totalDoses} dose{totalDoses !== 1 ? 's' : ''}
            </span>
            {/* 4.3: Chart-native route legend — colored dots + route names.
                Only shown when multi-route (single-route is self-evident). */}
            {isMultiRoute && (
              <span className="flex items-center gap-1.5">
                {group.routes.map(rg => {
                  const palette = ROUTE_PALETTE[rg.paletteIndex % ROUTE_PALETTE.length]
                  return (
                    <span key={rg.route} className="inline-flex items-center gap-0.5">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: palette.fill }} />
                      <span className="capitalize">{rg.route}</span>
                    </span>
                  )
                })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* 2.7: Export chart as PNG */}
            <button
              onClick={() => exportChartPng(group.key, group.substanceName)}
              className="flex items-center gap-1 hover:text-base-content transition-colors"
              title="Download chart as PNG"
            >
              <Download className="h-3 w-3" />
            </button>
            <button onClick={onToggleExpand} className="flex items-center gap-1 hover:text-base-content transition-colors">
              {isExpanded ? (
                <><ChevronUp className="h-3 w-3" /> Less</>
              ) : (
                <><ChevronDown className="h-3 w-3" /> Phase details</>
              )}
            </button>
          </div>
        </div>

        {/* Expanded phase details */}
        {isExpanded && (
          <div className="mt-3 space-y-3 pt-3 border-t border-base-300/50">
            {visibleRoutes.map(rg => {
              const palette = ROUTE_PALETTE[rg.paletteIndex % ROUTE_PALETTE.length]
              return (
                <div key={rg.route} className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: palette.fill }} />
                    <span className="text-xs font-medium capitalize">{rg.route}</span>
                    {rg.uniformUnit && (
                      <span className="text-[10px] text-neutral-content">{rg.totalAmount}{rg.unit} total</span>
                    )}
                  </div>
                  {rg.doses.map(d => {
                    const doseId = String(d.id ?? d.doseTime.getTime())
                    const cPhase = getPhaseStatus(d.doseTime, d.timings).phase
                    const CPhaseIcon = phaseIcons[cPhase] || phaseIcons['onset']
                    const phases = [
                      { key: 'onset', end: d.timings.onsetEnd },
                      { key: 'comeup', end: d.timings.comeupEnd },
                      { key: 'peak', end: d.timings.peakEnd },
                      { key: 'offset', end: d.timings.offsetEnd },
                    ] as const
                    const phaseOrder = ['onset', 'comeup', 'peak', 'offset']
                    const currentIdx = phaseOrder.indexOf(cPhase)
                    const fmt = formatDoseAmount(d.amount, d.unit)
                    // 1.5: afterglow duration for the badge
                    const afterglowMins = afterglowDurationMins(d)
                    return (
                      <div key={doseId} className="ml-4 space-y-1">
                        <div className="flex items-center gap-1.5 text-[10px] text-neutral-content flex-wrap">
                          <span className="font-medium text-base-content">{fmt.amount} {fmt.unit}</span>
                          <span>·</span>
                          <span>{format(d.doseTime, 'h:mm a')}</span>
                          <span className={`inline-flex items-center gap-0.5 ${phaseColors[cPhase]?.text || ''}`}>
                            <CPhaseIcon className="h-3 w-3" />
                            {formatPhaseName(cPhase)}
                          </span>
                          {/* 1.5: Afterglow badge */}
                          {afterglowMins > 0 && (
                            <span className="inline-flex items-center gap-0.5 px-1 py-0 rounded text-[9px] bg-amber-500/20 text-amber-600 dark:text-amber-400">
                              <Sparkles className="h-2.5 w-2.5" />
                              {formatMinutes(afterglowMins)} afterglow
                            </span>
                          )}
                        </div>
                        {phases.map((p, pi) => {
                          const start = pi === 0 ? 0 : phases[pi - 1].end
                          const duration = Math.max(0, Math.round(p.end - start))
                          const isActive = cPhase === p.key
                          const isPast = cPhase !== 'not_started' && cPhase !== 'ended' ? currentIdx > pi : false
                          const phaseEndProgress = (p.end / d.timings.totalDuration) * 100
                          // Fix 1.2: scale phase-peak intensity by doseHeight so a heavy
                          // dose's peak phase shows >100% (matching the chart curve).
                          const phasePeakIntensity = Math.min(100, intensityAt(phaseEndProgress, d.timings) * d.doseHeight)
                          const PIcon = phaseIcons[p.key as PhaseName]
                          const pc = phaseColors[p.key as PhaseName]
                          return (
                            <div
                              key={p.key}
                              className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-all ${isActive ? 'ring-1 ring-purple-500/30 bg-purple-500/5' : isPast ? 'opacity-50' : 'opacity-30'
                                }`}
                            >
                              <PIcon className={`h-3.5 w-3.5 shrink-0 ${pc.text}`} />
                              <span className={`font-medium w-16 ${pc.text}`}>{formatPhaseName(p.key as PhaseName)}</span>
                              <span className="text-[10px] text-neutral-content">({formatMinutes(duration)})</span>
                              {/* 1.6: Mini sparkline showing the intensity curve shape for this phase */}
                              <PhaseSparkline dose={d} phase={p.key as PhaseName} />
                              <div className="flex-1 h-1 bg-base-200/50 rounded-full overflow-hidden max-w-[60px]">
                                <div className="h-full rounded-full transition-all" style={{ width: `${Math.round(phasePeakIntensity)}%`, backgroundColor: palette.fill, opacity: isActive ? 0.8 : 0.3 }} />
                              </div>
                              <span className="text-[10px] font-mono text-neutral-content w-8 text-right">{Math.round(phasePeakIntensity)}%</span>
                              {isActive && <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Mobile Phase Strip (2.4) ──────────────────────────────────────────────

interface MobilePhaseStripProps {
  group: SubstanceGroup
  nowTs: number
  windowStartMs: number
  windowEndMs: number
}

/**
 * Compact at-a-glance phase bar for mobile.
 *
 * Shows the 4 phases (onset/comeup/peak/offset) of the primary dose as
 * proportional colored segments, with a "now" marker showing where in the
 * timeline the user currently is. This gives a quick "which phase am I in"
 * read without needing to parse the full Recharts chart below it.
 *
 * Inspired by the old MobilePhaseBar's PhaseProgressBar, but simpler —
 * just the phase strip + now marker, no SVG curves (those are in the
 * Recharts chart below).
 */
function MobilePhaseStrip({ group, nowTs, windowStartMs, windowEndMs }: MobilePhaseStripProps) {
  const primaryDose = group.primary
  const { timings } = primaryDose
  const doseStartMs = primaryDose.doseTime.getTime()

  // Compute the "now" position as a percentage of the dose's total duration
  const elapsedMins = (nowTs - doseStartMs) / 60_000
  const nowPct = (elapsedMins / timings.totalDuration) * 100

  // Only show the strip if "now" is within the dose's active range
  if (nowPct < 0 || nowPct > 100) return null

  // Phase segments with proportional widths
  const phases = [
    { key: 'onset' as const, end: timings.onsetEnd, color: phaseColors.onset.bar },
    { key: 'comeup' as const, end: timings.comeupEnd, color: phaseColors.comeup.bar },
    { key: 'peak' as const, end: timings.peakEnd, color: phaseColors.peak.bar },
    { key: 'offset' as const, end: timings.offsetEnd, color: phaseColors.offset.bar },
  ]

  // Current phase for the label
  const currentPhase = getPhaseStatus(primaryDose.doseTime, timings).phase
  const remaining = Math.max(0, timings.offsetEnd - elapsedMins)

  return (
    <div className="mb-3">
      {/* Phase label + remaining time */}
      <div className="flex items-center justify-between mb-1">
        <span className={`text-xs font-medium ${phaseColors[currentPhase]?.text || ''}`}>
          {formatPhaseName(currentPhase)}
        </span>
        {remaining > 0 && (
          <span className="text-[10px] text-neutral-content flex items-center gap-0.5">
            <Timer className="h-2.5 w-2.5" />
            {formatMinutes(remaining)} left
          </span>
        )}
      </div>

      {/* Phase progress bar with proportional segments */}
      <div className="relative h-2.5 rounded-full overflow-hidden flex">
        {phases.map((p, i) => {
          const start = i === 0 ? 0 : phases[i - 1].end
          const widthPct = Math.max(1, ((p.end - start) / timings.totalDuration) * 100)
          const isPast = elapsedMins >= p.end
          const isCurrent = currentPhase === p.key
          return (
            <div
              key={p.key}
              className={`${p.color} transition-all duration-500 ${isPast || isCurrent ? 'opacity-100' : 'opacity-30'
                }`}
              style={{ width: `${widthPct}%` }}
            />
          )
        })}

        {/* Now marker — white vertical line at the current position */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-white shadow-sm pointer-events-none"
          style={{ left: `${Math.min(100, Math.max(0, nowPct))}%`, transform: 'translateX(-50%)' }}
        >
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-white shadow" />
        </div>
      </div>
    </div>
  )
}

// ─── Custom Tooltip ────────────────────────────────────────────────────────

interface ChartTooltipProps {
  active?: boolean
  payload?: Array<{ dataKey: string; value: number; color: string }>
  label?: number
  series: DoseSeries[]
  windowStartMs: number
  /** Current time in ms — used for the "NOW" badge (1.3) when hovering
   *  within ~3% of the current time. */
  nowTs: number
}

function ChartTooltip({ active, payload, label, series, windowStartMs, nowTs }: ChartTooltipProps) {
  if (!active || !payload || !label) return null
  const t = label

  // 1.3: "NOW" badge — shown when the hovered timestamp is within 3 minutes
  // of the current time. Uses absolute time diff (not percentage) so it works
  // correctly regardless of the chart window width.
  const isNearNow = Math.abs(t - nowTs) < 3 * 60 * 1000

  // Find active doses at this timestamp.
  // p.value is the dose-height-scaled intensity from the chart data (Fix 1.2
  // — already applied during sampling in buildChartConfig).
  const activeDoses: Array<{ series: DoseSeries; intensity: number; phase: PhaseName; minutesUntilPhaseChange: number }> = []
  for (const p of payload) {
    if (p.value <= 0) continue
    const s = series.find(s => s.dataKey === p.dataKey)
    if (!s) continue
    const elapsedMins = (t - s.dose.doseTime.getTime()) / 60_000
    const progress = (elapsedMins / s.dose.timings.totalDuration) * 100
    const phase = phaseNameAt(progress, s.dose.timings)
    const pEnd = phaseEnd(phase, s.dose.timings)
    const minutesUntilPhaseChange = Math.max(0, pEnd - elapsedMins)
    activeDoses.push({ series: s, intensity: p.value, phase, minutesUntilPhaseChange })
  }

  if (activeDoses.length === 0) return null

  // Fix 1.1: combined intensity uses soft log-dampening above 100% so
  // redosing visually stacks (not peak-hold). Can return up to 200.
  const combinedIntensity = combinedIntensityAt(activeDoses.map(d => d.intensity))
  // The peak dose (highest single-dose intensity) drives the phase label
  // and the "minutes until phase change" display.
  const maxIntensity = Math.max(...activeDoses.map(d => d.intensity))
  const peakDose = activeDoses.find(d => d.intensity === maxIntensity)!

  // Group by route for per-route breakdown
  const byRoute = new Map<string, { intensity: number; phase: PhaseName; palette: { stroke: string; fill: string } }>()
  for (const ad of activeDoses) {
    const existing = byRoute.get(ad.series.route.route)
    if (!existing || existing.intensity < ad.intensity) {
      byRoute.set(ad.series.route.route, {
        intensity: ad.intensity,
        phase: ad.phase,
        palette: ad.series.palette,
      })
    }
  }

  // Display is clamped to 100% — the combinedIntensityAt model can produce
  // values >100 when doses stack, but we don't surface that to the user to
  // avoid confusion (the chart curves themselves also cap at 100).
  const combinedDisplay = Math.min(100, Math.round(combinedIntensity))

  return (
    <div className="rounded-lg border border-neutral-500/25 bg-black/80 backdrop-blur-xl px-3 py-2.5 shadow-2xl min-w-[200px] max-w-[280px]" role="tooltip">
      {/* Header: phase + time + NOW badge (1.3) */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold" style={{ color: markerHex[peakDose.phase] ?? '#a855f7' }}>
          {formatPhaseName(peakDose.phase)}
        </span>
        <div className="flex items-center gap-1.5">
          {isNearNow && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded text-[9px] font-bold bg-rose-500/30 text-rose-300">
              <span className="w-1 h-1 rounded-full bg-rose-400 animate-pulse" />
              NOW
            </span>
          )}
          <span className="text-[10px] text-neutral-300/70">{format(new Date(t), 'h:mm a')}</span>
        </div>
      </div>

      {/* Combined intensity bar — capped at 100% */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-semibold text-neutral-300/60 w-20 shrink-0">Combined</span>
        <div className="flex-1 h-2 bg-neutral-500/15 rounded-full overflow-hidden relative">
          <div className="h-full rounded-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all" style={{ width: `${combinedDisplay}%` }} />
        </div>
        <span className="text-xs font-bold w-10 text-right text-purple-300">{combinedDisplay}%</span>
      </div>

      {/* Per-route breakdown */}
      {byRoute.size > 1 && (
        <div className="space-y-1">
          {Array.from(byRoute.entries()).map(([route, info]) => (
            <div key={route} className="flex items-center gap-2">
              <span className="text-[10px] font-medium text-neutral-300/60 w-20 shrink-0 truncate capitalize">{route}</span>
              <div className="flex-1 h-1.5 bg-neutral-500/15 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, Math.round(info.intensity))}%`, backgroundColor: info.palette.stroke }} />
              </div>
              <span className="text-[10px] w-10 text-right text-neutral-300/80">{Math.round(info.intensity)}%</span>
            </div>
          ))}
        </div>
      )}

      {/* Time-in summary */}
      <div className="mt-2 pt-1.5 border-t border-neutral-500/20 flex items-baseline gap-2">
        <span className="text-base font-bold text-neutral-200">{combinedDisplay}%</span>
        <span className="text-[10px] text-neutral-300/60">combined intensity</span>
      </div>

      {/* Minutes until phase change */}
      {peakDose.minutesUntilPhaseChange > 0 && (
        <div className="mt-1 flex items-center gap-1.5">
          <Timer className="h-3 w-3 text-neutral-300/50" />
          <span className="text-[10px] text-neutral-300/70">
            <span className="font-medium text-neutral-300">{formatMinutes(peakDose.minutesUntilPhaseChange)}</span> until{' '}
            {(() => {
              const order: PhaseName[] = ['onset', 'comeup', 'peak', 'offset']
              const idx = order.indexOf(peakDose.phase)
              const next = idx < order.length - 1 ? order[idx + 1] : null
              return next ? formatPhaseName(next) : 'end'
            })()}
          </span>
        </div>
      )}
    </div>
  )
}
