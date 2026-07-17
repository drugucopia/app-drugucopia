import { test, expect } from '@playwright/test'

test.describe('Per-Substance Tolerance Notifications E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
    await page.waitForSelector('h1:has-text("Settings")')
  })

  test('global tolerance notification toggles are present with correct initial states', async ({ page }) => {
    // All three global toggle sections should be present
    await expect(page.locator('label:has-text("High / Very High")').first()).toBeVisible()
    await expect(page.locator('label:has-text("Low / Moderate")').first()).toBeVisible()
    await expect(page.locator('label:has-text("Baseline recovered")').first()).toBeVisible()
    
    // Each should have a button showing On/Off state
    await expect(page.locator('label:has-text("High / Very High") >> button').first()).toBeVisible()
    await expect(page.locator('label:has-text("Low / Moderate") >> button').first()).toBeVisible()
    await expect(page.locator('label:has-text("Baseline recovered") >> button').first()).toBeVisible()
    
    // Default states: High=On, Low=Off, Baseline=Off
    await expect(page.locator('label:has-text("High / Very High") >> button').first()).toHaveText('On')
    await expect(page.locator('label:has-text("Low / Moderate") >> button').first()).toHaveText('Off')
    await expect(page.locator('label:has-text("Baseline recovered") >> button').first()).toHaveText('Off')
  })

  test('Substance Selection section is present', async ({ page }) => {
    const substanceSelectionButton = page.locator('button:has-text("Substance Selection")')
    await expect(substanceSelectionButton).toBeVisible()
    await expect(substanceSelectionButton).toContainText('Substance Selection')
  })

  test('Substance Selection can be expanded to show search', async ({ page }) => {
    const substanceSelectionButton = page.locator('button:has-text("Substance Selection")')
    await substanceSelectionButton.click({ force: true })
    
    const searchInput = page.locator('input[placeholder="Search substances..."]').first()
    await expect(searchInput).toBeVisible()
  })

  test('Substance Selection search filters results', async ({ page }) => {
    const substanceSelectionButton = page.locator('button:has-text("Substance Selection")')
    await substanceSelectionButton.click({ force: true })
    
    const searchInput = page.locator('input[placeholder="Search substances..."]').first()
    await searchInput.fill('caffeine')
    await expect(page.locator('text=Caffeine').first()).toBeVisible()
    
    await searchInput.fill('alcohol')
    await expect(page.locator('text=Alcohol').first()).toBeVisible()
  })

  test('caffeine substance row exists in search results', async ({ page }) => {
    const substanceSelectionButton = page.locator('button:has-text("Substance Selection")')
    await substanceSelectionButton.click({ force: true })
    
    const searchInput = page.locator('input[placeholder="Search substances..."]').first()
    await searchInput.fill('caffeine')
    
    const caffeineLabel = page.locator('label[for="substance-caffeine"]')
    await expect(caffeineLabel).toContainText('Caffeine')
  })

  test('Test Check Now button is present', async ({ page }) => {
    await expect(page.locator('button:has-text("Test Check Now")')).toBeVisible()
  })
})

test.describe('Cross-tab sync for tolerance notifications', () => {
  test('settings are loaded from localStorage on page load', async ({ page, context }) => {
    // Open first tab and enable High
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
    await page.waitForSelector('h1:has-text("Settings")')
    
    const highToggle = page.locator('label:has-text("High / Very High") >> button').first()
    await highToggle.click({ force: true })
    await expect(highToggle).toHaveText('On')
    
    // Open second tab
    const page2 = await context.newPage()
    await page2.goto('/settings')
    await page2.waitForLoadState('networkidle')
    await page2.waitForSelector('h1:has-text("Settings")')
    
    // Verify setting loaded from localStorage
    await expect(page2.locator('label:has-text("High / Very High") >> button').first()).toHaveText('On')
    
    await page2.close()
  })
})