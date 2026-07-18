'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Plus, Loader2, AlertTriangle, Zap, Clock, CalendarDays, X, ChevronDown, ChevronUp, Pin, PinOff, GripVertical, Pill } from 'lucide-react'
import { substances, searchSubstancesRanked } from '@/lib/substances/index'
import { useMedicationStore, getMedicationsAsSubstances, isMedicationSelectorId, getMedicationBySelectorId, toMedicationSelectorId } from '@/store/medication-store'
import { useCustomSubstanceStore } from '@/store/custom-substance-store'
import { checkInteractions as checkInteractionsEngine } from '@/lib/interaction-checker'
import { toast } from '@/hooks/use-toast'
import { useDoseStore } from '@/store/dose-store'
import { DoseLog, Duration } from '@/types'
import { calculatePhaseTimings, getPhaseStatus } from '@/components/dose-timeline/dose-timeline-utils'
import { getDurationForRoute, normaliseRoute } from '@/lib/duration-interpolation'
import { DurationOverrideFields } from '@/components/duration-override-fields'
import { useReminderStore } from '@/store/reminder-store'
import { formatIntervalMinutes } from '@/lib/notification-utils'
import { RedosePlanner } from '@/components/redose-planner'
import { useUIStore } from '@/store/ui-store'
import { cn } from '@/lib/utils'
import { useMedia } from 'react-use'
import { motion, AnimatePresence } from 'framer-motion'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { AlcoholCalculatorFields } from '@/components/alcohol-calculator-fields'

interface DoseLoggerModalProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onLogCreated?: () => void
  trigger?: React.ReactNode
  preselectedSubstanceId?: string
  preselectedSubstanceName?: string
  preselectedCategory?: string | string[]
  preselectedRoute?: string
}

const moodOptions: ComboboxOption[] = [
  { value: 'happy', label: 'Happy' },
  { value: 'relaxed', label: 'Relaxed' },
  { value: 'anxious', label: 'Anxious' },
  { value: 'stressed', label: 'Stressed' },
  { value: 'sad', label: 'Sad' },
  { value: 'energetic', label: 'Energetic' },
  { value: 'curious', label: 'Curious' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'excited', label: 'Excited' },
  { value: 'bored', label: 'Bored' },
  { value: 'tired', label: 'Tired' },
  { value: 'focused', label: 'Focused' },
]

const settingOptions: ComboboxOption[] = [
  { value: 'home', label: 'Home' },
  { value: 'friends', label: 'With Friends' },
  { value: 'party', label: 'Party/Event' },
  { value: 'nature', label: 'Nature' },
  { value: 'festival', label: 'Festival' },
  { value: 'work', label: 'Work' },
  { value: 'gym', label: 'Gym' },
  { value: 'concert', label: 'Concert' },
  { value: 'bar', label: 'Bar/Club' },
  { value: 'travel', label: 'Traveling' },
  { value: 'other', label: 'Other' },
]

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

const unitOptions: ComboboxOption[] = [
  { value: 'mg', label: 'mg (milligrams)' },
  { value: 'g', label: 'g (grams)' },
  { value: 'μg', label: 'μg (micrograms)' },
  { value: 'ml', label: 'ml (milliliters)' },
  { value: 'drop', label: 'drop' },
  { value: 'puff', label: 'puff' },
  { value: 'tab', label: 'tab' },
  { value: 'capsule', label: 'capsule' },
  { value: 'hit', label: 'hit' },
  { value: 'line', label: 'line' },
  { value: 'drink', label: 'drink' },
  { value: 'shot', label: 'shot' },
  { value: 'joint', label: 'joint' },
  { value: 'blunt', label: 'blunt' },
  { value: 'bowl', label: 'bowl' },
  { value: 'blinker', label: 'blinker' },
]

const defaultRouteOptions: ComboboxOption[] = [
  { value: 'oral', label: 'Oral' },
  { value: 'insufflation', label: 'Insufflation' },
  { value: 'inhalation', label: 'Inhalation' },
  { value: 'sublingual', label: 'Sublingual' },
  { value: 'rectal', label: 'Rectal' },
  { value: 'intramuscular', label: 'Intramuscular' },
  { value: 'transdermal', label: 'Transdermal' },
  { value: 'intravenous', label: 'Intravenous' },
  { value: 'smoked', label: 'Smoked' },
  { value: 'vaped', label: 'Vaped' },
]

// ─── Smart amount+unit parsing ────────────────────────────────────────────────

const KNOWN_UNITS = unitOptions.map(u => u.value)

const UNIT_ALIASES: Record<string, string> = {
  'micrograms': 'μg', 'microgram': 'μg', 'mcg': 'μg', 'ug': 'μg',
  'milligrams': 'mg', 'milligram': 'mg',
  'grams': 'g', 'gram': 'g',
  'milliliters': 'ml', 'milliliter': 'ml', 'mls': 'ml',
  'drops': 'drop', 'puffs': 'puff', 'tabs': 'tab', 'tablets': 'tab',
  'capsules': 'capsule', 'pills': 'capsule', 'hits': 'hit',
  'lines': 'line', 'drinks': 'drink', 'shots': 'shot',
  'joints': 'joint', 'blunts': 'blunt', 'bowls': 'bowl', 'blinkers': 'blinker',
}

const UNIT_TO_ROUTE: Record<string, string> = {
  'joint': 'smoked',
  'blunt': 'smoked',
  'bowl': 'smoked',
  'bong': 'smoked',
  'dab': 'smoked',
  'blinker': 'smoked',
  'puff': 'smoked',
  'pill': 'oral',
  'capsule': 'oral',
  'tablet': 'oral',
  'line': 'insufflation',
}

function resolveUnitFuzzy(typed: string): string | null {
  const lower = typed.toLowerCase().trim()
  if (!lower || lower.length < 2) return null

  if (KNOWN_UNITS.includes(lower)) return lower
  if (UNIT_ALIASES[lower]) return UNIT_ALIASES[lower]

  const prefixMatches = KNOWN_UNITS.filter(u => u.startsWith(lower))
  if (prefixMatches.length === 1) {
    return prefixMatches[0]
  }
  if (prefixMatches.length > 1) {
    prefixMatches.sort((a, b) => a.length - b.length)
    return prefixMatches[0]
  }

  for (const [alias, canonical] of Object.entries(UNIT_ALIASES)) {
    if (alias.startsWith(lower)) {
      return canonical
    }
  }

  return null
}

function parseAmountUnit(input: string): { amount: string; unit: string | null } {
  const trimmed = input.trim()
  if (!trimmed) return { amount: '', unit: null }

  const match = trimmed.match(/^([\-\+]?\d*\.?\d+)(?:\s*([a-zA-Zμ]+))?$/)
  if (match) {
    const amountStr = match[1]
    const unitStr = match[2]
    if (!unitStr) return { amount: amountStr, unit: null }

    const lower = unitStr.toLowerCase()

    if (KNOWN_UNITS.includes(lower)) return { amount: amountStr, unit: lower }
    if (UNIT_ALIASES[lower]) return { amount: amountStr, unit: UNIT_ALIASES[lower] }
    const fuzzyMatch = resolveUnitFuzzy(lower)
    if (fuzzyMatch) return { amount: amountStr, unit: fuzzyMatch }
    return { amount: amountStr, unit: lower }
  }

  return { amount: trimmed, unit: null }
}

/* ------------------------------------------------------------------ */
/*  Quick Input Parser - Extract substance, amount, unit from string   */
/* ------------------------------------------------------------------ */

const KNOWN_ROUTES = ['oral', 'insufflation', 'inhalation', 'sublingual', 'rectal', 'intramuscular', 'transdermal', 'intravenous', 'smoked', 'vaped', 'snorted', 'nasal', 'subq', 'subcutaneous']

const ROUTE_ALIASES: Record<string, string> = {
  'snorted': 'insufflation',
  'nasal': 'insufflation',
  'nose': 'insufflation',
  'smoked': 'smoked',
  'vaped': 'vaped',
  'vape': 'vaped',
  'iv': 'intravenous',
  'im': 'intramuscular',
  // B3 fix: SubQ / subcutaneous is an injection, NOT sublingual.
  // Map to intramuscular so duration/route logic for injected substances
  // applies; users who want a true Subcutaneous route can type it as a
  // custom value (the Combobox allows custom entries).
  'subq': 'intramuscular',
  'subcutaneous': 'intramuscular',
  'under tongue': 'sublingual',
  'anal': 'rectal',
  'boofed': 'rectal',
  'boof': 'rectal',
  'patch': 'transdermal',
  'eat': 'oral',
  'eaten': 'oral',
  'drink': 'oral',
  'drank': 'oral',
}

