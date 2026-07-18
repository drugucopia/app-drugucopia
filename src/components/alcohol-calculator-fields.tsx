'use client'

import { useState, useMemo } from 'react'
import { Wine, Scale, Beaker, Info, ArrowRightLeft } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import {
  SHOT_SIZES,
  BEVERAGE_PRESETS,
  STANDARD_DRINKS,
  shotsToGrams,
  getShotSize,
  getBeveragePreset,
  roundTo,
  ETHANOL_DENSITY_G_PER_ML,
} from '@/lib/calculators/alcohol'

interface AlcoholCalculatorFieldsProps {
  /** Current amount entered by user (drinks/shots) */
  amount: string
  /** Callback to update the form's amount (with grams) */
  onAmountChange: (amount: string) => void
  /** Callback to update the form's unit */
  onUnitChange: (unit: string) => void
}

/**
 * Inline alcohol-to-gram calculator for the dose logger modal.
 * Appears when the user selects "Alcohol" as the substance.
 *
 * Converts drinks/shots to grams of pure ethanol using the same
 * calculation logic as the full alcohol calculator.
 */
export function AlcoholCalculatorFields({
  amount,
  onAmountChange,
  onUnitChange,
}: AlcoholCalculatorFieldsProps) {
  // ─── Calculator state ───────────────────────────────────────────────────────
  const [beverageId, setBeverageId] = useState('spirits')
  const [shotSizeId, setShotSizeId] = useState('us-single')
  const [drinkCount, setDrinkCount] = useState(() => amount ? parseFloat(amount) || 2 : 2)
  const [drinkUnit, setDrinkUnit] = useState<'shots' | 'drinks'>('shots')

  // ─── Derived values ────────────────────────────────────────────────────────
  const beveragePreset = useMemo(() => getBeveragePreset(beverageId), [beverageId])
  const shotSize = useMemo(() => getShotSize(shotSizeId), [shotSizeId])

  // Calculate grams of ethanol
  const conversionResult = useMemo(() => {
    const volumeMl = shotSize?.volumeMl ?? 44.36
    const abv = beveragePreset?.abv ?? 40
    return shotsToGrams({ shots: drinkCount, shotVolumeMl: volumeMl, abv })
  }, [drinkCount, shotSize, beveragePreset])

  // ─── Handle drink count change ────────────────────────────────────────────
  const handleDrinkCountChange = (value: number) => {
    setDrinkCount(value)
    // Update parent with the calculated grams
    const volumeMl = shotSize?.volumeMl ?? 44.36
    const abv = beveragePreset?.abv ?? 40
    const result = shotsToGrams({ shots: value, shotVolumeMl: volumeMl, abv })
    if (result) {
      const roundedGrams = roundTo(result.ethanolGrams, 2)
      onAmountChange(String(roundedGrams))
      onUnitChange('g')
    }
  }

  // ─── Handle beverage type change ──────────────────────────────────────────
  const handleBeverageChange = (id: string) => {
    setBeverageId(id)
    const preset = getBeveragePreset(id)
    if (preset) {
      // Recalculate with new ABV
      const volumeMl = shotSize?.volumeMl ?? 44.36
      const result = shotsToGrams({ shots: drinkCount, shotVolumeMl: volumeMl, abv: preset.abv })
      if (result) {
        const roundedGrams = roundTo(result.ethanolGrams, 2)
        onAmountChange(String(roundedGrams))
        onUnitChange('g')
      }
    }
  }

  // ─── Handle shot size change ───────────────────────────────────────────────
  const handleShotSizeChange = (id: string) => {
    setShotSizeId(id)
    const size = getShotSize(id)
    if (size) {
      // Recalculate with new volume
      const abv = beveragePreset?.abv ?? 40
      const result = shotsToGrams({ shots: drinkCount, shotVolumeMl: size.volumeMl, abv })
      if (result) {
        const roundedGrams = roundTo(result.ethanolGrams, 2)
        onAmountChange(String(roundedGrams))
        onUnitChange('g')
      }
    }
  }

  // ─── Handle drink unit toggle ──────────────────────────────────────────────
  const handleDrinkUnitToggle = (newUnit: 'shots' | 'drinks') => {
    setDrinkUnit(newUnit)
  }

  // Get the appropriate drink size label based on beverage type
  const getDrinkSizeLabel = () => {
    switch (drinkUnit) {
      case 'shots':
        return shotSize?.label ?? 'US shot (1.5 fl oz)'
      case 'drinks':
        // Different beverages have different "drink" definitions
        if (beverageId === 'beer') return '12 fl oz can/bottle'
        if (beverageId === 'wine') return '5 fl oz glass'
        if (beverageId === 'fortified-wine') return '3 fl oz glass'
        if (beverageId === 'spirits' || beverageId === 'high-proof') return shotSize?.label ?? 'US shot (1.5 fl oz)'
        return 'Standard serving'
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-primary/20 bg-primary/5 p-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Wine className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">Alcohol → Grams Calculator</span>
        <span className="text-xs text-neutral-content/60 ml-auto">
          <a
            href="/calculators/alcohol"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-primary transition-colors"
          >
            Full calculator
          </a>
        </span>
      </div>

      {/* Beverage & Drink Size selectors */}
      <div className="grid grid-cols-2 gap-3">
        {/* Beverage Type */}
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1 text-xs">
            <Wine className="h-3.5 w-3.5" />
            Beverage
          </Label>
          <Select
            value={beverageId}
            onChange={(e) => handleBeverageChange(e.target.value)}
            className="text-sm"
          >
            {BEVERAGE_PRESETS.filter(b => b.id !== 'custom').map((b) => (
              <option key={b.id} value={b.id}>
                {b.label} ({b.abv}%)
              </option>
            ))}
          </Select>
        </div>

        {/* Drink Size */}
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1 text-xs">
            <Beaker className="h-3.5 w-3.5" />
            Drink Size
          </Label>
          <Select
            value={shotSizeId}
            onChange={(e) => handleShotSizeChange(e.target.value)}
            className="text-sm"
          >
            {SHOT_SIZES.filter(s => s.id !== 'custom').map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {/* Drink count input */}
      <div className="space-y-1.5">
        <Label className="flex items-center justify-between">
          <span className="flex items-center gap-1 text-xs">
            <Scale className="h-3.5 w-3.5" />
            Number of {drinkUnit}
          </span>
          <div className="flex rounded-lg border border-base-300 overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => handleDrinkUnitToggle('shots')}
              className={`px-2 py-0.5 transition-colors ${
                drinkUnit === 'shots'
                  ? 'bg-primary text-primary-content'
                  : 'hover:bg-base-200'
              }`}
            >
              Shots
            </button>
            <button
              type="button"
              onClick={() => handleDrinkUnitToggle('drinks')}
              className={`px-2 py-0.5 transition-colors ${
                drinkUnit === 'drinks'
                  ? 'bg-primary text-primary-content'
                  : 'hover:bg-base-200'
              }`}
            >
              Drinks
            </button>
          </div>
        </Label>
        <Input
          type="number"
          min="0"
          step="0.5"
          value={drinkCount}
          onChange={(e) => handleDrinkCountChange(parseFloat(e.target.value) || 0)}
          placeholder="How many?"
          className="text-base"
        />
        <p className="text-[10px] text-neutral-content/60">
          {getDrinkSizeLabel()}
        </p>
      </div>

      {/* Result display */}
      {conversionResult && drinkCount > 0 && (
        <div className="rounded-lg bg-base-200/50 p-3 space-y-2">
          {/* Main result */}
          <div className="flex items-center justify-center gap-3">
            <span className="text-sm text-base-content/70">
              {drinkCount} {drinkUnit}
            </span>
            <ArrowRightLeft className="h-4 w-4 text-primary" />
            <span className="text-xl font-bold text-primary">
              {roundTo(conversionResult.ethanolGrams, 2)} g
            </span>
          </div>
          <p className="text-center text-[10px] text-neutral-content/60">
            of pure ethanol
          </p>

          {/* Standard drink equivalents */}
          <div className="pt-2 border-t border-base-300/50">
            <p className="text-[10px] text-neutral-content/60 mb-1">Standard drinks:</p>
            <div className="flex flex-wrap gap-1">
              {STANDARD_DRINKS.map((def) => {
                const equiv = conversionResult.standardDrinks[def.id]
                if (!equiv || equiv < 0.01) return null
                return (
                  <span
                    key={def.id}
                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-base-100 border border-base-300"
                  >
                    {roundTo(equiv, 1)}× {def.label.replace(' standard drink', '').replace(' unit', '')}
                  </span>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Info note */}
      <div className="flex items-start gap-2 text-[10px] text-neutral-content/60">
        <Info className="h-3 w-3 shrink-0 mt-0.5" />
        <p>
          Pure ethanol is tracked in grams. Formula: drinks × volume × (ABV ÷ 100) × {ETHANOL_DENSITY_G_PER_ML} g/mL.
          One US standard drink ≈ 14g.
        </p>
      </div>
    </div>
  )
}