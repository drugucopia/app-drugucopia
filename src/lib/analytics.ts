/**
 * Analytics computation utilities for the /analytics dashboard.
 *
 * Pure functions over DoseLog[] — no React, no store coupling.
 * All chart-shaped outputs are designed to be fed straight into Recharts.
 */

import { DoseLog } from "@/types";
import {
  substances as ALL_SUBSTANCES,
  type Substance,
  type RouteDosageDuration,
} from "@/lib/substances/index";
import {
  format,
  subDays,
  startOfDay,
  endOfDay,
  isWithinInterval,
  eachDayOfInterval,
  eachWeekOfInterval,
  eachMonthOfInterval,
  differenceInCalendarDays,
  parseISO,
} from "date-fns";
import { X509Certificate } from "crypto";

// ─── Shared helpers ─────────────────────────────────────────────────────────

/** Returns a Date object guaranteed valid (defaults to epoch on bad input). */
function safeDate(s: string): Date {
  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

/**
 * Tolerance decay half-lives (in days), sourced from PsychonautWiki.
 *
 * Each value is the time for *tolerance* (not the drug itself) to reduce to
 * 50% — i.e. receptor downregulation / tachyphylaxis recovery. Values are
 * extracted directly from the PsychonautWiki harm-reduction text in each
 * substance's data file (the `harmReduction` array).
 *
 * When PW states 'X days to half, Y days to baseline', we use the midpoint
 * of the half-life range. When PW only states 'Y days to baseline', we derive
 * half-life = baseline / 2 (PW 'baseline' ≈ 2 half-lives, verified across
 * multiple substances: amphetamine 5d/10.5d=2.1x, cannabis 10.5d/17.5d=1.7x,
 * MDMA 30d/75d=2.5x).
 *
 * Tolerance recovery is highly individual; these are point estimates for a
 * heuristic model, not a pharmacokinetic model.
 */
const TOLERANCE_HALF_LIVES_DAYS: Record<string, number> = {
  // ── Stimulants (dopaminergic) ──
  "2-aminoindane": 5,
  "2-fa": 5,
  "2-fma": 5,
  "3-fa": 5,
  "3-fpm": 5,
  "4f-eph": 5,
  "a-php": 5,
  "a-pvp": 5,
  adrafinil: 5,
  amphetamine: 5,
  armodafinil: 5,
  caffeine: 5,
  cocaine: 5,
  cyclazodone: 5,
  desoxypipradrol: 5,
  dichloropane: 3,
  "eth-cat": 2,
  ethylone: 5,
  ethylphenidate: 5,
  hexedrone: 5,
  isopropylphenidate: 5,
  kratom: 5,
  methamphetamine: 5,
  methiopropamine: 5,
  mexedrone: 5,
  modafinil: 5,
  "n-ethylhexedrone": 5,
  "n-methylbisfluoromodafinil": 5,
  nep: 5,
  "nm-2-ai": 5,
  oxiracetam: 5,
  pentedrone: 5,
  phenylpiracetam: 5,
  propylhexedrine: 5,
  theacrine: 5,
  tyrosine: 7,

  // ── Empathogens / Entactogens ──
  "2-fea": 5,
  "3-fea": 2,
  "3-fma": 5,
  "3-mmc": 5,
  "4-fa": 5,
  "4-fma": 5,
  "5-apb": 5,
  "5-mapb": 5,
  "6-apdb": 26,
  butylone: 5,
  mdai: 5,
  mdea: 38,
  mdma: 30,
  mephedrone: 5,
  methylone: 14,

  // ── Depressants (GABAergic) ──
  "1-4-butanediol": 5,
  "2m2b": 5,
  alcohol: 5,
  alprazolam: 5,
  baclofen: 5,
  clonazepam: 5,
  clonazolam: 5,
  deschloroetizolam: 5,
  diazepam: 5,
  diclazepam: 2,
  eszopiclone: 5,
  etizolam: 5,
  "f-phenibut": 5,
  flualprazolam: 5,
  flubromazepam: 5,
  flubromazolam: 5,
  flunitrazepam: 5,
  flunitrazolam: 5,
  gabapentin: 5,
  gbl: 5,
  ghb: 5,
  lorazepam: 5,
  methaqualone: 5,
  metizolam: 5,
  nicotine: 0.5,
  nifoxipam: 5,
  phenibut: 5,
  pregabalin: 5,
  pyrazolam: 5,
  temazepam: 5,
  zopiclone: 5,

  // ── Opioids (mu-receptor) ──
  acetylfentanyl: 5,
  codeine: 5,
  dextropropoxyphene: 5,
  dihydrocodeine: 5,
  ethylmorphine: 5,
  fentanyl: 5,
  heroin: 5,
  hydrocodone: 5,
  methadone: 5,
  "o-desmethyltramadol": 5,
  oxycodone: 5,
  pethidine: 5,
  tapentadol: 5,
  tramadol: 5,
  "u-47700": 5,

  // ── Dissociatives (NMDA antagonist) ──
  "2-fluorodeschloroketamine": 5,
  "3-ho-pce": 6,
  "3-ho-pcp": 6,
  "3-meo-pce": 5,
  "3-meo-pcmo": 5,
  "3-meo-pcp": 5,
  "4-meo-pcp": 5,
  deschloroketamine: 5,
  dextromethorphan: 5,
  diphenidine: 5,
  ephenidine: 5,
  hxe: 5,
  methoxetamine: 5,
  methoxphenidine: 5,
  mxipr: 5,
  nitrous: 5,
  "o-pce": 5,
  pce: 5,
  pcp: 5,

  // ── Cannabinoids (CB1) ──
  "5f-akb48": 5,
  "5f-pb-22": 5,
  "ab-fubinaca": 5,
  apica: 5,
  cannabis: 10,
  "jwh-018": 5,
  "jwh-073": 5,
  "thj-018": 5,
  "thj-2201": 5,

  // ── Hallucinogens (5-HT2A) ──
  "1b-lsd": 6,
  "1cp-al-lad": 6,
  "1cp-lsd": 6,
  "1cp-mipla": 6,
  "1p-eth-lad": 3,
  "1p-lsd": 6,
  "1v-lsd": 6,
  "2-5-dma": 4,
  "25b-nbome": 7,
  "25c-nboh": 7,
  "25c-nbome": 7,
  "25i-nboh": 7,
  "2c-b-fly": 3,
  "2c-d": 3,
  "2c-e": 2,
  "2c-i": 4,
  "2c-p": 3,
  "2c-t": 3,
  "2c-t-2": 3,
  "2c-t-21": 3,
  "2c-t-7": 3,
  "3c-e": 3,
  "3c-p": 3,
  "4-aco-det": 3,
  "4-aco-dipt": 3,
  "4-aco-dmt": 4,
  "4-aco-met": 3,
  "4-aco-mipt": 3,
  "4-ho-det": 3,
  "4-ho-dipt": 3,
  "4-ho-dpt": 3,
  "4-ho-ept": 3,
  "4-ho-met": 3,
  "4-ho-mipt": 3,
  "4-ho-mpt": 3,
  "5-meo-dalt": 3,
  "5-meo-dibf": 3,
  "5-meo-dipt": 3,
  "5-meo-dmt": 0.5,
  "5-meo-mipt": 3,
  "6-apb": 24,
  "al-lad": 6,
  "ald-52": 6,
  allylescaline: 3,
  bufotenin: 0.5,
  det: 3,
  dipt: 3,
  dob: 6,
  doc: 3,
  doi: 6,
  dom: 3,
  ept: 3,
  escaline: 3,
  "eth-lad": 6,
  lsa: 4,
  lsd: 4,
  "lsm-775": 6,
  lsz: 3,
  mda: 3,
  mescaline: 3,
  methallylescaline: 3,
  mipla: 6,
  mipt: 3,
  mpt: 3,
  "pargy-lad": 6,
  "pro-lad": 6,
  proscaline: 3,
  psilocin: 3,
  "psilocybin-mushrooms": 3,
  "tma-2": 3,
  "tma-6": 3,
  amt: 14,
  "bk-2c-b": 3,

  // ── Deliriants ──
  datura: 5,
  diphenhydramine: 5,
  mirtazapine: 3,

  // ── Nootropics ──
  "alpha-gpc": 7,
  aniracetam: 5,
  "choline-bitartrate": 7,
  coluracetam: 5,
  omberacetam: 5,
  piracetam: 5,
  pramiracetam: 5,
  "sam-e": 5,
  theanine: 5,
  tianeptine: 5,
};

/** Fallback half-life (in days) when substance is not in the table. */
const DEFAULT_TOLERANCE_HALF_LIFE_DAYS = 5;

/**
 * Resolve a substance's tolerance half-life (days).
 * Case-insensitive name + alias lookup.
 */
export function toleranceHalfLifeDays(substanceName: string): number {
  const lower = substanceName.toLowerCase().trim();
  // Direct match
  if (lower in TOLERANCE_HALF_LIVES_DAYS)
    return TOLERANCE_HALF_LIVES_DAYS[lower];
  // Substring match — e.g. "Cannabis (Sativa)" → cannabis
  for (const [key, val] of Object.entries(TOLERANCE_HALF_LIVES_DAYS)) {
    if (lower.includes(key)) return val;
  }
  return DEFAULT_TOLERANCE_HALF_LIFE_DAYS;
}

// ─── Time-series shapes ─────────────────────────────────────────────────────

export interface DailyCountPoint {
  date: string; // ISO yyyy-MM-dd
  label: string; // display label e.g. "Jul 9"
  count: number;
  uniqueSubstances: number;
}

export interface WeeklyCountPoint {
  weekStart: string;
  label: string;
  count: number;
}

export interface MonthlyCountPoint {
  monthStart: string;
  label: string;
  count: number;
}

export interface SubstanceBreakdownSlice {
  name: string;
  value: number; // dose count
  categories: string[];
}

export interface CategoryBreakdownSlice {
  name: string;
  value: number;
}

// ─── Time-series builders ───────────────────────────────────────────────────

/**
 * Daily dose counts for the last N days.
 * Days with zero doses still appear with count: 0 (no gaps in the chart).
 */
export function dailyCounts(doses: DoseLog[], days: number): DailyCountPoint[] {
  const now = new Date();
  const start = startOfDay(subDays(now, days - 1));
  const end = endOfDay(now);
  const range = eachDayOfInterval({ start, end });

  // Bucket doses by date string
  const bucket = new Map<string, { count: number; subs: Set<string> }>();
  for (const d of range) {
    bucket.set(format(d, "yyyy-MM-dd"), { count: 0, subs: new Set() });
  }
  for (const dose of doses) {
    const d = safeDate(dose.timestamp);
    if (!isWithinInterval(d, { start, end })) continue;
    const key = format(d, "yyyy-MM-dd");
    const b = bucket.get(key);
    if (!b) continue;
    b.count += 1;
    b.subs.add(dose.substanceName);
  }

  return range.map((d) => {
    const key = format(d, "yyyy-MM-dd");
    const b = bucket.get(key)!;
    return {
      date: key,
      label: format(d, "MMM d"),
      count: b.count,
      uniqueSubstances: b.subs.size,
    };
  });
}

/**
 * Weekly dose counts for the last N weeks (Sunday-start).
 */
export function weeklyCounts(
  doses: DoseLog[],
  weeks: number,
): WeeklyCountPoint[] {
  const now = new Date();
  const start = startOfDay(subDays(now, (weeks - 1) * 7));
  const end = endOfDay(now);
  const weekStarts = eachWeekOfInterval({ start, end }, { weekStartsOn: 0 });

  const bucket = new Map<string, number>();
  for (const w of weekStarts) bucket.set(format(w, "yyyy-MM-dd"), 0);

  for (const dose of doses) {
    const d = safeDate(dose.timestamp);
    if (!isWithinInterval(d, { start, end })) continue;
    // Find the week start that is the most recent Sunday on or before d
    const weekStart = startOfDay(subDays(d, d.getDay()));
    const key = format(weekStart, "yyyy-MM-dd");
    const cur = bucket.get(key);
    if (cur !== undefined) bucket.set(key, cur + 1);
  }

  return weekStarts.map((w) => ({
    weekStart: format(w, "yyyy-MM-dd"),
    label: format(w, "MMM d"),
    count: bucket.get(format(w, "yyyy-MM-dd")) ?? 0,
  }));
}

/**
 * Monthly dose counts for the last N months.
 */
export function monthlyCounts(
  doses: DoseLog[],
  months: number,
): MonthlyCountPoint[] {
  const now = new Date();
  // Start from N-1 months ago at day 1
  const startMonth = new Date(
    now.getFullYear(),
    now.getMonth() - (months - 1),
    1,
  );
  const end = endOfDay(now);
  const monthStarts = eachMonthOfInterval({ start: startMonth, end });

  const bucket = new Map<string, number>();
  for (const m of monthStarts) bucket.set(format(m, "yyyy-MM-dd"), 0);

  for (const dose of doses) {
    const d = safeDate(dose.timestamp);
    if (!isWithinInterval(d, { start: startMonth, end })) continue;
    const key = format(
      new Date(d.getFullYear(), d.getMonth(), 1),
      "yyyy-MM-dd",
    );
    const cur = bucket.get(key);
    if (cur !== undefined) bucket.set(key, cur + 1);
  }

  return monthStarts.map((m) => ({
    monthStart: format(m, "yyyy-MM-dd"),
    label: format(m, "MMM yy"),
    count: bucket.get(format(m, "yyyy-MM-dd")) ?? 0,
  }));
}

// ─── Breakdowns ─────────────────────────────────────────────────────────────

/**
 * Substance breakdown — top substances by dose count.
 * Suitable for pie charts.
 */
export function substanceBreakdown(
  doses: DoseLog[],
): SubstanceBreakdownSlice[] {
  const counts = new Map<string, { count: number; categories: Set<string> }>();
  for (const d of doses) {
    const key = d.substanceName;
    if (!counts.has(key)) counts.set(key, { count: 0, categories: new Set() });
    const entry = counts.get(key)!;
    entry.count += 1;
    if (Array.isArray(d.categories)) {
      for (const c of d.categories) entry.categories.add(c);
    }
  }

  const arr = Array.from(counts.entries())
    .map(([name, { count, categories }]) => ({
      name,
      value: count,
      categories: Array.from(categories),
    }))
    .sort((a, b) => b.value - a.value);

  // Bundle the long tail into "Other" so the pie stays readable
  if (arr.length <= 8) return arr;
  const head = arr.slice(0, 7);
  const tailTotal = arr.slice(7).reduce((s, x) => s + x.value, 0);
  return [...head, { name: "Other", value: tailTotal, categories: [] }];
}

/**
 * Category breakdown — dose counts per psychoactive category.
 */
export function categoryBreakdown(doses: DoseLog[]): CategoryBreakdownSlice[] {
  const counts = new Map<string, number>();
  for (const d of doses) {
    if (!Array.isArray(d.categories)) continue;
    for (const c of d.categories) {
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

// ─── Tolerance estimation ───────────────────────────────────────────────────

export interface ToleranceEstimate {
  substanceName: string;
  /** 0–1 — estimated current tolerance level (1 = full tolerance) */
  currentLevel: number;
  /** Estimated days until tolerance returns to baseline (≤5% level) */
  daysToBaseline: number;
  /** Last dose timestamp (ISO) */
  lastDose: string | null;
  /** Days since last dose */
  daysSinceLast: number;
  /** Total doses in the last 30 days */
  dosesLast30Days: number;
  /** Short qualitative description for UI display */
  level: "low" | "moderate" | "high" | "very-high" | "baseline";
  /** Explanation string for tooltip */
  explanation: string;
  /** Cross-tolerance group this substance belongs to (if any) */
  crossToleranceGroup: string | null;
}

// ─── Route weighting ────────────────────────────────────────────────────────
// Different routes of administration build tolerance at different rates because
// of bioavailability and peak-concentration differences. These multipliers
// scale each dose's contribution to the tolerance level. Oral is the baseline
// (1.0); faster-onset routes contribute more per dose.

const ROUTE_WEIGHTS: Record<string, number> = {
  oral: 1.0,
  insufflation: 1.2,
  insufflated: 1.2,
  sublingual: 1.1,
  buccal: 1.1,
  rectal: 1.3,
  inhaled: 1.3,
  inhalation: 1.3,
  smoked: 1.4,
  vaped: 1.3,
  intramuscular: 1.5,
  intravenous: 1.6,
  transdermal: 0.9,
  subcutaneous: 1.4,
  subq: 1.4,
};

/** Resolve a route string (which may be a user-typed freeform value) to a weight. */
function routeWeight(route: string | undefined | null): number {
  if (!route) return 1.0;
  const r = route.toLowerCase().trim();
  if (r in ROUTE_WEIGHTS) return ROUTE_WEIGHTS[r];
  // Substring fallback for variants like "oral (crushed)" etc.
  for (const [key, val] of Object.entries(ROUTE_WEIGHTS)) {
    if (r.includes(key)) return val;
  }
  return 1.0;
}

// ─── Dosage-string parsing ──────────────────────────────────────────────────
// Substance route data stores dosage tiers as human strings like "10-30mg",
// "3-5g", "75-150µg", or occasionally "Unknown" / "15-22mg/kg of body weight".
// We need the numeric midpoint (in the substance's native unit) so we can
// express a logged dose as a fraction of the "common" dose.

interface ParsedDoseRange {
  /** Numeric midpoint of the range, in the parsed unit. */
  midpoint: number;
  /** Unit string as it appeared (mg, g, µg, mL, etc.). */
  unit: string;
}

/**
 * Parse a dosage tier string into a numeric midpoint + unit.
 * Returns null for unparseable values ("Unknown", body-weight-relative, etc.).
 */
function parseDoseRange(
  raw: string | undefined | null,
): ParsedDoseRange | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || s.toLowerCase() === "unknown") return null;
  // Skip body-weight-relative doses — we can't normalize without the user's weight.
  if (s.toLowerCase().includes("kg")) return null;

  // Match patterns like "10-30mg", "0.8-1.5mg", "3-5g", "75-150µg", "1-2.5mL"
  const m = s.match(/([\d.]+)\s*[-–to]+\s*([\d.]+)\s*([a-zA-Zµg³²]+)/i);
  if (m) {
    const lo = parseFloat(m[1]);
    const hi = parseFloat(m[2]);
    if (isNaN(lo) || isNaN(hi)) return null;
    return { midpoint: (lo + hi) / 2, unit: normalizeUnit(m[3]) };
  }
  // Single value like "50mg"
  const single = s.match(/^([\d.]+)\s*([a-zA-Zµg³²]+)/i);
  if (single) {
    const v = parseFloat(single[1]);
    if (isNaN(v)) return null;
    return { midpoint: v, unit: normalizeUnit(single[2]) };
  }
  return null;
}

/** Normalize unit spellings (ug/mcg/µg → µg) so cross-unit comparison is safe. */
function normalizeUnit(u: string): string {
  const lower = u.toLowerCase();
  if (lower === "ug" || lower === "mcg") return "µg";
  if (lower === "ml") return "mL";
  return u;
}

/**
 * Compute the dose contribution weight for a single dose.
 *
 * Returns a multiplier (typically 0.2–3.0) representing how much tolerance
 * this dose adds relative to a "unit" (1.0 = one common-sized dose via oral).
 *
 * The weight is:  (amount / commonDose) × routeWeight
 *
 * - If we can't resolve the substance or its common dose, we fall back to the
 *   flat +1.0 per-dose model (so unknown substances still produce *something*).
 * - Unit normalization is best-effort: if the logged unit differs from the
 *   substance's common-dose unit, we try mg↔g↔µg conversion; if that fails we
 *   fall back to 1.0.
 */
function doseContribution(
  dose: DoseLog,
  commonDoseBySubstance: Map<string, ParsedDoseRange>,
): number {
  const common = commonDoseBySubstance.get(dose.substanceName);
  if (!common || !dose.amount || dose.amount <= 0) return 1.0;

  // Normalize the logged amount into the same unit as the common dose.
  let amount = dose.amount;
  const loggedUnit = normalizeUnit(dose.unit);
  const commonUnit = common.unit;
  if (loggedUnit !== commonUnit) {
    const conv = convertUnits(amount, loggedUnit, commonUnit);
    if (conv === null) return 1.0; // incompatible units → fallback
    amount = conv;
  }

  const ratio = amount / common.midpoint;
  // Clamp the ratio so a single heroic dose can't swamp the model into a
  // permanent "very high" — the cap is ~3x a common dose per event.
  const clampedRatio = Math.max(0.2, Math.min(3.0, ratio));
  return clampedRatio * routeWeight(dose.route);
}

/** Convert a value between compatible mass/volume units. Returns null if incompatible. */
function convertUnits(value: number, from: string, to: string): number | null {
  const f = from.toLowerCase();
  const t = to.toLowerCase();
  if (f === t) return value;
  // Mass conversions (target: mg)
  const toMg: Record<string, number> = {
    g: 1000,
    mg: 1,
    µg: 0.001,
    ug: 0.001,
    mcg: 0.001,
  };
  if (f in toMg && t in toMg) {
    return (value * toMg[f]) / toMg[t];
  }
  // Volume (mL) — only compatible with itself
  if ((f === "ml" || f === "l") && (t === "ml" || t === "l")) {
    const ml = f === "l" ? value * 1000 : value;
    return t === "l" ? ml / 1000 : ml;
  }
  return null;
}

// ─── Cross-tolerance grouping ───────────────────────────────────────────────
// Substances that share a cross-tolerance tag (e.g. amphetamine & methamphetamine
// both have "dopamine"/"stimulant") downregulate the same receptors, so a dose
// of one raises tolerance to the others. We model tolerance per cross-tolerance
// *group* (falling back to a substance-specific group when there are no shared
// tags), then attribute the group's level back to each member substance.

/**
 * Build a map from substance name → cross-tolerance group key.
 * Group key is the sorted, joined set of cross-tolerance tags (e.g. "dopamine|stimulant").
 * Substances with no cross-tolerance tags get their own name as the group key
 * (so they're modeled independently, as before).
 */
function buildCrossToleranceGroups(
  doses: DoseLog[],
  crossTagsBySubstance: Map<string, string[]>,
): Map<string, string> {
  const groupFor = new Map<string, string>();
  for (const d of doses) {
    if (groupFor.has(d.substanceName)) continue;
    const tags = (crossTagsBySubstance.get(d.substanceName) ?? [])
      .filter(Boolean)
      .sort();
    groupFor.set(
      d.substanceName,
      tags.length > 0 ? tags.join("|") : d.substanceName,
    );
  }
  return groupFor;
}

/**
 * Estimate per-substance tolerance using an exponential decay model with three
 * improvements over a flat per-dose model:
 *
 * 1. **Dose weighting** — each dose contributes (amount / commonDose) rather
 *    than a flat +1.0, so a heavy dose builds more tolerance than a threshold one.
 * 2. **Route weighting** — faster-onset routes (IV, smoked, insufflated) add
 *    more tolerance per dose than oral/transdermal.
 * 3. **Cross-tolerance** — substances sharing a cross-tolerance tag (e.g. all
 *    dopaminergic stimulants, all 5-HT2A psychedelics) are modeled as one
 *    shared tolerance pool rather than independent silos.
 *
 * Each dose adds its weighted contribution to the group's running level
 * (capped at 1.0); between doses the level decays exponentially with the
 * group's representative half-life.
 *
 * This is still a *heuristic* — not a pharmacokinetic model. It's intended for
 * harm-reduction awareness, not dosing decisions.
 */
export function estimateTolerance(doses: DoseLog[]): ToleranceEstimate[] {
  const now = Date.now();

  // ── Resolve per-substance metadata ──
  // common dose (for weighting) + cross-tolerance tags (for grouping) +
  // representative half-life (for the group).
  const commonDoseBySubstance = new Map<string, ParsedDoseRange>();
  const crossTagsBySubstance = new Map<string, string[]>();
  for (const d of doses) {
    if (
      commonDoseBySubstance.has(d.substanceName) &&
      crossTagsBySubstance.has(d.substanceName)
    )
      continue;
    const sub = findSubstance(d.substanceName);
    if (sub) {
      // Try the logged route first, then oral, then any available route.
      const routeKey = sub.routeData
        ? pickRouteData(sub.routeData, d.route)
        : null;
      const routeData = routeKey ? sub.routeData![routeKey] : null;
      const common = routeData ? parseDoseRange(routeData.dosage.common) : null;
      if (common) commonDoseBySubstance.set(d.substanceName, common);
      const tags = sub.interactions?.crossTolerances ?? [];
      if (tags.length > 0) crossTagsBySubstance.set(d.substanceName, tags);
    }
  }

  const groupFor = buildCrossToleranceGroups(doses, crossTagsBySubstance);

  // ── Group doses by cross-tolerance group ──
  const dosesByGroup = new Map<
    string,
    { name: string; dose: DoseLog; ts: number }[]
  >();
  for (const d of doses) {
    const group = groupFor.get(d.substanceName) ?? d.substanceName;
    if (!dosesByGroup.has(group)) dosesByGroup.set(group, []);
    dosesByGroup.get(group)!.push({
      name: d.substanceName,
      dose: d,
      ts: safeDate(d.timestamp).getTime(),
    });
  }

  // ── Run the decay simulation per group ──
  const groupLevel = new Map<string, number>();
  const groupLastTs = new Map<string, number>();
  const groupHalfLife = new Map<string, number>();

  for (const [group, groupDoses] of dosesByGroup) {
    const cutoff = now - 90 * 24 * 60 * 60 * 1000;
    const recent = groupDoses
      .filter((x) => x.ts >= cutoff)
      .sort((a, b) => a.ts - b.ts);
    if (recent.length === 0) continue;

    // Representative half-life = min half-life across members (the fastest-
    // decaying member dominates, since shared receptor downregulation is
    // driven by the substance that clears quickest).
    const memberNames = new Set(recent.map((x) => x.name));
    let halfLifeDays = DEFAULT_TOLERANCE_HALF_LIFE_DAYS;
    for (const name of memberNames) {
      const hl = toleranceHalfLifeDays(name);
      if (hl < halfLifeDays) halfLifeDays = hl;
    }
    const decayPerDay = Math.log(2) / halfLifeDays;

    let level = 0;
    let prevTs = recent[0].ts;
    for (const { dose } of recent) {
      const elapsedDays =
        dose && prevTs
          ? (safeDate(dose.timestamp).getTime() - prevTs) /
            (1000 * 60 * 60 * 24)
          : 0;
      level *= Math.exp(-decayPerDay * elapsedDays);
      const contrib = doseContribution(dose, commonDoseBySubstance);
      level = Math.min(1, level + contrib);
      prevTs = safeDate(dose.timestamp).getTime();
    }

    const lastTs = recent[recent.length - 1].ts;
    const daysSinceLast = Math.max(0, (now - lastTs) / (1000 * 60 * 60 * 24));
    level *= Math.exp(-decayPerDay * daysSinceLast);

    groupLevel.set(group, level);
    groupLastTs.set(group, lastTs);
    groupHalfLife.set(group, halfLifeDays);
  }

  // ── Attribute each substance's level from its group ──
  // Multiple substances in the same group share one level. We emit one
  // ToleranceEstimate per substance (so the UI still shows per-substance
  // rows), but they'll all read the same group level. The per-substance
  // dose count / last-dose fields stay substance-specific.
  const out: ToleranceEstimate[] = [];
  const seenGroups = new Set<string>();

  // Build per-substance stats first
  const bySubstance = new Map<string, DoseLog[]>();
  for (const d of doses) {
    if (!bySubstance.has(d.substanceName)) bySubstance.set(d.substanceName, []);
    bySubstance.get(d.substanceName)!.push(d);
  }

  for (const [name, subsDoses] of bySubstance) {
    const group = groupFor.get(name) ?? name;
    const level = groupLevel.get(group) ?? 0;
    const lastTs = groupLastTs.get(group);
    const halfLifeDays =
      groupHalfLife.get(group) ?? toleranceHalfLifeDays(name);
    const daysSinceLast = lastTs
      ? Math.max(0, (now - lastTs) / (1000 * 60 * 60 * 24))
      : 0;

    // Days until tolerance drops below ~5% (the PW "baseline" threshold,
    // calibrated from PW data: baseline ≈ 2 half-lives → 5% remaining).
    const decayPerDay = Math.log(2) / halfLifeDays;
    const targetLevel = 0.05;
    const daysToBaseline =
      level > targetLevel ? Math.log(level / targetLevel) / decayPerDay : 0;

    let levelLabel: ToleranceEstimate["level"];
    if (level < 0.05) levelLabel = "baseline";
    else if (level < 0.2) levelLabel = "low";
    else if (level < 0.5) levelLabel = "moderate";
    else if (level < 0.75) levelLabel = "high";
    else levelLabel = "very-high";

    const dosesLast30Days = subsDoses.filter(
      (d) => safeDate(d.timestamp).getTime() >= now - 30 * 24 * 60 * 60 * 1000,
    ).length;

    const crossTags = crossTagsBySubstance.get(name) ?? [];
    const groupLabel =
      group !== name && crossTags.length > 0
        ? `Shares ${crossTags.join(" + ")} tolerance`
        : null;

    // Explain the model briefly, mentioning weighting + grouping when relevant.
    const weightingNote = commonDoseBySubstance.has(name)
      ? "Doses are weighted by size relative to the common dose and by route of administration. "
      : "";
    const groupNote =
      group !== name
        ? `Tolerance is shared across substances in the ${crossTags.join(" + ")} group. `
        : "";
    const recentCount = (dosesByGroup.get(group) ?? []).filter(
      (x) => x.ts >= now - 90 * 24 * 60 * 60 * 1000,
    ).length;
    // Note the provenance of the half-life value so the UI is transparent.
    const lowerName = name.toLowerCase().trim();
    const isKnownSubstance =
      lowerName in TOLERANCE_HALF_LIVES_DAYS ||
      Object.keys(TOLERANCE_HALF_LIVES_DAYS).some((k) => lowerName.includes(k));
    const sourceNote = isKnownSubstance
      ? "Half-life sourced from PsychonautWiki / clinical literature. "
      : "Half-life is a default estimate (substance not in the sourced table). ";

    out.push({
      substanceName: name,
      currentLevel: Math.round(level * 100) / 100,
      daysToBaseline: Math.ceil(daysToBaseline),
      lastDose: lastTs ? new Date(lastTs).toISOString() : null,
      daysSinceLast: Math.floor(daysSinceLast),
      dosesLast30Days,
      level: levelLabel,
      crossToleranceGroup: groupLabel,
      explanation:
        `Modeled as exponential decay with a ${halfLifeDays}-day half-life. ` +
        sourceNote +
        weightingNote +
        groupNote +
        `Based on ${recentCount} dose(s) in the last 90 days. ` +
        `This is a heuristic, not a pharmacokinetic model — for harm-reduction awareness only.`,
    });

    seenGroups.add(group);
  }

  // Sort: highest current tolerance first
  return out.sort((a, b) => b.currentLevel - a.currentLevel);
}

// ─── Substance lookup helpers ───────────────────────────────────────────────
// Static import (no circular dep: substances/index does not import analytics).

let _substancesCache: Map<string, Substance> | null = null;
function getSubstanceMap(): Map<string, Substance> {
  if (_substancesCache) return _substancesCache;
  const map = new Map<string, Substance>();
  for (const s of ALL_SUBSTANCES) {
    map.set(s.name.toLowerCase(), s);
    for (const alias of s.aliases ?? []) map.set(alias.toLowerCase(), s);
    for (const cn of s.commonNames ?? []) map.set(cn.toLowerCase(), s);
  }
  _substancesCache = map;
  return map;
}

/** Find a substance by name (case-insensitive, includes aliases & common names). */
function findSubstance(name: string): Substance | null {
  return getSubstanceMap().get(name.toLowerCase().trim()) ?? null;
}

/**
 * Pick the best route-data key for a logged route.
 * routeData keys use slightly different spellings than logged routes
 * (e.g. "insufflated" vs "insufflation"), so we normalize.
 */
function pickRouteData(
  routeData: Record<string, RouteDosageDuration>,
  loggedRoute?: string,
): string | null {
  if (!loggedRoute) {
    return routeData.oral ? "oral" : (Object.keys(routeData)[0] ?? null);
  }
  const r = loggedRoute.toLowerCase().trim();
  // Direct match
  if (routeData[r]) return r;
  // Synonym match
  const synonyms: Record<string, string[]> = {
    oral: ["oral", "po"],
    insufflation: ["insufflation", "insufflated", "nasal", "snorted"],
    smoked: ["smoked", "smoke"],
    intravenous: ["intravenous", "iv"],
    intramuscular: ["intramuscular", "im"],
    sublingual: ["sublingual"],
    inhaled: ["inhaled", "inhalation", "vaped"],
    buccal: ["buccal"],
    rectal: ["rectal"],
    transdermal: ["transdermal"],
  };
  for (const [key, syns] of Object.entries(synonyms)) {
    if (syns.includes(r) && routeData[key]) return key;
  }
  // Fallback: any key that contains the route or vice-versa
  for (const key of Object.keys(routeData)) {
    if (key.includes(r) || r.includes(key)) return key;
  }
  return routeData.oral ? "oral" : (Object.keys(routeData)[0] ?? null);
}

// ─── Streaks & usage patterns ───────────────────────────────────────────────

export interface StreakInsights {
  /** Current active-day streak (consecutive days with ≥1 dose, ending today or yesterday). */
  currentStreak: number;
  /** Longest active-day streak on record. */
  longestStreak: number;
  /** Current rest-day streak (consecutive days with 0 doses). */
  currentRestStreak: number;
  /** Average doses per active day (last 30 days). */
  avgDosesPerActiveDay30d: number;
  /** Most active day of week (0=Sun … 6=Sat) and its dose count. */
  mostActiveDayOfWeek: { day: number; label: string; count: number } | null;
  /** Most active hour of day (0-23) and its dose count. */
  mostActiveHour: { hour: number; count: number } | null;
  /** Total unique substances logged. */
  uniqueSubstances: number;
  /** Total active days (days with ≥1 dose). */
  totalActiveDays: number;
  /** Total rest days (in the range covered by the data). */
  totalRestDays: number;
}

const DAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * Compute streak + usage-pattern insights from the dose log.
 */
export function computeStreakInsights(doses: DoseLog[]): StreakInsights {
  if (doses.length === 0) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      currentRestStreak: 0,
      avgDosesPerActiveDay30d: 0,
      mostActiveDayOfWeek: null,
      mostActiveHour: null,
      uniqueSubstances: 0,
      totalActiveDays: 0,
      totalRestDays: 0,
    };
  }

  const now = new Date();
  const today = startOfDay(now);
  const sortedDates = doses
    .map((d) => startOfDay(safeDate(d.timestamp)).getTime())
    .sort((a, b) => a - b);

  // Unique active days as a Set of timestamps
  const activeDaySet = new Set(sortedDates);
  const totalActiveDays = activeDaySet.size;

  // Range covered = earliest active day → today
  const earliest = sortedDates[0];
  const totalDaysInRange = Math.max(
    1,
    differenceInCalendarDays(today, new Date(earliest)) + 1,
  );
  const totalRestDays = Math.max(0, totalDaysInRange - totalActiveDays);

  // ── Current streak (ending today or yesterday) ──
  let currentStreak = 0;
  let cursor = today.getTime();
  // Allow streak to "end yesterday" if today has no doses yet
  if (!activeDaySet.has(cursor)) {
    cursor = subDays(new Date(cursor), 1).getTime();
  }
  while (activeDaySet.has(cursor)) {
    currentStreak += 1;
    cursor = subDays(new Date(cursor), 1).getTime();
  }

  // ── Current rest streak (consecutive zero-dose days ending today) ──
  let currentRestStreak = 0;
  cursor = today.getTime();
  while (!activeDaySet.has(cursor) && cursor >= earliest) {
    currentRestStreak += 1;
    cursor = subDays(new Date(cursor), 1).getTime();
  }

  // ── Longest streak ──
  let longestStreak = 0;
  let run = 0;
  let prevTs: number | null = null;
  // Walk through sorted unique active-day timestamps
  const uniqueDays = Array.from(activeDaySet).sort((a, b) => a - b);
  for (const ts of uniqueDays) {
    if (prevTs !== null && ts - prevTs === 24 * 60 * 60 * 1000) {
      run += 1;
    } else {
      run = 1;
    }
    longestStreak = Math.max(longestStreak, run);
    prevTs = ts;
  }

  // ── Avg doses per active day (last 30 days) ──
  const thirtyDaysAgo = subDays(now, 30).getTime();
  const recentDoses = doses.filter(
    (d) => safeDate(d.timestamp).getTime() >= thirtyDaysAgo,
  );
  const recentActiveDays = new Set(
    recentDoses.map((d) => startOfDay(safeDate(d.timestamp)).getTime()),
  );
  const avgDosesPerActiveDay30d =
    recentActiveDays.size > 0
      ? Math.round((recentDoses.length / recentActiveDays.size) * 10) / 10
      : 0;

  // ── Most active day of week ──
  const dowCounts = new Array(7).fill(0);
  for (const d of doses) {
    dowCounts[safeDate(d.timestamp).getDay()] += 1;
  }
  let mostActiveDow: { day: number; label: string; count: number } | null =
    null;
  for (let i = 0; i < 7; i++) {
    if (!mostActiveDow || dowCounts[i] > mostActiveDow.count) {
      mostActiveDow = { day: i, label: DAY_LABELS[i], count: dowCounts[i] };
    }
  }
  if (mostActiveDow && mostActiveDow.count === 0) mostActiveDow = null;

  // ── Most active hour ──
  const hourCounts = new Array(24).fill(0);
  for (const d of doses) {
    hourCounts[safeDate(d.timestamp).getHours()] += 1;
  }
  let mostActiveHour: { hour: number; count: number } | null = null;
  for (let i = 0; i < 24; i++) {
    if (!mostActiveHour || hourCounts[i] > mostActiveHour.count) {
      mostActiveHour = { hour: i, count: hourCounts[i] };
    }
  }
  if (mostActiveHour && mostActiveHour.count === 0) mostActiveHour = null;

  // ── Unique substances ──
  const uniqueSubstances = new Set(doses.map((d) => d.substanceName)).size;

  return {
    currentStreak,
    longestStreak,
    currentRestStreak,
    avgDosesPerActiveDay30d,
    mostActiveDayOfWeek: mostActiveDow,
    mostActiveHour,
    uniqueSubstances,
    totalActiveDays,
    totalRestDays,
  };
}