const ROUTE_REGEXES = [...KNOWN_ROUTES, ...Object.keys(ROUTE_ALIASES)]
  .map(r => ({ route: r, regex: new RegExp(`\\b${r}\\b`, 'i') }))

export function evaluateMathExpression(
  input: string
): { result: number; unit: string; expression: string; matchStart: number; matchLength: number } | null {
  if (!input) return null

  const mathRegex =
    '(\\d+\\.?\\d*)' +
    '(?:\\s*[a-zA-Zμμ]+)?' +
    '\\s*([*x×+\-/])' +
    '\\s*(\\d+\\.?\\d*)' +
    '(?:\\s*[a-zA-Zμμ]+)?' +
    '(?:\\s+each)?' +
    '(?:\\s*([*x×+\-/])' +
    '\\s*(\\d+\\.?\\d*)' +
    '(?:\\s*[a-zA-Zμμ]+)?' +
    ')?'

  const regex = new RegExp(mathRegex, 'i')
  const match = input.match(regex)

  if (!match) return null

  const matchStart = match.index ?? 0
  const matchLength = match[0].length

  const num1 = parseFloat(match[1])
  const op1 = match[2]
  const num2 = parseFloat(match[3])
  const chainOp = match[4]
  const chainNum = match[5]

  if (isNaN(num1) || isNaN(num2)) return null

  let resolvedUnit = ''

  const unit1Match = match[0].match(/^(\d+\.?\d*)\s*([a-zA-Zμμ]+)/)
  const afterOp = match[0].split(/[\*x×+\-\/]/).slice(1).join('')
  const unit2Match = afterOp.match(/(\d+\.?\d*)\s*([a-zA-Zμμ]+)/)

  let rawUnit1 = unit1Match?.[2]?.toLowerCase() || ''
  let rawUnit2 = unit2Match?.[2]?.toLowerCase() || ''

  const countUnits = new Set([
    'pill', 'pills', 'tab', 'tabs', 'tablet', 'tablets', 'capsule', 'capsules',
    'drop', 'drops', 'puff', 'puffs', 'hit', 'hits', 'serving', 'servings',
  ])

  const isCount1 = rawUnit1 && (countUnits.has(rawUnit1) || (UNIT_ALIASES[rawUnit1] && countUnits.has(UNIT_ALIASES[rawUnit1])))
  const isCount2 = rawUnit2 && (countUnits.has(rawUnit2) || (UNIT_ALIASES[rawUnit2] && countUnits.has(UNIT_ALIASES[rawUnit2])))

  if (rawUnit2 && !isCount2) {
    resolvedUnit = UNIT_ALIASES[rawUnit2] || rawUnit2
    const fuzzy = resolveUnitFuzzy(rawUnit2)
    if (fuzzy) resolvedUnit = fuzzy
  } else if (rawUnit1 && !isCount1) {
    resolvedUnit = UNIT_ALIASES[rawUnit1] || rawUnit1
    const fuzzy = resolveUnitFuzzy(rawUnit1)
    if (fuzzy) resolvedUnit = fuzzy
  }

  let result: number
  switch (op1.toLowerCase()) {
    case '*': case 'x': case '×':
      result = num1 * num2
      break
    case '+':
      result = num1 + num2
      break
    case '-':
      result = num1 - num2
      break
    case '/':
      if (num2 === 0) return null
      result = num1 / num2
      break
    default:
      return null
  }

  if (chainOp && chainNum) {
    const chainVal = parseFloat(chainNum)
    if (!isNaN(chainVal)) {
      switch (chainOp.toLowerCase()) {
        case '*': case 'x': case '×': result *= chainVal; break
        case '+': result += chainVal; break
        case '-': result -= chainVal; break
        case '/': result /= chainVal; break
      }
    }
  }

  const cleanResult = parseFloat(result.toPrecision(12))

  return {
    result: cleanResult,
    unit: resolvedUnit,
    expression: match[0].trim(),
    matchStart,
    matchLength,
  }
}

