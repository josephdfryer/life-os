import { expect, test } from '@playwright/test'

test.describe('Home control plane', () => {
  test('shell navigates across Today, Stream, Inbox, Intelligence, Automation, and Admin', async ({ page }) => {
    await page.goto('/stream')
    await expect(page.getByRole('heading', { name: 'Stream' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Life OS sections' })).toContainText('Inbox')

    await page.getByRole('link', { name: 'Inbox', exact: true }).click()
    await expect(page).toHaveURL(/\/inbox$/)
    await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible()
    await expect(page.getByText('Legacy queues · read only')).toBeVisible()

    await page.getByRole('link', { name: 'Intelligence', exact: true }).click()
    await expect(page).toHaveURL(/\/intelligence$/)
    await expect(page.getByRole('heading', { name: 'Intelligence' })).toBeVisible()

    await page.getByRole('link', { name: 'Automation', exact: true }).click()
    await expect(page).toHaveURL(/\/automation$/)
    await expect(page.getByRole('heading', { name: 'Automation' })).toBeVisible()

    await page.getByRole('link', { name: 'Admin', exact: true }).click()
    await expect(page).toHaveURL(/\/admin$/)
    await expect(page.getByRole('heading', { name: 'Admin' })).toBeVisible()
  })

  test('stream exposes filters and a stable unavailable state without a proxy key', async ({ page }) => {
    await page.goto('/stream')
    await expect(page.getByRole('tablist', { name: 'Filter by type' })).toBeVisible()
    await expect(page.getByPlaceholder('Search what happened…')).toBeVisible()
    await expect(page.getByText('Stream unavailable.')).toBeVisible()
  })

  test('admin workspace tab exposes membership without edit controls', async ({ page }) => {
    await page.goto('/admin?tab=workspace')
    await expect(page.getByRole('region', { name: 'E2E Life OS' })).toBeVisible()
    await expect(page.getByText('active members')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Legacy Persons admin ↗' })).toBeVisible()
  })

  test('admin connection tabs expose health without token fields', async ({ page }) => {
    await page.goto('/admin?tab=calendar')
    await expect(page.getByRole('heading', { name: 'Calendar connections' })).toBeVisible()
    await expect(page.getByText('No connections configured.')).toBeVisible()
    await page.goto('/admin?tab=gmail')
    await expect(page.getByRole('heading', { name: 'Gmail connections' })).toBeVisible()
  })

  test('admin exposes read-only access and automation surfaces', async ({ page }) => {
    await page.goto('/admin?tab=access')
    await expect(page.getByRole('heading', { name: 'Roles and scopes' })).toBeVisible()
    await page.goto('/admin?tab=rules')
    await expect(page.getByRole('heading', { name: 'Rules' })).toBeVisible()
  })

  test('automation explains authority, live capabilities, and rule history', async ({ page }) => {
    await page.goto('/automation')
    await expect(page.getByRole('heading', { name: 'Authority belongs to the action' })).toBeVisible()
    await expect(page.getByText('Observe', { exact: true })).toBeVisible()
    await expect(page.getByText('Safe auto', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Review', { exact: true })).toBeVisible()
    await expect(page.getByText('Confirm', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'What the system is allowed to do' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Live capabilities' })).toBeVisible()
    await expect(page.getByText('inbox.stage', { exact: true })).toBeVisible()
  })

  test('intelligence labels claims and exposes their evidence boundary', async ({ page }) => {
    await page.goto('/intelligence')
    await expect(page.getByRole('heading', { name: 'What kind of truth is this?' })).toBeVisible()
    await expect(page.getByText('Observed', { exact: true })).toBeVisible()
    await expect(page.getByText('Inferred', { exact: true })).toBeVisible()
    await expect(page.getByText('Declared', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Tension', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'What deserves attention' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Useful, never unquestionable' })).toBeVisible()
  })

  test('inbox exposes source, primitive, confidence, and age filters', async ({ page }) => {
    await page.goto('/inbox')
    await expect(page.getByLabel('Source')).toBeVisible()
    await expect(page.getByLabel('Primitive')).toBeVisible()
    await expect(page.getByLabel('Confidence')).toBeVisible()
    await expect(page.getByLabel('Age')).toBeVisible()
  })
})
