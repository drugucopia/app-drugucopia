'use client'

import { useState, useMemo, useEffect, useRef, useCallback, useDeferredValue } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'

import {
  substances,
  type Substance,
  type SubstanceCategory,
} from '@/lib/substances/index'
import { categories } from '@/lib/categories'

import { LibraryHero, CategoryFilterBar, SubstanceGrid } from './library'
import { SubstanceDetail } from './detail'

// ─── ROOT COMPONENT ───────────────────────────────────────────────────────────
export function HomeContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const queryParam = searchParams.get('q') ?? ''
  const [selectedCategory, setSelectedCategory] = useState<SubstanceCategory | 'all'>('all')
  const [selectedSubstance, setSelectedSubstance] = useState<Substance | null>(null)
  const [searchQuery, setSearchQuery] = useState(queryParam)
  const lastProcessedSubstanceRef = useRef<string | null>(null)
  const deferredQuery = useDeferredValue(searchQuery)

  // Backwards-compat redirect: the Track workspace used to live at
  // /?view=dose-log (inline in this component). It now lives at /dose-log.
  // Forward any old ?view=... links to the new page so bookmarks and
  // external links don't break. Uses window.location for a hard redirect
  // because router.replace on same-pathname doesn't reliably clear the
  // search param under output:export + trailingSlash:true.
  useEffect(() => {
    const view = searchParams.get('view')
    if (view === 'dose-log' || view === 'timeline' || view === 'history') {
      window.location.replace('/dose-log')
    }
  }, [searchParams])

  // Listen for search events from the app shell search input
  useEffect(() => {
    const handler = (e: Event) => {
      const query = (e as CustomEvent).detail
      setSearchQuery(query)
    }
    window.addEventListener('drugucopia:search', handler)
    return () => window.removeEventListener('drugucopia:search', handler)
  }, [])

  // Handle URL query parameters (deep-link to a substance via ?substance=)
  useEffect(() => {
    const substanceId = searchParams.get('substance')
    if (substanceId) {
      if (substanceId !== lastProcessedSubstanceRef.current) {
        const found = substances.find((s) => s.id === substanceId)
        if (found) {
          setSelectedSubstance(found)
          lastProcessedSubstanceRef.current = substanceId
        }
      }
    } else {
      if (selectedSubstance) setSelectedSubstance(null)
      lastProcessedSubstanceRef.current = null
    }
  }, [searchParams, selectedSubstance])

  const handleBackFromDetail = useCallback(() => {
    window.history.pushState(null, '', pathname)
  }, [pathname])

  const handleCategoryClickFromDetail = useCallback(
    (category: SubstanceCategory) => {
      setSelectedSubstance(null)
      lastProcessedSubstanceRef.current = null
      setSelectedCategory(category)
      window.history.pushState(null, '', pathname)
    },
    [pathname],
  )

  const [visibleCount, setVisibleCount] = useState(() => {
    // Start with fewer cards on mobile — fewer DOM nodes + fewer card backgrounds
    // to paint on first scroll. "Show More" still loads the rest on demand.
    if (typeof window !== 'undefined' && window.innerWidth < 768) return 12
    return 24
  })

  useEffect(() => {
    setVisibleCount(typeof window !== 'undefined' && window.innerWidth < 768 ? 12 : 24)
  }, [selectedCategory, deferredQuery])

  const filteredSubstances = useMemo(() => {
    let result = substances
    if (selectedCategory !== 'all') {
      result = result.filter((s) => s.categories?.includes(selectedCategory))
    }
    if (deferredQuery) {
      const q = deferredQuery.toLowerCase()
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.commonNames.some((n) => n.toLowerCase().includes(q)),
      )
    }
    return result
  }, [selectedCategory, deferredQuery])

  const handleSelectSubstance = useCallback(
    (substance: Substance) => {
      setSelectedSubstance(substance)
      lastProcessedSubstanceRef.current = substance.id
      // Use pushState instead of router.push to avoid full page reload in static export
      window.history.pushState(null, '', `${pathname}?substance=${substance.id}`)
    },
    [pathname],
  )

  const handleCategoryChange = useCallback(
    (cat: SubstanceCategory | 'all') => {
      setSelectedCategory(cat)
      if (searchParams.toString()) window.history.pushState(null, '', pathname)
    },
    [searchParams, pathname],
  )

  useEffect(() => {
    if (selectedSubstance) window.scrollTo(0, 0)
  }, [selectedSubstance])

  // ── Substance detail ──
  if (selectedSubstance) {
    return (
      <SubstanceDetail
        substance={selectedSubstance}
        onBack={handleBackFromDetail}
        onCategoryClick={handleCategoryClickFromDetail}
        router={router}
      />
    )
  }

  // ── Library list view ──
  return (
    <div className="container mx-auto px-4 py-6 lg:px-6 lg:py-10">
      <LibraryHero
        selectedCategory={selectedCategory}
        categories={categories}
        totalCount={filteredSubstances.length}
      />

      <CategoryFilterBar
        selectedCategory={selectedCategory}
        onChange={handleCategoryChange}
        categories={categories}
      />

      <SubstanceGrid
        substances={filteredSubstances}
        visibleCount={visibleCount}
        totalCount={filteredSubstances.length}
        onSelect={handleSelectSubstance}
        onShowMore={() =>
          setVisibleCount((prev) => prev + (typeof window !== 'undefined' && window.innerWidth < 768 ? 12 : 24))
        }
      />
    </div>
  )
}
