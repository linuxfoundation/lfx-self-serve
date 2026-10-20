// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_AGENTS, MKTG_KIT_FAMILIES, MKTG_KIT_EXCLUDED_AGENT_IDS } from '@lfx-one/shared/constants';
import { expect } from '@playwright/test';
import { kitTest as test, openKit, setupKit } from './helpers/mktg-kit.helper';

test.describe('Marketing kit Agents tab', () => {
  test('groups the catalog in family/run order and preserves coming-soon gating', async ({ page }) => {
    await setupKit(page);
    await openKit(page, '/agents');
    for (const family of MKTG_KIT_FAMILIES.filter((family) => family.agentIds.length > 0)) {
      const group = page.getByTestId(`mktg-os-agents-family-${family.id}`);
      await expect(group).toContainText(family.name);
      if (family.runOrder) await expect(group).toContainText(family.runOrder);
    }
    await expect(page.getByTestId(/^mktg-os-agents-run-order-/)).toHaveCount(1);
    await expect(page.getByTestId('mktg-os-agents-run-order-positioning-brand')).toHaveText('Run in order: framework first, then the three that read it');
    await expect(page.getByTestId('mktg-os-agents-results').locator('section')).toHaveCount(5);
    await expect(page.getByTestId('mktg-os-agents-family-events')).toHaveCount(0);
    for (const agent of MKTG_AGENTS.filter((agent) => agent.status !== 'active' && !MKTG_KIT_EXCLUDED_AGENT_IDS.includes(agent.id))) {
      await expect(page.getByTestId(`mktg-os-agents-tile-${agent.id}`)).toBeDisabled();
      await expect(page.getByTestId(`mktg-os-agents-state-${agent.id}`)).toContainText('Coming soon');
    }
    const first = MKTG_KIT_FAMILIES[0];
    const buttons = page.getByTestId(`mktg-os-agents-family-${first.id}`).locator('button');
    await expect(buttons).toHaveCount(first.agentIds.length);
    await expect(buttons.nth(0)).toHaveAttribute('data-testid', `mktg-os-agents-tile-${first.agentIds[0]}`);
  });
  test('resolves from a neutral disabled state to the final catalog state', async ({ page }) => {
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    await setupKit(page, { loaded: true, hold });
    await openKit(page, '/agents');
    const tile = page.getByTestId('mktg-os-agents-tile-foundation-setup');
    await expect(tile).toBeDisabled();
    await expect(tile).toHaveAttribute('aria-label', 'Messaging Framework Agent — Resolving');
    await expect(page.getByTestId('mktg-os-agents-state-foundation-setup')).toContainText('—');
    release();
    await expect(tile).toBeEnabled();
    await expect(tile).toHaveAttribute('aria-label', 'Messaging Framework Agent — Live · Last run 16 Oct');
    await expect(page.getByTestId('mktg-os-agents-state-foundation-setup')).toContainText('Live · Last run 16 Oct');
  });
  test('matches the board state line and omits old marketplace controls and excluded agents', async ({ page }) => {
    await setupKit(page, { loaded: true });
    await openKit(page, '/agents');
    await expect(page.getByTestId('mktg-os-agents-search')).toHaveCount(0);
    await expect(page.getByTestId('mktg-os-agents-documents-link')).toHaveCount(0);
    await expect(page.getByTestId('mktg-os-agents-state-foundation-setup')).toContainText('Live · Last run 16 Oct');
    await expect(page.getByTestId('mktg-os-agents-state-boilerplates')).toContainText('Live · Last run 16 Oct');
    for (const id of [...MKTG_KIT_EXCLUDED_AGENT_IDS, 'member-360']) await expect(page.getByTestId(`mktg-os-agents-tile-${id}`)).toHaveCount(0);
    await expect(page.getByTestId('mktg-os-agents-results')).not.toContainText('generated');
  });
  test('a listing error leaves catalog availability honest but invents no last-run dates', async ({ page }) => {
    await setupKit(page, { status: 500 });
    await openKit(page, '/agents');
    await expect(page.getByTestId('mktg-os-agents-error')).toBeVisible();
    await expect(page.getByTestId('mktg-os-agents-state-foundation-setup')).toHaveText('Live');
  });
  test('opens an available agent without generating anything', async ({ page }) => {
    await setupKit(page);
    await openKit(page, '/agents');
    const first = MKTG_AGENTS.find((agent) => agent.status === 'active');
    expect(first).toBeDefined();
    if (!first) return;
    await page.getByTestId(`mktg-os-agents-tile-${first.id}`).click();
    await expect(page).toHaveURL(new RegExp(`/mktg-os-agents/${first.id}\\?project=`));
    await expect(page.getByTestId('mktg-agent-run-page')).toBeVisible();
  });
});
