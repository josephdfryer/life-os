import { expect, test } from '@playwright/test'

test.describe('Home control plane', () => {
  test('shell navigates across the Home control-plane surfaces', async ({ page }) => {
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

    await page.getByRole('link', { name: 'Connections', exact: true }).click()
    await expect(page).toHaveURL(/\/connections$/)
    await expect(page.getByRole('heading', { name: 'Connections' })).toBeVisible()

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

  test('admin workspace tab owns approved sign-in controls', async ({ page }) => {
    await page.goto('/admin?tab=workspace')
    await expect(page.getByRole('region', { name: 'E2E Life OS' })).toBeVisible()
    await expect(page.getByText('active members')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Approved emails' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Approve an email' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Legacy Persons admin/ })).toHaveCount(0)
  })

  test('connections hub exposes every integration without token fields', async ({ page }) => {
    await page.goto('/connections')
    await expect(page.getByRole('heading', { name: 'Google Calendar' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Gmail' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Era' })).toBeVisible()
    await expect(page.getByText(/accessToken|refreshToken/i)).toHaveCount(0)
  })

  test('admin exposes writable access and API-key surfaces', async ({ page }) => {
    await page.goto('/admin?tab=access')
    await expect(page.getByRole('heading', { name: 'Roles' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'New role' })).toBeVisible()
    await page.goto('/admin?tab=api-keys')
    await expect(page.getByRole('heading', { name: 'API keys' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'New API key' })).toBeVisible()
  })

  test('admin system health exposes spine failures and durable queue state', async ({ page }) => {
    await page.goto('/admin?tab=system')
    await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible()
    await expect(page.getByLabel('System health metrics')).toContainText('GraphEvents')
    await expect(page.getByLabel('System health metrics')).toContainText('Receipts')
    await expect(page.getByText('interaction.created', { exact: true })).toBeVisible()
    await expect(page.getByText('automation · failed · 2')).toBeVisible()
  })

  test('automation explains authority, live capabilities, and rule history', async ({ page }) => {
    await page.goto('/automation')
    await expect(page.getByRole('heading', { name: 'Authority belongs to the action' })).toBeVisible()
    await expect(page.getByText('Observe', { exact: true })).toBeVisible()
    await expect(page.getByText('Safe auto', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeVisible()
    await expect(page.getByText('Confirm', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'What the system is allowed to do' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Live capabilities' })).toBeVisible()
    await expect(page.getByText('inbox.stage', { exact: true })).toBeVisible()
    for (const trigger of [
      'person.create',
      'person.update',
      'plan.create',
      'plan.update',
      'event.create',
      'event.update',
      'place.note.create',
      'place.favorite.toggle',
      'group.create',
      'group.update',
      'item.create',
      'item.update',
      'state.record',
    ]) {
      await expect(page.getByText(trigger, { exact: true })).toBeVisible()
    }
    for (const action of ['interaction_set_field', 'add_tag', 'plan_set_status', 'event_set_field', 'item_set_field', 'state_record']) {
      await expect(page.getByText(action, { exact: true })).toBeVisible()
    }
    const versionedRule = page.locator('article.automation-rule-card').filter({ has: page.getByRole('heading', { name: 'Stage trusted messages' }) })
    await expect(versionedRule.getByText('Definition v3')).toBeVisible()
    await versionedRule.getByText('Run history', { exact: true }).click()
    await expect(versionedRule.getByText('v2 · current v3 · depth 1')).toBeVisible()
  })

  test('intelligence labels claims and exposes their evidence boundary', async ({ page }) => {
    await page.goto('/intelligence')
    await expect(page.getByRole('heading', { name: 'What kind of truth is this?' })).toBeVisible()
    await expect(page.getByText('Observed', { exact: true })).toBeVisible()
    await expect(page.getByText('Inferred', { exact: true })).toBeVisible()
    await expect(page.getByText('Declared', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Tension', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'What deserves attention' })).toBeVisible()
    await expect(page.getByText('Snapshot v1')).toBeVisible()
    await expect(page.getByText('A declared relationship intention has gone quiet.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Snapshot history' })).toBeVisible()
    await expect(page.getByText('1 saved reading')).toBeVisible()
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
