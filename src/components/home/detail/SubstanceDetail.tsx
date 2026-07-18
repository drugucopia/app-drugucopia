'use client'

import { useState, useCallback } from 'react'
import type { Substance, SubstanceCategory } from '@/lib/types'
import { SubstanceSummary } from './SubstanceSummary'
import { SubstanceDetailTabs } from './SubstanceDetailTabs'
import { SubstanceQuickFacts } from './SubstanceQuickFacts'

interface SubstanceDetailProps {
  substance: Substance
  onBack: () => void
  onCategoryClick?: (category: SubstanceCategory) => void
  router: ReturnType<typeof import('next/navigation').useRouter>
}

/**
 * SubstanceDetail — Phase 3 orchestrator for the substance detail page.
 *
 * Replaces the previous 600+ line implementation in home-content.tsx that
 * had fully duplicated desktop/mobile branches. This version uses a single
 * responsive layout:
 *
 *   ┌─────────────────────────────────────────────────┐
 *   │  SubstanceSummary  (full width)                  │
 *   ├─────────────────────────────────┬───────────────┤
 *   │  SubstanceDetailTabs (main)     │ QuickFacts    │
 *   │  Overview / Dosage / Effects /  │ (right rail,  │
 *   │  Harm / Interactions            │  desktop only)│
 *   └─────────────────────────────────┴───────────────┘
 *
 * On mobile the right rail stacks below the tab group.
 */
export function SubstanceDetail({
  substance,
  onBack,
  onCategoryClick,
  router,
}: SubstanceDetailProps) {
  const [selectedRoute, setSelectedRoute] = useState<string | null>(null)

  const handleRouteChange = useCallback((r: string | null) => setSelectedRoute(r), [])
  const handleOpenInteractions = useCallback(() => {
    router.push(`/interactions?substances=${substance.id}`)
  }, [router, substance.id])

  return (
    <div className="container mx-auto space-y-6 px-4 py-6 lg:px-6 lg:py-10">
      <SubstanceSummary
        substance={substance}
        selectedRoute={selectedRoute}
        onBack={onBack}
        onCategoryClick={onCategoryClick}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SubstanceDetailTabs
            substance={substance}
            onRouteChange={handleRouteChange}
            onCategoryClick={onCategoryClick}
          />
        </div>

        <div className="lg:col-span-1">
          <SubstanceQuickFacts
            substance={substance}
            onOpenInteractions={handleOpenInteractions}
          />
        </div>
      </div>
    </div>
  )
}