// ─── Intensity timeline (interactive, for /analytics) ───────────────────────

export interface IntensityTimelinePoint {
  /** ISO timestamp for this sample point */
  timestamp: string;
  /** Display label e.g. "2:00 PM" */
  label: string;
  /** 0–100 — combined intensity across all active doses at this time */
  intensity: number;
  /** Per-substance breakdown at this point (for tooltips) */
  bySubstance: Record<string, number>;
}

/**
 * Sample the combined intensity curve over a time window.
 *
 * For each dose, we compute the dose-relative intensity (0–100) using
 * the same model as the active-doses-timeline. We then sample the
 * combined curve at fixed intervals.
 *
 * Returns a flat array suitable for a Recharts line/area chart.
 */
export function computeIntensityTimeline(
  doses: DoseLog[],
  windowHours: number = 24,
  sampleIntervalMins: number = 15,
): IntensityTimelinePoint[] {
  // Lazy-load the timeline utils to avoid circular imports at module load time
  // (these are pure functions but they pull in a lot of code).
  const {
    parseDurationToMinutes,
    calculatePhaseTimings,
    calculateDoseScaledTimings,
    intensityAt,
  } = require("@/components/dose-timeline/dose-timeline-utils");
  const { classifyDose } = require("@/lib/dose-classification");
  const { substances } = require("@/lib/substances/index");

  const now = Date.now();
  const windowStart = now - windowHours * 60 * 60 * 1000;

  // Build a name→substance lookup
  const substanceByName = new Map<string, any>();
  for (const s of substances) {
    substanceByName.set(s.name.toLowerCase(), s);
  }

  // Precompute each dose's intensity curve function (progress → 0-100)
  type Curve = {
    substanceName: string;
    doseStartTs: number;
    totalDurationMins: number;
    timings: any;
    doseHeight: number;
  };
  const curves: Curve[] = [];

  for (const d of doses) {
    if (!d.duration) continue;
    const totalMins = parseDurationToMinutes(d.duration.total ?? "");
    if (totalMins <= 0) continue;
    const doseStartTs = safeDate(d.timestamp).getTime();
    const doseEndTs = doseStartTs + totalMins * 60 * 1000;
    // Skip doses that ended before the window start
    if (doseEndTs < windowStart) continue;

    const substanceEntry = substanceByName.get(d.substanceName.toLowerCase());
    const classification = substanceEntry
      ? classifyDose(d.amount, d.unit, substanceEntry, d.route)
      : null;
    const horizontalWeight = classification?.horizontalWeight ?? 0.5;
    const doseHeight = classification?.heightRelativeToCommon ?? 1;
    const timings = classification
      ? calculateDoseScaledTimings(d.duration, horizontalWeight)
      : calculatePhaseTimings(d.duration);

    curves.push({
      substanceName: d.substanceName,
      doseStartTs,
      totalDurationMins: timings.totalDuration,
      timings,
      doseHeight,
    });
  }

  // Sample the combined curve
  const points: IntensityTimelinePoint[] = [];
  const sampleCount = Math.ceil((windowHours * 60) / sampleIntervalMins);
  for (let i = 0; i <= sampleCount; i++) {
    const ts = windowStart + i * sampleIntervalMins * 60 * 1000;
    const bySubstance: Record<string, number> = {};
    let combined = 0;
    for (const c of curves) {
      const elapsedMins = (ts - c.doseStartTs) / 60_000;
      if (elapsedMins < 0 || elapsedMins > c.timings.totalDuration) continue;
      const progress = (elapsedMins / c.timings.totalDuration) * 100;
      const raw = intensityAt(progress, c.timings);
      // Scale by dose height — bigger doses rise above 100 visually
      const scaled = Math.min(100, raw * c.doseHeight);
      if (scaled > 0.5) {
        bySubstance[c.substanceName] = Math.max(
          bySubstance[c.substanceName] ?? 0,
          scaled,
        );
        combined = Math.max(combined, scaled); // peak-hold, not sum (avoids runaway values)
      }
    }
    points.push({
      timestamp: new Date(ts).toISOString(),
      label: format(new Date(ts), windowHours <= 24 ? "h:mm a" : "MMM d HH:mm"),
      intensity: Math.round(combined),
      bySubstance,
    });
  }

  return points;
}

// ─── Pie chart color palette ────────────────────────────────────────────────

/** Distinct, color-blind-friendly palette for pie/breakdown charts. */
export const ANALYTICS_PIE_COLORS = [
  "#a855f7", // purple
  "#06b6d4", // cyan
  "#f59e0b", // amber
  "#10b981", // emerald
  "#ec4899", // pink
  "#3b82f6", // blue
  "#ef4444", // red
  "#84cc16", // lime
  "#8b5cf6", // violet
  "#14b8a6", // teal
];

export function pieColor(index: number): string {
  return ANALYTICS_PIE_COLORS[index % ANALYTICS_PIE_COLORS.length];
}
