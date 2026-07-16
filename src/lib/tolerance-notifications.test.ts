import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { estimateTolerance, toleranceHalfLifeDays } from '@/lib/analytics'
import { DoseLog } from '@/types'
import { DEFAULT_TOLERANCE_HALF_LIFE_DAYS } from '@/lib/analytics/tolerance-half-lives'

const createDose = (overrides: Partial<DoseLog> = {}): DoseLog => ({
  id: `dose_${Date.now()}_${Math.random()}`,
  substanceId: 'test',
  substanceName: 'Test Substance',
  categories: ['stimulants'],
  amount: 100,
  unit: 'mg',
  route: 'oral',
  timestamp: new Date().toISOString(),
  duration: null,
  notes: null,
  mood: null,
  setting: null,
  intensity: null,
  createdAt: new Date().toISOString(),
  ...overrides,
})

describe('Tolerance Estimation', () => {
  it('returns empty array for no doses', () => {
    const result = estimateTolerance([])
    expect(result).toHaveLength(0)
  })

  it('calculates tolerance for recent doses', () => {
    const threeDaysAgo = new Date()
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)

    const doses = [
      createDose({ substanceName: 'Caffeine', substanceId: 'caffeine', timestamp: threeDaysAgo.toISOString() }),
      createDose({ substanceName: 'Caffeine', substanceId: 'caffeine', timestamp: new Date().toISOString() }),
    ]

    const result = estimateTolerance(doses)
    expect(result).toHaveLength(1)
    expect(result[0].substanceName).toBe('Caffeine')
    expect(result[0].dosesLast30Days).toBe(2)
    expect(result[0].currentLevel).toBeGreaterThan(0)
  })

  it('returns baseline for old doses only', () => {
    const oldDate = new Date()
    oldDate.setDate(oldDate.getDate() - 100)

    const doses = [createDose({ timestamp: oldDate.toISOString() })]
    const result = estimateTolerance(doses)

    expect(result[0].level).toBe('baseline')
    expect(result[0].currentLevel).toBe(0)
    expect(result[0].daysToBaseline).toBe(0)
  })

  it('includes explanation in result', () => {
    const doses = [createDose({ timestamp: new Date().toISOString() })]
    const result = estimateTolerance(doses)
    expect(result[0].explanation).toBeDefined()
    expect(typeof result[0].explanation).toBe('string')
  })

  it('sorts by highest current tolerance first', () => {
    const now = new Date()
    const fiveDaysAgo = new Date(now)
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5)
    const oneDayAgo = new Date(now)
    oneDayAgo.setDate(oneDayAgo.getDate() - 1)

    const doses = [
      createDose({ substanceName: 'Substance A', timestamp: fiveDaysAgo.toISOString() }),
      createDose({ substanceName: 'Substance B', timestamp: oneDayAgo.toISOString() }),
      createDose({ substanceName: 'Substance B', timestamp: now.toISOString() }),
    ]

    const result = estimateTolerance(doses)
    // Substance B has more recent doses, should have higher tolerance
    expect(result[0].substanceName).toBe('Substance B')
  })
})

describe('Tolerance Half-Life Data', () => {
  it('has known substances with half-lives', () => {
    expect(toleranceHalfLifeDays('caffeine')).toBe(5)
    expect(toleranceHalfLifeDays('mdma')).toBe(30)
    expect(toleranceHalfLifeDays('lsd')).toBe(4)
    expect(toleranceHalfLifeDays('cannabis')).toBe(10)
    expect(toleranceHalfLifeDays('alcohol')).toBe(5)
  })

  it('falls back to default for unknown substances', () => {
    expect(toleranceHalfLifeDays('unknown-substance-xyz')).toBe(DEFAULT_TOLERANCE_HALF_LIFE_DAYS)
  })

  it('handles case-insensitive lookups', () => {
    expect(toleranceHalfLifeDays('Caffeine')).toBe(5)
    expect(toleranceHalfLifeDays('CAFFEINE')).toBe(5)
    expect(toleranceHalfLifeDays('  caffeine  ')).toBe(5)
  })

  it('handles substring matches', () => {
    expect(toleranceHalfLifeDays('Cannabis (Sativa)')).toBe(10)
    expect(toleranceHalfLifeDays('MDMA Crystals')).toBe(30)
  })
})

describe('Tolerance Notification Store', () => {
  // These tests verify the store structure - actual store tests
  // would require zustand testing utilities
  it('has correct default settings', () => {
    const { DEFAULT_SETTINGS } = require('@/store/tolerance-notification-store')
    expect(DEFAULT_SETTINGS.enabled).toBe(true)
    expect(DEFAULT_SETTINGS.notifyOnHigh).toBe(true)
    expect(DEFAULT_SETTINGS.notifyOnLow).toBe(false)
    expect(DEFAULT_SETTINGS.notifyOnBaseline).toBe(false)
    expect(DEFAULT_SETTINGS.notificationCooldownMinutes).toBe(1440)
    expect(DEFAULT_SETTINGS.checkIntervalMinutes).toBe(1440)
  })
})