function parseQuickInput(
  input: string,
  substanceList: typeof substances
): { substanceName: string; substanceId: string; amount: string; unit: string | null; route: string | null; categories: string[]; mathResult: { result: number; unit: string; expression: string } | null } {
  const trimmed = input.trim()
  if (!trimmed) return { substanceName: '', substanceId: '', amount: '', unit: null, route: null, categories: [], mathResult: null }

  let extractedRoute: string | null = null
  let routeIndex = -1
  let routeLength = 0

  const lowerTrimmed = trimmed.toLowerCase()
  for (const { route, regex } of ROUTE_REGEXES) {
    const routeMatch = lowerTrimmed.match(regex)
    if (routeMatch && routeMatch.index !== undefined) {
      if (routeMatch[0].length > routeLength) {
        extractedRoute = ROUTE_ALIASES[route] || route
        routeIndex = routeMatch.index
        routeLength = routeMatch[0].length
      }
    }
  }

  let unitImpliedRoute: string | null = null

  let inputWithoutRoute = trimmed
  if (extractedRoute && routeIndex >= 0) {
    inputWithoutRoute = (trimmed.slice(0, routeIndex) + trimmed.slice(routeIndex + routeLength)).replace(/\s+/g, ' ').trim()
  }

  const mathEval = evaluateMathExpression(inputWithoutRoute)

  if (mathEval) {
    const beforeMath = inputWithoutRoute.slice(0, mathEval.matchStart).trim()
    const afterMath = inputWithoutRoute.slice(mathEval.matchStart + mathEval.matchLength).trim()
    const potentialSubstance = (beforeMath + ' ' + afterMath).replace(/\s+/g, ' ').trim()

    let substanceName = potentialSubstance
    let substanceId = ''
    let categories: string[] = []

    if (potentialSubstance) {
      const lower = potentialSubstance.toLowerCase()
      const exactMatch = substanceList.find(s =>
        s.name.toLowerCase() === lower ||
        s.commonNames?.some(cn => cn.toLowerCase() === lower) ||
        s.aliases?.some(a => a.toLowerCase() === lower)
      )

      if (exactMatch) {
        substanceName = exactMatch.name
        substanceId = exactMatch.id
        const raw = exactMatch as any
        categories = Array.isArray(raw.categories) && raw.categories.length > 0
          ? raw.categories
          : typeof raw.category === 'string' && raw.category && raw.category !== 'unknown'
            ? [raw.category]
            : []
      } else {
        const originalInputLower = inputWithoutRoute.toLowerCase()
        let candidates: { s: typeof substanceList[0]; score: number }[] = []

        for (const s of substanceList) {
          const nameLower = s.name.toLowerCase()
          let score = 0
          let matched = false

          if (nameLower.includes(lower) || lower.includes(nameLower)) {
            matched = true
            if (nameLower.includes(originalInputLower)) score += 100
            score += lower.length
          }
          if (!matched && s.commonNames?.some(cn => {
            const cnLower = cn.toLowerCase()
            if (cnLower.includes(lower) || lower.includes(cnLower)) {
              if (cnLower.includes(originalInputLower)) score += 100
              score += lower.length
              return true
            }
            return false
          })) { matched = true }
          if (!matched && s.aliases?.some(a => {
            const aLower = a.toLowerCase()
            if (aLower.includes(lower) || lower.includes(aLower)) {
              if (aLower.includes(originalInputLower)) score += 100
              score += lower.length
              return true
            }
            return false
          })) { matched = true }

          if (matched) candidates.push({ s, score })
        }

        candidates.sort((a, b) => b.score - a.score)

        if (candidates.length > 0) {
          const best = candidates[0].s
          substanceName = best.name
          substanceId = best.id
          const raw = best as any
          categories = Array.isArray(raw.categories) && raw.categories.length > 0
            ? raw.categories
            : typeof raw.category === 'string' && raw.category && raw.category !== 'unknown'
              ? [raw.category]
              : []
        }
      }
    }

    if (mathEval.unit && UNIT_TO_ROUTE[mathEval.unit]) {
      unitImpliedRoute = UNIT_TO_ROUTE[mathEval.unit]
    }

    const formattedResult = mathEval.result % 1 === 0 ? mathEval.result.toString() : mathEval.result.toFixed(1).replace(/\.0$/, '')

    return {
      substanceName,
      substanceId,
      amount: formattedResult,
      unit: mathEval.unit || null,
      route: extractedRoute || unitImpliedRoute,
      categories,
      mathResult: { result: mathEval.result, unit: mathEval.unit, expression: mathEval.expression },
    }
  }

  const fullInputLower = inputWithoutRoute.toLowerCase().trim()
  const fullExactMatch = substanceList.find(s =>
    s.name.toLowerCase() === fullInputLower ||
    s.commonNames?.some(cn => cn.toLowerCase() === fullInputLower) ||
    s.aliases?.some(a => a.toLowerCase() === fullInputLower)
  )
  if (fullExactMatch) {
    const raw = fullExactMatch as any
    const cats: string[] = Array.isArray(raw.categories) && raw.categories.length > 0
      ? raw.categories
      : typeof raw.category === 'string' && raw.category && raw.category !== 'unknown'
        ? [raw.category]
        : []
    return { substanceName: fullExactMatch.name, substanceId: fullExactMatch.id, amount: '', unit: null, route: extractedRoute, categories: cats, mathResult: null }
  }

  const amountWithUnitRegex = /(\d*\.?\d+)\s*([a-zA-Zμ]+)?/g

  let match
  let amountStr = ''
  let unitStr: string | null = null
  let amountIndex = -1
  let amountLength = 0

  while ((match = amountWithUnitRegex.exec(inputWithoutRoute)) !== null) {
    const num = match[1]
    const unit = match[2]

    if (num.length === 1 && !unit) continue

    amountStr = num
    unitStr = unit || null
    amountIndex = match.index
    amountLength = match[0].length
    break
  }

  if (!amountStr) {
    const found = substanceList.find(s =>
      s.name.toLowerCase() === inputWithoutRoute.toLowerCase() ||
      s.commonNames?.some(cn => cn.toLowerCase() === inputWithoutRoute.toLowerCase()) ||
      s.aliases?.some(a => a.toLowerCase() === inputWithoutRoute.toLowerCase())
    )
    if (found) {
      const raw = found as any
      const cats: string[] = Array.isArray(raw.categories) && raw.categories.length > 0
        ? raw.categories
        : typeof raw.category === 'string' && raw.category && raw.category !== 'unknown'
          ? [raw.category]
          : []
      return { substanceName: found.name, substanceId: found.id, amount: '', unit: null, route: extractedRoute, categories: cats, mathResult: null }
    }
    return { substanceName: inputWithoutRoute, substanceId: '', amount: '', unit: null, route: extractedRoute, categories: [], mathResult: null }
  }

  let resolvedUnit: string | null = null
  if (unitStr) {
    const lower = unitStr.toLowerCase()
    if (KNOWN_UNITS.includes(lower)) {
      resolvedUnit = lower
    } else if (UNIT_ALIASES[lower]) {
      resolvedUnit = UNIT_ALIASES[lower]
    } else {
      const fuzzyMatch = resolveUnitFuzzy(lower)
      if (fuzzyMatch) {
        resolvedUnit = fuzzyMatch
      } else {
        resolvedUnit = lower
      }
    }

    if (resolvedUnit && UNIT_TO_ROUTE[resolvedUnit]) {
      unitImpliedRoute = UNIT_TO_ROUTE[resolvedUnit]
    }
  }

  const beforeAmount = inputWithoutRoute.slice(0, amountIndex).trim()
  const afterAmount = inputWithoutRoute.slice(amountIndex + amountLength).trim()

  let potentialSubstance = (beforeAmount + ' ' + afterAmount).trim()

  let substanceName = potentialSubstance
  let substanceId = ''
  let categories: string[] = []

  if (potentialSubstance) {
    const lower = potentialSubstance.toLowerCase()

    const exactMatch = substanceList.find(s =>
      s.name.toLowerCase() === lower ||
      s.commonNames?.some(cn => cn.toLowerCase() === lower) ||
      s.aliases?.some(a => a.toLowerCase() === lower)
    )

    if (exactMatch) {
      substanceName = exactMatch.name
      substanceId = exactMatch.id
      const raw = exactMatch as any
      categories = Array.isArray(raw.categories) && raw.categories.length > 0
        ? raw.categories
        : typeof raw.category === 'string' && raw.category && raw.category !== 'unknown'
          ? [raw.category]
          : []
    } else {
      const originalInputLower = inputWithoutRoute.toLowerCase()
      let candidates: { s: typeof substanceList[0]; score: number }[] = []

      for (const s of substanceList) {
        const nameLower = s.name.toLowerCase()
        let score = 0
        let matched = false

        if (nameLower.includes(lower) || lower.includes(nameLower)) {
          matched = true
          if (nameLower.includes(originalInputLower)) score += 100
          score += lower.length
        }
        if (!matched && s.commonNames?.some(cn => {
          const cnLower = cn.toLowerCase()
          if (cnLower.includes(lower) || lower.includes(cnLower)) {
            if (cnLower.includes(originalInputLower)) score += 100
            score += lower.length
            return true
          }
          return false
        })) { matched = true }
        if (!matched && s.aliases?.some(a => {
          const aLower = a.toLowerCase()
          if (aLower.includes(lower) || lower.includes(aLower)) {
            if (aLower.includes(originalInputLower)) score += 100
            score += lower.length
            return true
          }
          return false
        })) { matched = true }

        if (matched) candidates.push({ s, score })
      }

      candidates.sort((a, b) => b.score - a.score)

      if (candidates.length > 0) {
        const best = candidates[0].s
        substanceName = best.name
        substanceId = best.id
        const raw = best as any
        categories = Array.isArray(raw.categories) && raw.categories.length > 0
          ? raw.categories
          : typeof raw.category === 'string' && raw.category && raw.category !== 'unknown'
            ? [raw.category]
            : []
      }
    }
  }

  return { substanceName, substanceId, amount: amountStr, unit: resolvedUnit, route: extractedRoute || unitImpliedRoute, categories, mathResult: null }
}

export function formatUnit(unit: string, amount: number): string {
  const invariantUnits = ['mg', 'g', 'μg', 'ml', 'mL']
  if (invariantUnits.includes(unit)) return unit

  const isSingular = amount === 1 || (amount > 0 && amount < 1)

  const pluralRules: Record<string, string> = {
    'drop': 'drops', 'puff': 'puffs', 'tab': 'tabs', 'capsule': 'capsules',
    'hit': 'hits', 'line': 'lines', 'drink': 'drinks', 'shot': 'shots',
    'joint': 'joints', 'blunt': 'blunts', 'bowl': 'bowls', 'blinker': 'blinkers',
  }
  const singularRules: Record<string, string> = Object.fromEntries(
    Object.entries(pluralRules).map(([sing, plur]) => [plur, sing])
  )

  if (isSingular && singularRules[unit]) return singularRules[unit]
  if (!isSingular && pluralRules[unit]) return pluralRules[unit]
  if (!isSingular && !pluralRules[unit] && !singularRules[unit]) return unit + 's'
  return unit
}

const EMPTY_DOSES: DoseLog[] = []

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

