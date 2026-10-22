// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect } from '@playwright/test';
import { MKTG_KIT_FAMILIES, MKTG_DOCUMENT_TYPES, MKTG_AGENTS, MKTG_AGENT_INTAKES } from '../../../packages/shared/src/constants';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { kitTest as test, KIT_PROJECT, openKit, setupKit } from './helpers/mktg-kit.helper';

test.describe('Marketing family content', () => {
  test.beforeEach(async ({ page }) => {
    await suppressCookieBanner(page);
  });
  for (const loaded of [false, true]) {
    for (const mount of ['project', 'foundation'] as const) {
      test(`${mount}: every eligible living row opens a fresh intake without generation (loaded=${loaded})`, async ({ page }) => {
        await setupKit(page, { loaded, approvedFramework: loaded });
        const family = MKTG_KIT_FAMILIES.find((entry) => entry.id === 'positioning-brand');
        if (!family) throw new Error('Missing registered synthetic family');
        const eligible = family.assets.flatMap((asset) => {
          const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === asset.agentKey && entry.kind === 'living');
          const agent = MKTG_AGENTS.find((entry) => entry.id === type?.catalogAgentId && entry.status === 'active');
          return agent && MKTG_AGENT_INTAKES[agent.id] ? [{ asset, agent }] : [];
        });
        const writes: string[] = [];
        page.on('request', (request) => {
          if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/mktg-')) writes.push(request.url());
        });
        for (const { asset, agent } of eligible) {
          await openKit(page, '/families/positioning-brand', mount);
          const row = page.getByTestId(`mktg-family-asset-${asset.id}`);
          if (!loaded && MKTG_AGENT_INTAKES[agent.id].attachments?.some((attachment) => attachment.format === 'json' && !attachment.optional)) {
            await expect(row.getByTestId(`mktg-family-run-${asset.id}`).getByRole('button')).toBeDisabled();
            continue;
          }
          const action = row.getByTestId(`mktg-family-run-${asset.id}`).getByRole('link');
          await expect(action).toContainText('Run ' + (asset.runName ?? asset.label));
          const href = new URL((await action.getAttribute('href')) ?? '', page.url());
          expect(href.searchParams.get('mode')).toBe('new');
          expect(href.searchParams.get('project')).toBe(KIT_PROJECT.slug);
          for (const selector of ['questions', 'generation', 'revision', 'run']) expect(href.searchParams.has(selector)).toBe(false);
          await action.click();
          await expect(page.getByTestId('mktg-run-sources')).toBeVisible();
          expect(new URL(page.url()).pathname).toContain('/' + agent.id);
        }
        expect(writes).toEqual([]);
        await openKit(page, '/families/positioning-brand', mount);
        await page.screenshot({ path: test.info().outputPath(`family-row-run-${mount}-${loaded}.png`), fullPage: true });
      });
    }
  }

  test('opens from the kit, shows stored versions, leaves exports inert and offers no rebuild', async ({ page }) => {
    await setupKit(page, { loaded: true });
    await openKit(page);
    await page.getByTestId('mktg-kit-family-link-positioning-brand').click();
    await expect(page.getByTestId('mktg-family-title')).toHaveText('Positioning & brand');
    await expect(page).toHaveTitle('Positioning & brand · LFX');
    await expect(page.getByTestId('mktg-family-asset-messaging-framework')).toContainText('Draft');
    await expect(page.getByTestId('mktg-family-current-messaging-framework')).toContainText('v3');
    await expect(page.getByTestId('mktg-family-current-messaging-framework')).not.toContainText('v12');
    await expect(page.getByTestId('mktg-family-asset-boilerplates')).toContainText('Draft');
    await expect(page.getByTestId('mktg-family-run-messaging-framework').getByRole('link')).toHaveAttribute('href', /mode=new/);
    await expect(page.getByTestId('mktg-family-run-boilerplates').getByRole('button')).toBeDisabled();
    await expect(page.getByTestId('mktg-family-asset-icp')).toHaveCount(0);
    await expect(page.getByTestId('mktg-family-sources')).toContainText('Sources read on the last run: project.example, Synthetic plan.');
    await expect(page.getByTestId('mktg-family-sources')).toContainText('2 sources failed: README: Timed out; Analyst note: Login required.');
    await expect(page.getByTestId('mktg-family-approve')).toContainText('Any project writer approves an asset in October.');
    for (const id of ['family-export-pdf', 'family-export-slides']) {
      await expect(page.getByTestId(id).getByRole('button')).toBeDisabled();
    }
    // Nothing is stale, so the header offers no rebuild.
    await expect(page.getByTestId('mktg-family-rebuild')).toHaveCount(0);
    await expect(page.locator('lfx-mktg-family-export-actions')).toHaveAttribute('data-family-id', 'positioning-brand');
    await expect(page.getByTestId('mktg-family-exports')).toContainText('Coming soon');
  });
  test('stored asset opens its document view, preserving project scope', async ({ page }) => {
    await setupKit(page, { loaded: true });
    await openKit(page, '/families/positioning-brand');
    await page.getByTestId('mktg-family-open-messaging-framework').click();
    await expect(page).toHaveURL(/\/documents\/foundation-message\/living\?project=kit-synthetic-project/);
    await expect(page.getByTestId('mktg-document-view-page')).toBeVisible();
    await expect(page.getByTestId('mktg-framework-view')).toBeVisible();
    await expect(page.getByTestId('mktg-breadcrumb-link-0')).toContainText('Synthetic Kit Project');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Messaging framework');
    await page.getByTestId('mktg-breadcrumb-link-1').click();
    await expect(page.getByTestId('mktg-family-title')).toHaveText('Positioning & brand');
    await page.getByTestId('mktg-family-open-messaging-framework').click();
    await page.getByTestId('mktg-breadcrumb-link-0').click();
    await expect(page).toHaveURL(/\/mktg-os-agents\?project=kit-synthetic-project$/);
    await expect(page.getByTestId('mktg-kit-page')).toBeVisible();
  });
  test('runs the family’s next agent without making a live generation request', async ({ page }) => {
    await setupKit(page);
    await openKit(page, '/families/positioning-brand');
    await expect(page.getByTestId('mktg-family-run-next')).toHaveText('Next: Messaging framework');
    await page.getByTestId('mktg-family-run').getByRole('link').click();
    await expect(page).toHaveURL(/\/mktg-os-agents\/foundation-setup\?project=/);
    await expect(page.getByTestId('mktg-run-sources')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('mode')).toBe('new');
  });
  test('empty living assets stay Missing, not fabricated Drafts', async ({ page }) => {
    await setupKit(page);
    await openKit(page, '/families/positioning-brand');
    await expect(page.getByTestId('mktg-family-asset-brand-kit')).toContainText('Not run yet');
    await expect(page.getByTestId('mktg-family-open-brand-kit')).toHaveCount(0);
    await expect(page.getByTestId('mktg-family-sources')).toHaveCount(0);
    for (const id of ['faq', 'boilerplates', 'brand-kit']) {
      await expect(page.getByTestId(`mktg-family-run-${id}`).getByRole('button')).toBeDisabled();
      await expect(page.getByTestId(`mktg-family-run-${id}`).getByRole('link')).toHaveCount(0);
    }
    await expect(page.getByTestId('mktg-family-run-messaging-framework').getByRole('link')).toHaveAttribute('href', /mode=new/);
  });
  test('unbuilt families have their description and empty state', async ({ page }) => {
    await setupKit(page);
    await openKit(page, '/families/events');
    await expect(page.getByTestId('mktg-family-coming-soon')).toBeVisible();
    await expect(page.getByTestId('mktg-family-page')).toContainText('Event calendar, with LFX Events.');
    await expect(page.getByTestId('mktg-family-assets')).toHaveCount(0);
  });
  test('loading does not claim assets are missing', async ({ page }) => {
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    await setupKit(page, { loaded: true, hold });
    await openKit(page, '/families/positioning-brand');
    await expect(page.getByTestId('mktg-family-loading')).toBeVisible();
    await expect(page.getByTestId('mktg-family-assets')).toHaveCount(0);
    release();
    await expect(page.getByTestId('mktg-family-asset-messaging-framework')).toContainText('Draft');
  });
  test('source details have honest loading and absent-report states', async ({ page }) => {
    let release = () => {};
    const revisionHold = new Promise<void>((resolve) => {
      release = resolve;
    });
    await setupKit(page, { loaded: true, report: false, revisionHold });
    await openKit(page, '/families/positioning-brand');
    await expect(page.getByTestId('mktg-family-sources-loading')).toBeVisible();
    await expect(page.getByTestId('mktg-family-approve')).toBeVisible();
    release();
    await expect(page.getByTestId('mktg-family-sources-loading')).toBeEmpty();
    await expect(page.getByTestId('mktg-family-sources')).toHaveCount(0);
  });
  test('source read failures retry without inventing sources or hiding assets', async ({ page }) => {
    const options = { loaded: true, revisionStatus: 500 };
    await setupKit(page, options);
    await openKit(page, '/families/positioning-brand');
    await expect(page.getByTestId('mktg-family-sources-error')).toBeVisible();
    await expect(page.getByTestId('mktg-family-asset-boilerplates')).toContainText('Draft');
    options.revisionStatus = 200;
    await page.getByTestId('mktg-family-sources-retry').getByRole('button').click();
    await expect(page.getByTestId('mktg-family-sources')).toContainText('Sources read on the last run');
  });
  test('failed read has a separate error state', async ({ page }) => {
    await setupKit(page, { status: 500 });
    await openKit(page, '/families/positioning-brand');
    await expect(page.getByTestId('mktg-family-error')).toContainText('could not be loaded');
    await expect(page.getByTestId('mktg-family-assets')).toHaveCount(0);
    await page.getByTestId('mktg-family-error-retry').getByRole('button').click();
    await expect(page.getByTestId('mktg-family-error')).toBeVisible();
  });
  test('unknown family renders the not-found state', async ({ page }) => {
    await setupKit(page);
    await openKit(page, '/families/not-catalogued');
    await expect(page.getByTestId('mktg-family-not-found')).toBeVisible();
  });
  test('run assets show run dates without a current revision version', async ({ page }) => {
    await setupKit(page, { loaded: true });
    await openKit(page, '/families/social-community');
    await expect(page.getByTestId('mktg-family-current-linkedin-post')).not.toContainText('v1');
    await expect(page.getByTestId('mktg-family-asset-linkedin-post')).toContainText('1 this month');
  });
  test('labels a disabled Run, including a pending catalog agent, with no rebuild outside Positioning', async ({ page }) => {
    await setupKit(page);
    await openKit(page, '/families/website-web');
    await expect(page.getByTestId('mktg-family-run').getByRole('button')).toBeDisabled();
    await expect(page.getByTestId('mktg-family-run-unavailable')).toHaveText('Coming soon');
    await expect(page.getByTestId('mktg-family-rebuild')).toHaveCount(0);
    await openKit(page, '/families/member-sponsor');
    await expect(page.getByTestId('mktg-family-run').getByRole('button')).toBeDisabled();
    await expect(page.getByTestId('mktg-family-run').getByRole('button')).toHaveAccessibleName('Run Member 360 (coming soon)');
    await expect(page.getByTestId('mktg-family-run-unavailable')).toHaveText('Coming soon — the Member 360 page is on its way');
    await expect(page.getByTestId('mktg-family-run-coming-soon')).toHaveCount(0);
    await expect(page.getByTestId('mktg-family-asset-member-360')).toBeVisible();
  });
  test('no access does not disclose asset states', async ({ page }) => {
    await setupKit(page, { writer: false });
    await openKit(page, '/families/positioning-brand');
    await expect(page.getByTestId('mktg-family-error')).toContainText('write access');
    await expect(page.getByTestId('mktg-family-assets')).toHaveCount(0);
  });
});
