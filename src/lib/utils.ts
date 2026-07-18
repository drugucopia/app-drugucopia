import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { gramsToDrinks } from './calculators/alcohol'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export interface FormattedDoseAmount {
  amount: string
  unit: string
  alcoholEquivalent?: string
}

export function formatDoseAmount(
  amount: number,
  unit: string,
  substanceName?: string
): FormattedDoseAmount {
  // Handle micrograms (μg) - convert to mg if >= 1000
  if (unit === 'μg' || unit === 'ug' || unit === 'mcg') {
    if (amount >= 1000) {
      const converted = amount / 1000
      const formatted = converted % 1 === 0 ? converted.toString() : converted.toFixed(2).replace(/\.?0+$/, '')
      return { amount: formatted, unit: 'mg' }
    }
    return { amount: amount.toString(), unit }
  }
  
  // Handle milligrams (mg) - convert to g if >= 1000
  if (unit === 'mg') {
    if (amount >= 1000) {
      const converted = amount / 1000
      const formatted = converted % 1 === 0 ? converted.toString() : converted.toFixed(2).replace(/\.?0+$/, '')
      return { amount: formatted, unit: 'g' }
    }
    return { amount: amount.toString(), unit }
  }
  
  // For other units (g, ml, tabs, etc.), return as-is
  const result: FormattedDoseAmount = { amount: amount.toString(), unit }
  
  // Add alcohol equivalent for alcohol doses in grams
  if (substanceName?.toLowerCase() === 'alcohol' && unit === 'g') {
    const drinks = gramsToDrinks(amount)
    if (drinks) {
      const usShots = drinks.shots.us
      const usStandard = drinks.standardDrinks.us
      const parts: string[] = []
      if (usShots > 0) parts.push(`${usShots} US shots`)
      if (usStandard > 0 && usStandard !== usShots) parts.push(`${usStandard} US std drinks`)
      if (parts.length > 0) {
        result.alcoholEquivalent = `≈ ${parts.join(' / ')}`
      }
    }
  }
  
  return result
}