export function DoseLoggerModal({
  open: controlledOpen,
  onOpenChange,
  onLogCreated,
  trigger,
  preselectedSubstanceId,
  preselectedSubstanceName,
  preselectedCategory,
  preselectedRoute,
}: DoseLoggerModalProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen
  const dialogRef = useRef<HTMLDialogElement>(null)
  const isMobile = useMedia('(max-width: 767px)', false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open) {
      if (!dialog.open) {
        dialog.showModal()
      }
    } else {
      if (dialog.open) {
        dialog.close()
      }
    }
  }, [open])

  const handleClose = useCallback(() => {
    if (controlledOpen !== undefined) {
      onOpenChange?.(false)
    } else {
      setInternalOpen(false)
    }
  }, [controlledOpen, onOpenChange])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const handler = (e: MouseEvent) => {
      if (e.target === dialog) {
        handleClose()
      }
    }
    dialog.addEventListener('click', handler)
    return () => dialog.removeEventListener('click', handler)
  }, [handleClose])

  const [loading, setLoading] = useState(false)
  const doses = useDoseStore(s => open ? s.doses : EMPTY_DOSES)
  const addDose = useDoseStore(s => s.addDose)

  // A1 — favorites from UI store. initializeFavorites runs once on mount
  // to lazy-load from localStorage (avoids SSR hydration mismatch).
  const favoriteSubstances = useUIStore(s => s.favoriteSubstances)
  const toggleFavorite = useUIStore(s => s.toggleFavorite)
  const initializeFavorites = useUIStore(s => s.initializeFavorites)
  useEffect(() => { initializeFavorites() }, [initializeFavorites])

  // Medication profile — used for two things:
  //   1. The substance selector dropdown includes active medications
  //      (namespaced with `med-<uuid>`) so users can log a dose of their
  //      prescription directly without re-typing the name.
  //   2. The interaction-warning section checks the selected substance
  //      against active medications (not just against active doses) and
  //      surfaces a separate warning panel for medication interactions.
  const medications = useMedicationStore(s => s.medications)
  const initializeMedications = useMedicationStore(s => s.initialize)
  useEffect(() => { initializeMedications() }, [initializeMedications])
  const activeMedications = useMemo(() => medications.filter(m => m.isActive), [medications])

  // Custom substances from the custom-substance store. These are
  // user-defined substances that live in localStorage and are merged
  // with the built-in DB for the substance selector.
  const customSubstances = useCustomSubstanceStore(s => s.substances)
  const initializeCustomSubstances = useCustomSubstanceStore(s => s.initialize)
  useEffect(() => { initializeCustomSubstances() }, [initializeCustomSubstances])

  // Helper: merge built-in substances with custom substances so the
  // selector + interaction logic can reason about both uniformly.
  // Custom substances are tagged with a `[Custom]` prefix in the UI.
  const allSubstances = useMemo(() => {
    const customAsSubstance = customSubstances.map(cs => ({
      ...cs,
      id: cs.id,
      name: cs.name,
      commonNames: [] as string[],
      aliases: [] as string[],
      categories: [cs.category],
      class: cs.category,
      description: cs.description,
      effects: { positive: [], neutral: [], negative: [] },
      interactions: { dangerous: [], unsafe: [], uncertain: [], crossTolerances: [] },
      harmReduction: [],
      legality: 'unknown',
      chemistry: { formula: '', molecularWeight: '', class: cs.category },
      history: null,
      afterEffects: '',
      riskLevel: 'none',
      routeData: cs.routeData,
      routes: cs.routeData ? Object.keys(cs.routeData) : [],
    } as any))
    // De-duplicate by id (built-in wins if there's a collision).
    const builtinIds = new Set(substances.map(s => s.id))
    const merged = [...substances, ...customAsSubstance.filter(cs => !builtinIds.has(cs.id))]
    return merged
  }, [substances, customSubstances])

  const [quickInput, setQuickInput] = useState('')
  const [quickInputSubstanceQuery, setQuickInputSubstanceQuery] = useState('')
  const [mathResult, setMathResult] = useState<{ result: number; unit: string; expression: string } | null>(null)
  const quickInputRef = useRef<HTMLInputElement>(null)
  const [showQuickSuggestions, setShowQuickSuggestions] = useState(false)
  const [quickActiveIndex, setQuickActiveIndex] = useState(-1)

  const [substanceId, setSubstanceId] = useState(preselectedSubstanceId || '')
  const [substanceName, setSubstanceName] = useState(preselectedSubstanceName || '')
  const [categories, setCategories] = useState<string[]>(
    Array.isArray(preselectedCategory) ? preselectedCategory
      : preselectedCategory ? [preselectedCategory]
        : []
  )
  const [amount, setAmount] = useState('')
  const [unit, setUnit] = useState('mg')
  const [route, setRoute] = useState(preselectedRoute || 'oral')
  const [timestamp, setTimestamp] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"))
  const [timestampModified, setTimestampModified] = useState(false)
  const [notes, setNotes] = useState('')
  const [mood, setMood] = useState('')
  const [setting, setSetting] = useState('')
  const [intensity, setIntensity] = useState(5)
  const [isPlanDialogOpen, setIsPlanDialogOpen] = useState(false)
  // A5 — collapsible "Optional details" section. Default collapsed for
  // new logs so the mobile form is short. Auto-expands when the modal
  // opens with pre-existing optional data (e.g. editing a dose with a
  // mood set), and when the user manually toggles it.
  const [optionalOpen, setOptionalOpen] = useState(false)

  const [durationOverride, setDurationOverride] = useState<Duration | null>(null)

  useEffect(() => {
    if (preselectedSubstanceId) setSubstanceId(preselectedSubstanceId)
    if (preselectedSubstanceName) setSubstanceName(preselectedSubstanceName)
    if (preselectedSubstanceId) {
      const found = substances.find(s => s.id === preselectedSubstanceId)
      if (found) {
        const raw = found as any
        const cats: string[] = Array.isArray(raw.categories) && raw.categories.length > 0
          ? raw.categories
          : typeof raw.category === 'string' && raw.category && raw.category !== 'unknown'
            ? [raw.category]
            : []
        setCategories(cats)
      }
    } else if (preselectedCategory) {
      setCategories(Array.isArray(preselectedCategory) ? preselectedCategory : [preselectedCategory])
    }
    if (preselectedRoute) setRoute(preselectedRoute)
  }, [preselectedSubstanceId, preselectedSubstanceName, preselectedCategory, preselectedRoute])

  useEffect(() => {
    if (open) {
      setTimestamp(format(new Date(), "yyyy-MM-dd'T'HH:mm"))
      setTimestampModified(false)
      setQuickInput('')
      setMathResult(null)
      setShowQuickSuggestions(false)
      setQuickActiveIndex(-1)
      setDurationOverride(null)
      if (!preselectedSubstanceId) {
        setSubstanceId('')
        setSubstanceName('')
        setCategories([])
      }
      setAmount('')
      setUnit('mg')
      if (!preselectedRoute) setRoute('oral')
      setNotes('')
      setMood('')
      setSetting('')
      setIntensity(5)
      setOptionalOpen(false)
    }
  }, [open, preselectedSubstanceId, preselectedRoute])

  const handleQuickInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setQuickInput(value)

    const parsed = parseQuickInput(value, substances)

    const hasAmount = !!parsed.amount
    const queryForSuggestions = hasAmount ? parsed.substanceName : value
    setQuickInputSubstanceQuery(queryForSuggestions)
    setShowQuickSuggestions(!hasAmount || !parsed.substanceId)

    setMathResult(parsed.mathResult)

    if (parsed.substanceName) {
      setSubstanceName(parsed.substanceName)
      setSubstanceId(parsed.substanceId || `custom-${Date.now()}`)
      setCategories(parsed.categories)
    }
    if (parsed.amount) {
      setAmount(parsed.amount)
    }
    if (parsed.unit) {
      setUnit(parsed.unit)
    }
    if (parsed.route) {
      setRoute(parsed.route)
    }
  }, [])

  const handleQuickInputBlur = useCallback(() => {
    setTimeout(() => {
      setShowQuickSuggestions(false)
      setQuickActiveIndex(-1)
    }, 150)
  }, [])

  const selectQuickSuggestion = useCallback((sId: string, sName: string, cats: string[]) => {
    setSubstanceId(sId)
    setSubstanceName(sName)
    setCategories(cats)
    setQuickInput(sName)
    setShowQuickSuggestions(false)
    setQuickActiveIndex(-1)
    quickInputRef.current?.focus()
  }, [])

  const quickSuggestions = useMemo(() => {
    if (!quickInputSubstanceQuery.trim() || !showQuickSuggestions) return []
    return searchSubstancesRanked(quickInputSubstanceQuery, { limit: 6 })
  }, [quickInputSubstanceQuery, showQuickSuggestions])

  // A2: "log same as last time" — tapping a recent chip pre-fills the
  // substance, amount, unit, and route from the user's most recent log
  // of that substance. Falls back to substance-only if no amount/unit
  // was recorded.
  const selectRecentSubstance = useCallback((sub: {
    name: string
    id: string
    category: string
    amount?: string
    unit?: string
    route?: string
  }) => {
    setSubstanceId(sub.id)
    setSubstanceName(sub.name)
    setCategories(sub.category ? [sub.category] : [])
    setQuickInput(sub.name)
    if (sub.amount) setAmount(sub.amount)
    if (sub.unit) setUnit(sub.unit)
    if (sub.route) setRoute(sub.route)
    quickInputRef.current?.focus()
  }, [])

  const handleQuickInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (showQuickSuggestions && quickSuggestions.length > 0) {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setQuickActiveIndex(prev => prev < quickSuggestions.length - 1 ? prev + 1 : 0)
          return
        case 'ArrowUp':
          e.preventDefault()
          setQuickActiveIndex(prev => prev > 0 ? prev - 1 : quickSuggestions.length - 1)
          return
        case 'Tab':
          e.preventDefault()
          if (e.shiftKey) {
            setQuickActiveIndex(prev => prev > 0 ? prev - 1 : quickSuggestions.length - 1)
          } else {
            setQuickActiveIndex(prev => prev < quickSuggestions.length - 1 ? prev + 1 : 0)
          }
          return
        case 'Escape':
          e.preventDefault()
          setShowQuickSuggestions(false)
          setQuickActiveIndex(-1)
          return
        case 'Enter':
          if (quickActiveIndex >= 0) {
            e.preventDefault()
            const sel = quickSuggestions[quickActiveIndex]
            const raw = sel.substance as any
            const cats = Array.isArray(raw.categories) && raw.categories.length > 0
              ? raw.categories
              : typeof raw.category === 'string' && raw.category && raw.category !== 'unknown'
                ? [raw.category]
                : []
            selectQuickSuggestion(sel.substance.id, sel.substance.name, cats)
            return
          }
          if (substanceName && amount) return
          break
      }
    }
  }, [showQuickSuggestions, quickSuggestions, quickActiveIndex, substanceName, amount, selectQuickSuggestion])

  const selectedSubstance = useMemo(() => {
    // Built-in or custom substance (merged in allSubstances).
    const builtin = allSubstances.find(s => s.id === substanceId)
    if (builtin) return builtin
    // User medication (namespaced `med-<uuid>` selector ID). We
    // resolve these to Substance-shaped objects via the medication
    // store so downstream duration / classification / interaction
    // logic treats them like any other substance.
    if (isMedicationSelectorId(substanceId)) {
      return getMedicationsAsSubstances({ onlyActive: false })
        .find(s => s.id === substanceId) as any
    }
    return undefined
  }, [substanceId, allSubstances])

  const recentSubstances = useMemo(() => {
    // A2: include the last-dose amount/unit/route so the chip can
    // pre-fill all of them with a single tap ("log same as last time").
    const seen = new Map<string, {
      name: string
      id: string
      category: string
      amount?: string
      unit?: string
      route?: string
    }>()
    for (let i = doses.length - 1; i >= 0; i--) {
      const d = doses[i]
      if (d.substanceName && !seen.has(d.substanceName)) {
        seen.set(d.substanceName, {
          name: d.substanceName,
          id: d.substanceId || '',
          category: d.categories?.[0] || '',
          amount: d.amount != null ? String(d.amount) : undefined,
          unit: d.unit || undefined,
          route: d.route || undefined,
        })
      }
      if (seen.size >= 8) break
    }
    return Array.from(seen.values())
  }, [doses])

  useEffect(() => {
    setQuickActiveIndex(-1)
  }, [quickSuggestions.length])

  const estimatedDuration = useMemo(
    () => getDurationForRoute(selectedSubstance ?? null, route),
    [selectedSubstance, route]
  )

  const resolvedDuration: Duration | null = useMemo(() => {
    if (durationOverride) return durationOverride
    if (estimatedDuration) {
      const { isEstimated, sourceRoute, estimationNote, ...plain } = estimatedDuration
      return plain
    }
    return null
  }, [durationOverride, estimatedDuration])

  useEffect(() => {
    setDurationOverride(null)
  }, [substanceId, route])

  const activeDoses = useMemo(() => {
    return doses.filter(dose => {
      if (!dose.duration) return false
      const timings = calculatePhaseTimings(dose.duration)
      const status = getPhaseStatus(new Date(dose.timestamp), timings)
      return status.phase !== 'ended'
    })
  }, [doses])

  const interactingSubstances = useMemo(() => {
    if (!selectedSubstance) return []
    const interactions = new Set<string>()
    const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    const flatInteractions = (sub: any): string[] => {
      if (!sub?.interactions) return []
      return [
        ...(sub.interactions.dangerous || []),
        ...(sub.interactions.unsafe || []),
        ...(sub.interactions.uncertain || []),
      ]
    }

    const matchAny = (interactionList: string[], keywords: string[]): boolean => {
      const compiledRegexes: RegExp[] = []
      const shortKeywords: string[] = []
      for (const k of keywords) {
        if (k.length > 2) {
          try { compiledRegexes.push(new RegExp(`\\b${escapeRegExp(k)}\\b`, 'i')) }
          catch { /* skip invalid */ }
        } else {
          shortKeywords.push(k)
        }
      }

      return interactionList.some(i => {
        const lower = i.toLowerCase()
        return compiledRegexes.some(regex => regex.test(lower)) ||
          shortKeywords.some(k => lower.includes(k))
      })
    }

    for (const dose of activeDoses) {
      if (dose.substanceId === selectedSubstance.id) continue
      // Look up the active substance across built-in DB, custom
      // substances, AND user medications so old dose logs of meds
      // still resolve correctly.
      const activeSubstance = allSubstances.find(s => s.id === dose.substanceId || s.name === dose.substanceName)
        ?? (isMedicationSelectorId(dose.substanceId || '')
          ? getMedicationsAsSubstances({ onlyActive: false }).find(s => s.id === dose.substanceId) as any
          : undefined)

      if (!activeSubstance) {
        const activeNameLower = dose.substanceName.toLowerCase()
        const hits = matchAny(flatInteractions(selectedSubstance), [activeNameLower])
        if (hits) interactions.add(dose.substanceName)
        continue
      }

      const keywords = (sub: any) => [sub.name, sub.class, ...(sub.categories || []), ...(sub.commonNames || []), ...(sub.aliases || [])]
        .filter(Boolean).map((s: string) => s.toLowerCase()).filter((s: string) => s !== 'other' && s.length > 2)

      const activeKw = keywords(activeSubstance)
      const selectedKw = keywords(selectedSubstance)

      const fwd = matchAny(flatInteractions(selectedSubstance), activeKw)
      const rev = matchAny(flatInteractions(activeSubstance), selectedKw)

      if (fwd || rev) interactions.add(activeSubstance.name)
    }
    return Array.from(interactions)
  }, [selectedSubstance, activeDoses, allSubstances])

  /**
   * Medication-profile interaction check.
   *
   * Compares the currently selected substance against the user's
   * active medications from the medication profile. This is separate
   * from `interactingSubstances` (which only checks active doses) so
   * that medication warnings can be rendered in their own panel and
   * so we don't double-count a substance that's both an active dose
   * and an active medication.
   *
   * Implementation: we lean on the existing `checkInteractions`
   * engine by passing the selected substance ID plus every active
   * medication's namespaced ID, along with an `extraSubstances`
   * pool that lets the engine resolve `med-<uuid>` IDs. Pairs where
   * one side is a medication and the other is the selected substance
   * are surfaced as warnings.
   */
  const medicationInteractions = useMemo(() => {
    if (!selectedSubstance || activeMedications.length === 0) return []
    // Build the extras pool: every active medication as a Substance.
    const medSubstances = activeMedications.map(m =>
      // Re-derive from store helper so we always get the latest
      // linkedSubstanceId / medicationType without memo staleness.
      getMedicationsAsSubstances({ onlyActive: true }).find(s => s.id === toMedicationSelectorId(m.id))
    ).filter(Boolean) as NonNullable<ReturnType<typeof getMedicationsAsSubstances>[number]>[]

    if (medSubstances.length === 0) return []

    const selectedId = selectedSubstance.id
    const allIds = [selectedId, ...medSubstances.map(s => s.id)]

    // Use the shared engine. We pass the medSubstances as extras so
    // `med-<uuid>` IDs resolve correctly.
    const result = checkInteractionsEngine(allIds, medSubstances)

    return result.pairs.filter(p => p.severity !== 'low-risk')
  }, [selectedSubstance, activeMedications])

  /**
   * Substance selector options.
   *
   * Combines four sources, each tagged so the UI can render a badge:
   *   - Built-in substances (no tag — the default)
   *   - Custom substances from the custom-substance store (tagged `[Custom]`)
   *   - Active medications from the medication profile (namespaced
   *     with `med-<uuid>`, tagged `[Rx]`)
   *
   * The Combobox component doesn't natively support per-option badges,
   * so we encode the kind in the label: medications get a `[Rx]` prefix
   * and custom substances get a `[Custom]` prefix. The search box still
   * matches against the underlying name.
   */
  const substanceOptions: ComboboxOption[] = useMemo(() => {
    const builtinIds = new Set(substances.map(s => s.id))
    const opts: ComboboxOption[] = allSubstances.map(s => {
      const isCustom = !builtinIds.has(s.id)
      return {
        value: s.id,
        label: isCustom ? `[Custom] ${s.name}` : s.name,
        keywords: [s.name, ...(s.commonNames || []), ...(s.aliases || [])],
      }
    })

    // Append active medications as `med-<uuid>` options so users can
    // log a dose of their prescription directly. Skip medications
    // that are already represented by a linked built-in substance to
    // avoid clutter (the user can just pick the substance itself).
    for (const m of activeMedications) {
      // If the medication is linked to a built-in substance AND the
      // user hasn't renamed it, skip — the built-in entry already
      // covers this case.
      if (m.linkedSubstanceId && builtinIds.has(m.linkedSubstanceId) && m.name === allSubstances.find(s => s.id === m.linkedSubstanceId)?.name) {
        continue
      }
      const id = toMedicationSelectorId(m.id)
      const label = `[Rx] ${m.name}${m.dosage ? ` (${m.dosage})` : ''}`
      opts.push({
        value: id,
        label,
        keywords: [m.name, ...(m.genericName ? [m.genericName] : []), ...(m.medicationType ? [m.medicationType] : [])],
      })
    }

    return opts.sort((a, b) => a.label.localeCompare(b.label))
  }, [allSubstances, substances, activeMedications])

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    const parsed = parseAmountUnit(raw)
    setAmount(parsed.amount)
    if (parsed.unit) {
      setUnit(parsed.unit)
      if (UNIT_TO_ROUTE[parsed.unit]) {
        setRoute(UNIT_TO_ROUTE[parsed.unit])
      }
    }
  }

  const handleSubmit = async () => {
    if (!substanceName || !amount) {
      toast({ title: 'Missing fields', description: 'Please select a substance and enter an amount', variant: 'destructive' })
      return
    }
    setLoading(true)
    await new Promise(resolve => setTimeout(resolve, 200))

    try {
      const now = new Date().toISOString()

      let finalNotes = notes || null
      if (!durationOverride && estimatedDuration?.isEstimated) {
        const disclaimer = `[Duration estimated from ${estimatedDuration.sourceRoute} route data — verify before relying on timeline]`
        finalNotes = notes ? `${notes}\n${disclaimer}` : disclaimer
      }

      const usingEstimate = !durationOverride && !!estimatedDuration?.isEstimated

      const newLog: DoseLog = {
        id: `dose_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        substanceId: substanceId || `custom-${Date.now()}`,
        substanceName,
        categories,
        amount: parseFloat(amount),
        unit,
        route,
        timestamp: timestampModified ? new Date(timestamp).toISOString() : new Date().toISOString(),
        duration: resolvedDuration,
        durationIsEstimated: usingEstimate || undefined,
        durationSourceRoute: usingEstimate ? estimatedDuration?.sourceRoute : undefined,
        notes: finalNotes,
        mood: mood || null,
        setting: setting || null,
        intensity,
        createdAt: now,
        updatedAt: now,
      }

      addDose(newLog)

      toast({
        title: 'Dose logged',
        description: `${amount} ${formatUnit(unit, parseFloat(amount))} of ${substanceName}${estimatedDuration?.isEstimated && !durationOverride ? ' (estimated timeline)' : ''}`,
      })

      try {
        const reminderStore = useReminderStore.getState()
        const matchingSchedule = reminderStore.schedules.find(
          s => s.enabled && s.substanceName.toLowerCase() === substanceName.toLowerCase()
        )
        if (matchingSchedule && reminderStore.autoStartEnabled) {
          toast({
            title: 'Reminder started',
            description: `${formatIntervalMinutes(matchingSchedule.intervalMinutes)} timer started for ${substanceName}`,
          })
        }
      } catch {
        // Reminder store may not be available — skip
      }

      handleClose()
      resetForm()
      onLogCreated?.()
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to log dose', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setQuickInput('')
    setMathResult(null)
    setShowQuickSuggestions(false)
    setQuickActiveIndex(-1)
    if (!preselectedSubstanceId) {
      setSubstanceId('')
      setSubstanceName('')
      setCategories([])
    }
    setAmount('')
    setUnit('mg')
    if (!preselectedRoute) setRoute('oral')
    setTimestamp(format(new Date(), "yyyy-MM-dd'T'HH:mm"))
    setTimestampModified(false)
    setNotes('')
    setMood('')
    setSetting('')
    setIntensity(5)
    setDurationOverride(null)
  }

  const handleSubstanceChange = (value: string) => {
    // Selected a user medication from the dropdown (namespaced ID).
    // Resolve it via the medication store so we can pull the user's
    // custom dosage / route defaults into the form.
    if (isMedicationSelectorId(value)) {
      const med = getMedicationBySelectorId(value)
      if (med) {
        // Use the medication's UUID-namespaced selector ID as the
        // substanceId so the rest of the modal can resolve it back
        // to the medication via getMedicationsAsSubstances().
        setSubstanceId(value)
        setSubstanceName(med.name)
        setCategories(['medications'])
        // Pre-fill route from the medication's route if it's a known
        // route (the route combobox accepts arbitrary strings).
        if (med.route) setRoute(med.route)
        // Pre-fill amount+unit by parsing the medication's dosage
        // string (e.g. "20mg" → amount="20", unit="mg"). If parsing
        // fails we leave amount/unit untouched.
        if (med.dosage) {
          const parsed = parseAmountUnit(med.dosage)
          if (parsed.amount) setAmount(parsed.amount)
          if (parsed.unit) setUnit(parsed.unit)
        }
        setDurationOverride(null)
        return
      }
      // Fallback: unknown med ID — treat as a custom-typed entry.
      setSubstanceId(value)
      setSubstanceName(value)
      setCategories([])
      setDurationOverride(null)
      return
    }

    // Built-in or custom substance.
    const found = allSubstances.find(s => s.id === value)
    if (found) {
      setSubstanceId(found.id)
      setSubstanceName(found.name)
      const raw = found as any
      const cats: string[] = Array.isArray(raw.categories) && raw.categories.length > 0
        ? raw.categories
        : typeof raw.category === 'string' && raw.category && raw.category !== 'unknown'
          ? [raw.category]
          : []
      setCategories(cats)

      // If the newly selected substance doesn't have data for the current
      // route, switch to its first known route. This matters most for custom
      // substances: the modal defaults to "oral", but a user may have created
      // only an "insufflation"/"inhalation" route with complete duration data.
      // Leaving the stale route selected makes the duration layer interpolate
      // from the user's route data and show an estimated-duration warning.
      const routeKeys = raw.routeData ? Object.keys(raw.routeData) : []
      if (routeKeys.length > 0) {
        const currentNorm = normaliseRoute(route)
        const hasCurrentRoute = routeKeys.some((routeKey) =>
          routeKey === route || (currentNorm !== null && normaliseRoute(routeKey) === currentNorm),
        )
        if (!hasCurrentRoute) setRoute(routeKeys[0])
      }
    } else {
      setSubstanceId(value)
      setSubstanceName(value)
      setCategories([])
    }
    setDurationOverride(null)
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    handleSubmit()
  }

  // Use BottomSheet on mobile, dialog on desktop
  const renderModal = () => {
    if (!mounted) {
      return null
    }
    if (isMobile) {
      return (
        <BottomSheet
          open={open}
          onClose={handleClose}
          title="Log a Dose"
          description="Record your substance use for tracking and harm reduction purposes."
          showDragHandle={true}
          maxHeight="85dvh"
          footer={renderFormActions()}
        >
          {renderFormContent()}
        </BottomSheet>
      )
    }

    // Desktop: centered dialog
    return (
      <dialog
        ref={dialogRef}
        className="modal"
        onClose={handleClose}
      >
        <form onSubmit={onSubmit}>
          <div className="modal-box max-sm:pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] max-w-[500px]">
            <button
              type="button"
              aria-label="Close"
              className="btn btn-circle btn-ghost tap-sm absolute right-3 top-3 h-8 w-8 min-h-0 p-0"
              onClick={handleClose}
            >
              <X className="h-4 w-4" />
            </button>

            <div className="mb-4">
              <h3 className="text-lg font-semibold leading-none">Log a Dose</h3>
              <p className="text-sm text-neutral-content mt-1">
                Record your substance use for tracking and harm reduction purposes.
              </p>
            </div>

            {renderFormContent()}
            {renderFormActions()}
          </div>
        </form>
        <form method="dialog" className="modal-backdrop">
          <button type="button" onClick={handleClose}>close</button>
        </form>
      </dialog>
    )
  }

  if (trigger) {
    return (
      <>
        <button
          type="button"
          onClick={() => {
            if (controlledOpen !== undefined) {
              onOpenChange?.(true)
            } else {
              setInternalOpen(true)
            }
          }}
          className="inline-flex"
        >
          {trigger}
        </button>
        {renderModal()}
      </>
    )
  }

  return renderModal()

  function renderFormContent() {
    return (
      <div className="grid gap-4 py-2">
        {/* ── Quick Input Section ────────────────────────────────────── */}
        <div className="grid gap-2">
          <Label className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-yellow-500" />
            Quick Input
          </Label>

          {/* A1 — Pinned favorites row. Rendered above recents so the
                user's most-used substances are always one tap away. */}
          {favoriteSubstances.length > 0 && !quickInput && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <Pin className="h-3 w-3 text-amber-500/80 shrink-0" />
              <span className="text-[11px] text-neutral-content/60">Pinned:</span>
              {favoriteSubstances.map(sub => {
                // Look up the last-dose details so favorites also
                // benefit from A2's "log same as last time" behavior.
                const lastDose = recentSubstances.find(
                  (r) => r.id === sub.id || r.name.toLowerCase() === sub.name.toLowerCase(),
                )
                return (
                  <div
                    key={sub.id || sub.name}
                    className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => selectRecentSubstance({
                        name: sub.name,
                        id: sub.id,
                        category: sub.category || lastDose?.category || '',
                        amount: lastDose?.amount,
                        unit: lastDose?.unit,
                        route: lastDose?.route,
                      })}
                      className="tap-sm inline-flex items-center gap-1 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300 min-h-0 min-h-[44px]"
                    >
                      {sub.category && (
                        <span className={`w-1.5 h-1.5 rounded-full ${CATEGORY_DOTS[sub.category] || 'bg-zinc-500'}`} />
                      )}
                      {sub.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleFavorite(sub)}
                      className="tap-sm h-5 w-5 inline-flex items-center justify-center text-amber-600/70 hover:text-amber-700 dark:text-amber-400/70 dark:hover:text-amber-300 transition-colors min-h-0 min-h-[44px] min-w-[44px]"
                      aria-label={`Unpin ${sub.name}`}
                      title={`Unpin ${sub.name}`}
                    >
                      <PinOff className="h-3 w-3" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {recentSubstances.length > 0 && !quickInput && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <Clock className="h-3 w-3 text-neutral-content/60 shrink-0" />
              <span className="text-[11px] text-neutral-content/60">Recent:</span>
              {recentSubstances.map(sub => {
                const isFav = favoriteSubstances.some(
                  (f) => f.id === sub.id || f.name.toLowerCase() === sub.name.toLowerCase(),
                )
                return (
                  <div
                    key={sub.id || sub.name}
                    className={cn(
                      'inline-flex items-center gap-0.5 rounded-full border transition-colors',
                      isFav
                        ? 'bg-amber-500/5 border-amber-500/20'
                        : 'bg-base-200 border-transparent hover:bg-base-300',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => selectRecentSubstance(sub)}
                      className="tap-sm inline-flex items-center gap-1 px-2 py-0.5 text-xs text-base-content/80 hover:text-base-content min-h-0 min-h-[44px]"
                      title={
                        sub.amount && sub.unit
                          ? `Log ${sub.amount} ${sub.unit} ${sub.name} (${sub.route || 'oral'})`
                          : `Select ${sub.name}`
                      }
                    >
                      {sub.category && (
                        <span className={`w-1.5 h-1.5 rounded-full ${CATEGORY_DOTS[sub.category] || 'bg-zinc-500'}`} />
                      )}
                      {sub.name}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        toggleFavorite({
                          id: sub.id || `custom-${sub.name.toLowerCase().replace(/\s+/g, '-')}`,
                          name: sub.name,
                          category: sub.category || undefined,
                        })
                      }
                      className={cn(
                        'tap-sm h-5 w-5 inline-flex items-center justify-center transition-colors min-h-0 min-h-[44px] min-w-[44px]',
                        isFav
                          ? 'text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300'
                          : 'text-neutral-content/40 hover:text-amber-600 dark:hover:text-amber-400',
                      )}
                      aria-label={isFav ? `Unpin ${sub.name}` : `Pin ${sub.name}`}
                      title={isFav ? `Unpin ${sub.name}` : `Pin ${sub.name}`}
                    >
                      {isFav ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          <div className="relative">
            <Input
              ref={quickInputRef}
              type="text"
              placeholder='e.g. "1 tab LSD", "100mg MDMA", "15 pills * 15mg DXM"'
              value={quickInput}
              onChange={handleQuickInputChange}
              onFocus={() => setShowQuickSuggestions(true)}
              onBlur={handleQuickInputBlur}
              onKeyDown={handleQuickInputKeyDown}
              className="text-base"
            />

            <AnimatePresence>
              {showQuickSuggestions && quickSuggestions.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.1 }}
                  className="absolute z-50 top-full mt-1 w-full rounded-lg border border-base-300 bg-base-100 shadow-xl overflow-hidden"
                >
                  <div className="max-h-64 overflow-y-auto p-1">
                    {quickSuggestions.map((result, idx) => {
                      const sub = result.substance
                      const isActive = idx === quickActiveIndex
                      return (
                        <button
                          key={sub.id}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault()
                            const raw = sub as any
                            const cats = Array.isArray(raw.categories) && raw.categories.length > 0
                              ? raw.categories
                              : typeof raw.category === 'string' && raw.category && raw.category !== 'unknown'
                                ? [raw.category]
                                : []
                            selectQuickSuggestion(sub.id, sub.name, cats)
                          }}
                          onMouseEnter={() => setQuickActiveIndex(idx)}
                          className={`tap-sm flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-sm text-left transition-colors min-h-0 ${isActive ? 'bg-accent text-accent-content' : 'hover:bg-accent/50'}`}
                        >
                          <span className={`w-2 h-2 rounded-full shrink-0 ${CATEGORY_DOTS[sub.categories[0]] || 'bg-zinc-500'}`} />
                          <span className="truncate font-medium">{sub.name}</span>
                          <span className="text-xs text-neutral-content truncate ml-auto">{sub.class}</span>
                        </button>
                      )
                    })}
                  </div>
                  <div className="px-2.5 py-1.5 border-t border-base-300 text-xs text-neutral-content flex items-center justify-between">
                    <span>{quickSuggestions.length} result{quickSuggestions.length !== 1 ? 's' : ''}</span>
                    <span className="hidden sm:inline">
                      <kbd className="px-1 py-0.5 rounded bg-base-200 border border-base-300 text-[10px] font-mono">&uarr;&darr;</kbd>
                      {' / '}
                      <kbd className="px-1 py-0.5 rounded bg-base-200 border border-base-300 text-[10px] font-mono">Tab</kbd>
                      {' '}navigate{' '}
                      <kbd className="px-1 py-0.5 rounded bg-base-200 border border-base-300 text-[10px] font-mono">&crarr;</kbd>
                      {' '}select
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {quickInput && (substanceName || amount) && (
            <div className="flex items-center gap-1.5 flex-wrap min-h-[24px]">
              {substanceName && (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-full bg-primary/10 text-primary border border-primary/20">
                  {categories[0] && (
                    <span className={`w-1.5 h-1.5 rounded-full ${CATEGORY_DOTS[categories[0]] || 'bg-zinc-500'}`} />
                  )}
                  {substanceName}
                </span>
              )}
              {amount && unit && (
                <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                  {amount} {unit}
                </span>
              )}
              {!amount && unit && (
                <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                  {unit}
                </span>
              )}
              {route && (
                <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                  {route}
                </span>
              )}
            </div>
          )}

          <p className="text-xs text-neutral-content">
            Type substance + amount + unit (+ optional route). Supports math: &quot;5 pills * 10mg THC&quot;
          </p>
        </div>

        {mathResult && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/25">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500/20 shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-emerald-500">
                <rect width="8" height="8" x="8" y="8" rx="1" />
                <path d="M6 10H2v4h4" />
                <path d="M18 10h4v4h-4" />
                <path d="M10 6V2h4v4" />
                <path d="M10 18v4h4v-4" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                Calculation: {mathResult.expression}
              </p>
              <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                = {mathResult.result} {mathResult.unit}
              </p>
            </div>
          </div>
        )}

        {quickInput && (substanceName || amount) && (
          <div className="flex items-center gap-2 text-xs text-neutral-content">
            <div className="h-px flex-1 bg-border" />
            <span>Auto-filled from quick input</span>
            <div className="h-px flex-1 bg-border" />
          </div>
        )}

        <div className="grid gap-2">
          <Label>Substance</Label>
          <Combobox
            options={substanceOptions}
            value={substanceId}
            onChange={handleSubstanceChange}
            placeholder="Select from list or type custom..."
            allowCustom={true}
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-content">
            <span>Select from list or type a custom substance</span>
            {activeMedications.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <Pill className="w-3 h-3" />
                <code className="px-1 py-0.5 rounded bg-base-200 text-[10px]">[Rx]</code>
                = your medication ({activeMedications.length})
              </span>
            )}
          </div>
        </div>

        {interactingSubstances.length > 0 && (
          <Alert variant="destructive" className="bg-error/10 text-error border-error/20">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Potential Interaction Warning</AlertTitle>
            <AlertDescription>
              This substance may interact with your currently active dose(s) of: <strong>{interactingSubstances.join(', ')}</strong>.
              Please exercise caution and research potential interactions.
            </AlertDescription>
          </Alert>
        )}

        {/* Medication-profile interaction warnings.
              These are separate from active-dose warnings above so the
              user can tell "I just took X" warnings apart from "I'm
              prescribed Y" warnings. Rendered as a list because a user
              may be on multiple medications and each pair can have its
              own severity / description. */}
        {medicationInteractions.length > 0 && (
          <Alert variant="destructive" className="bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30">
            <div className="flex items-start gap-2">
              <Pill className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <AlertTitle className="text-amber-800 dark:text-amber-200">
                  Medication Interaction Warning
                </AlertTitle>
                <AlertDescription className="space-y-1.5">
                  <p>
                    This substance interacts with {medicationInteractions.length === 1 ? 'an active medication' : `${medicationInteractions.length} active medications`} in your <a href="/medications" className="underline font-medium">medication profile</a>:
                  </p>
                  <ul className="space-y-1.5 mt-1">
                    {medicationInteractions.map((pair, idx) => {
                      // Determine which side of the pair is the
                      // medication (the side whose name matches one
                      // of the user's active medications).
                      const med = activeMedications.find(m =>
                        pair.substanceA.toLowerCase() === m.name.toLowerCase() ||
                        (m.genericName && pair.substanceA.toLowerCase() === m.genericName.toLowerCase())
                      ) || activeMedications.find(m =>
                        pair.substanceB.toLowerCase() === m.name.toLowerCase() ||
                        (m.genericName && pair.substanceB.toLowerCase() === m.genericName.toLowerCase())
                      )
                      const otherName = med
                        ? (pair.substanceA.toLowerCase() === med.name.toLowerCase() || (med.genericName && pair.substanceA.toLowerCase() === med.genericName.toLowerCase()) ? pair.substanceB : pair.substanceA)
                        : `${pair.substanceA} + ${pair.substanceB}`
                      const sevColor =
                        pair.severity === 'dangerous' ? 'text-red-600 dark:text-red-400'
                          : pair.severity === 'unsafe' ? 'text-orange-600 dark:text-orange-400'
                            : 'text-amber-600 dark:text-amber-400'
                      const sevLabel = pair.severity === 'dangerous' ? 'DANGEROUS'
                        : pair.severity === 'unsafe' ? 'Unsafe'
                          : 'Caution'
                      return (
                        <li key={idx} className="text-xs flex items-start gap-2">
                          <span className={`font-semibold uppercase shrink-0 ${sevColor}`}>{sevLabel}:</span>
                          <span className="flex-1">
                            <strong>{med?.name || '?'}</strong>
                            {med?.medicationType && <span className="opacity-70"> ({med.medicationType})</span>}
                            {' × '}
                            <strong>{otherName}</strong>
                            {pair.description && (
                              <span className="block opacity-80 mt-0.5">{pair.description}</span>
                            )}
                            {pair.sources.length > 0 && (
                              <span className="block opacity-50 mt-0.5">Source: {pair.sources.join(', ')}</span>
                            )}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </AlertDescription>
              </div>
            </div>
          </Alert>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <div className="grid gap-2">
            <Label>Amount</Label>
            <Input
              type="text"
              inputMode="decimal"
              step="0.1"
              placeholder="e.g., 100 or 5 mg"
              value={amount}
              onChange={handleAmountChange}
              className="text-base"
            />
            <p className="text-xs text-neutral-content">Type a unit after the amount (e.g. &quot;5 mg&quot;, &quot;100μg&quot;) to auto-select it</p>
          </div>
          <div className="grid gap-2">
            <Label>Unit</Label>
            <Combobox
              options={unitOptions}
              value={unit}
              onChange={setUnit}
              placeholder="Select or type custom..."
              allowCustom={true}
            />
          </div>
        </div>

        {selectedSubstance?.id === "alcohol" && (unit === "shot" || unit === "drink") && (
          <AlcoholCalculatorFields
            amount={amount}
            onAmountChange={setAmount}
            onUnitChange={setUnit}
          />
        )}

        <div className="grid gap-2">
          <Label>Route of Administration</Label>
          <Combobox
            options={selectedSubstance?.routeData
              ? Object.keys(selectedSubstance.routeData).map(r => ({ value: r, label: r }))
              : defaultRouteOptions}
            value={route}
            onChange={setRoute}
            placeholder="Select or type custom..."
            allowCustom
          />
          <p className="text-xs text-neutral-content">Type a custom route if needed</p>
        </div>

        <div className="grid gap-2">
          <Label>Date &amp; Time</Label>
          <Input
            type="datetime-local"
            value={timestamp}
            onChange={(e) => {
              setTimestamp(e.target.value)
              setTimestampModified(true)
            }}
            className="text-base"
          />
        </div>

        {/* A5 — Optional details collapsed by default.
              The mobile form was getting long (5+ Comboboxes + a textarea
              + a range slider). Hiding the optional stuff behind a single
              disclosure keeps the "log a dose" flow short for the common
              case where the user just wants to record substance+amount+route+time.
              Count of filled optional fields is shown in the trigger so the
              user can see at a glance whether they've already filled anything in. */}
        <div className="rounded-lg border border-base-300/60 overflow-hidden">
          <button
            type="button"
            onClick={() => setOptionalOpen((v) => !v)}
            aria-expanded={optionalOpen}
            className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium hover:bg-base-200/50 transition-colors text-left"
          >
            <span className="flex items-center gap-2">
              <span className="text-neutral-content">Optional details</span>
              {(() => {
                const filledCount = [
                  !!mood,
                  !!setting,
                  intensity !== 5,
                  !!notes.trim(),
                  !!durationOverride,
                ].filter(Boolean).length
                if (filledCount === 0) return null
                return (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium tabular-nums">
                    {filledCount} filled
                  </span>
                )
              })()}
            </span>
            {optionalOpen
              ? <ChevronUp className="h-4 w-4 text-neutral-content shrink-0" />
              : <ChevronDown className="h-4 w-4 text-neutral-content shrink-0" />}
          </button>

          {optionalOpen && (
            <div className="px-3 pb-3 pt-1 grid gap-4">
              <div className="grid gap-2 rounded-lg border border-base-300/60 bg-base-200/20 p-3">
                <DurationOverrideFields
                  baseDuration={estimatedDuration}
                  onChange={setDurationOverride}
                />
              </div>

              <div className="grid gap-2">
                <Label>Mood (optional)</Label>
                <Combobox
                  options={moodOptions}
                  value={mood}
                  onChange={setMood}
                  placeholder="Select or type custom..."
                  allowCustom={true}
                />
              </div>

              <div className="grid gap-2">
                <Label>Setting (optional)</Label>
                <Combobox
                  options={settingOptions}
                  value={setting}
                  onChange={setSetting}
                  placeholder="Select or type custom..."
                  allowCustom={true}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="dose-intensity" className="flex items-center justify-between">
                  <span>Intensity (optional)</span>
                  <span className="text-xs text-neutral-content tabular-nums">{intensity}/10</span>
                </Label>
                <input
                  id="dose-intensity"
                  type="range"
                  min={0}
                  max={10}
                  step={1}
                  value={intensity}
                  onChange={(e) => setIntensity(Number(e.target.value))}
                  className="range range-xs range-primary"
                  aria-valuemin={0}
                  aria-valuemax={10}
                  aria-valuenow={intensity}
                />
                <div className="flex justify-between text-[10px] text-neutral-content/70 px-0.5">
                  <span>None</span>
                  <span>Mild</span>
                  <span>Moderate</span>
                  <span>Strong</span>
                  <span>Peak</span>
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Notes (optional)</Label>
                <Textarea
                  placeholder="Any additional notes about this experience..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={isMobile ? 2 : 3}
                  className="text-base"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  function renderFormActions() {
    return (
      <div className="flex flex-col sm:flex-row gap-2 justify-end mt-4 pt-4 border-t border-base-300">
        <Button type="button" variant="outline" onClick={handleClose} className="w-full sm:w-auto">
          Cancel
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!substanceName || !amount || parseFloat(amount) <= 0}
          onClick={() => setIsPlanDialogOpen(true)}
          className="w-full sm:w-auto gap-2"
        >
          <CalendarDays className="h-4 w-4" />
          Plan redoses
        </Button>
        {/*
          type="button" + onClick={handleSubmit} instead of type="submit".
          On mobile the footer is rendered by <BottomSheet> OUTSIDE any
          <form>, so a submit button has nothing to submit and silently
          does nothing. Calling handleSubmit directly works in both the
          mobile BottomSheet layout and the desktop <form> layout. The
          desktop <form onSubmit={onSubmit}> wrapper still handles
          Enter-key submission from text inputs.
        */}
        <Button type="button" disabled={loading} onClick={handleSubmit} className="w-full sm:w-auto">
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Log Dose
        </Button>
      </div>
    )
  }
}
