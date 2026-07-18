'use client'

import { Plus, ArrowLeft } from 'lucide-react'
import type { Substance, SubstanceCategory } from '@/lib/types'
import { categories } from '@/lib/categories'
import { categoryColors, riskLevelColors } from '../home-constants'
import {
  CategoryBadges,
  CategoryIcon,
  getPrimaryCategory,
  getSubstanceCategories,
} from '../home-utils'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/ui-store'

interface SubstanceSummaryProps {
  substance: Substance
  selectedRoute: string | null
  onBack: () => void
  onCategoryClick?: (category: SubstanceCategory) => void
}

/**
 * SubstanceSummary — top summary card for the substance detail page.
 *
 * Phase 3 redesign (plan §6.1). Single responsive card that replaces the
 * previous duplicated desktop-header + mobile-header pattern. Shows:
 *   - back button
 *   - substance name + class
 *   - description
 *   - category badges (clickable when onCategoryClick provided)
 *   - risk badge
 *   - primary "Log Dose" CTA
 *
 * On desktop the actions row sits on the right; on mobile it wraps below.
 */
export function SubstanceSummary({
  substance,
  selectedRoute,
  onBack,
  onCategoryClick,
}: SubstanceSummaryProps) {
  const primary = getPrimaryCategory(substance)
  const openDoseLogger = useUIStore((state) => state.openDoseLogger)

  const handleLogDose = () => {
    openDoseLogger({
      substanceId: substance.id,
      substanceName: substance.name,
      category: getSubstanceCategories(substance),
      route: selectedRoute || undefined,
    })
  }

  return (
    <section className="card border border-base-300/70 bg-base-100/70 backdrop-blur-sm shadow-sm">
      <div className="card-body gap-4 p-4 md:p-6">
        {/* Top row: back + title block */}
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={onBack}
            className="btn btn-ghost btn-sm btn-square shrink-0"
            aria-label="Back to library"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          <div className="flex min-w-0 flex-1 items-start gap-3">
            {primary && (
              <div
                className={cn(
                  'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
                  categoryColors[primary],
                )}
              >
                <CategoryIcon substance={substance} className="h-5 w-5" />
              </div>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold tracking-tight md:text-2xl">
                {substance.name}
              </h1>
              <p className="truncate text-xs text-neutral-content md:text-sm">
                {substance.class}
                {substance.commonNames.length > 0 && (
                  <> · {substance.commonNames.slice(0, 3).join(' · ')}</>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Description */}
        <p className="text-sm leading-relaxed text-base-content/90 md:text-base">
          {substance.description}
        </p>

        {/* Badges + actions */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <CategoryBadges
              substance={substance}
              className="[&_button]:cursor-pointer"
            />
            {/* Wire category clicks if the parent passed a handler */}
            <CategoryBadgeButtons
              substance={substance}
              onCategoryClick={onCategoryClick}
            />
            <span
              className={cn(
                'badge badge-outline badge-sm capitalize',
                riskLevelColors[substance.riskLevel],
              )}
            >
              {substance.riskLevel.replace('-', ' ')} risk
            </span>
          </div>

          <button type="button" className="btn btn-primary btn-sm gap-2" onClick={handleLogDose}>
            <Plus className="h-4 w-4" />
            Log Dose
          </button>
        </div>
      </div>
    </section>
  )
}

/**
 * CategoryBadgeButtons — renders the substance's categories as clickable
 * badges (when onCategoryClick is provided) or nothing (the static
 * CategoryBadges component from home-utils already handles the non-clickable
 * case via SubstanceSummary above).
 *
 * Kept as a separate subcomponent so SubstanceSummary's main render stays
 * readable.
 */
function CategoryBadgeButtons({
  substance,
  onCategoryClick,
}: {
  substance: Substance
  onCategoryClick?: (category: SubstanceCategory) => void
}) {
  if (!onCategoryClick) return null
  const cats = getSubstanceCategories(substance)
  return (
    <>
      {cats.map((cat) => {
        const info = categories.find((c) => c.id === cat)
        return (
          <button
            key={cat}
            type="button"
            onClick={() => onCategoryClick(cat)}
            className={cn(
              'badge badge-outline badge-sm cursor-pointer gap-0.5 text-xs transition-colors hover:brightness-110',
              categoryColors[cat] ?? '',
            )}
          >
            {info?.name ?? cat}
          </button>
        )
      })}
    </>
  )
}
