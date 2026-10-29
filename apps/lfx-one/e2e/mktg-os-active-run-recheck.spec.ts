// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { activeRunConfirmDialog } from './helpers/mktg-os-confirm-dialog.helper';
import { BRAND_KIT_INTAKE } from '../../../packages/shared/src/constants/mktg-run.constants';
import { LINKEDIN_API } from '../../../packages/shared/src/constants/linkedin-post.constants';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { setupFreshSources } from './helpers/mktg-os-sources.helper';
import { openLinkedin, setupLinkedin } from './helpers/mktg-linkedin.helper';
import {
  openMember360,
  setupMember360,
  selectMember360Option,
  stubMember360Progress,
  member360Progress,
  MEMBER_360_DOCUMENT_ID,
} from './helpers/member-360.helper';

test.use({ video: 'on', timezoneId: 'UTC' });

test('returns an accepted catalog recheck to editable Sources when polling is denied', async ({ page }, info) => {
  await suppressCookieBanner(page);
  const sources = await setupFreshSources(page);
  let accept = false;
  await page.route(`**${BRAND_KIT_INTAKE.endpoints.generate}`, (route) => {
    if (accept) return route.fallback();
    return route.fulfill({
      status: 409,
      json: {
        code: 'MKTG_RUN_ACTIVE',
        message: 'A run is in progress.',
        activeRunId: 'b'.repeat(64),
        state: 'writing',
        agentKey: BRAND_KIT_INTAKE.agentId,
        documentId: 'living',
        startedBy: 'Synthetic writer',
        startedByViewer: true,
        startedAt: '2026-10-19T12:00:00Z',
      },
    });
  });
  await page.route(`**${BRAND_KIT_INTAKE.endpoints.result}`, (route) => route.fulfill({ status: 403, json: { code: 'FORBIDDEN' } }));
  await sources.open();
  await page.getByTestId('mktg-run-start').getByRole('button').click();
  await expect(activeRunConfirmDialog(page)).toContainText('Started 19 Oct 2026, 12:00.');
  accept = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(activeRunConfirmDialog(page)).toHaveCount(0);
  await expect(
    page.getByText('The original start could not be confirmed or replayed safely. Check Documents, then review your sources before trying again.', {
      exact: true,
    })
  ).toBeVisible();
  await expect(page.getByTestId('mktg-run-sources')).toBeVisible();
  await expect(page.getByTestId('mktg-run-start').getByRole('button')).toBeEnabled();
  expect(sources.generated).toHaveLength(3);
  await page.screenshot({ path: info.outputPath('recheck-denied-editable-intake.png'), fullPage: true });
});

for (const surface of ['catalog', 'linkedin', 'member'] as const) {
  for (const outcome of ['fresh-conflict', 'started'] as const) {
    test(`${surface} guard paints neutrally and rechecks on focus: ${outcome}`, async ({ page }, info) => {
      await suppressCookieBanner(page);
      let open: () => Promise<void>;
      if (surface === 'catalog') open = (await setupFreshSources(page)).open;
      else if (surface === 'linkedin') {
        await setupLinkedin(page, { saved: true });
        open = () => openLinkedin(page);
      } else {
        await setupMember360(page);
        await stubMember360Progress(page, () => member360Progress('writing'));
        open = () => openMember360(page);
      }
      const { endpoint, agentKey, documentId, submit } = {
        catalog: { endpoint: BRAND_KIT_INTAKE.endpoints.generate, agentKey: 'brand-kit', documentId: 'living', submit: 'mktg-run-start' },
        linkedin: { endpoint: `${LINKEDIN_API}/generate`, agentKey: 'linkedin-post', documentId: 'run-' + 'a'.repeat(24), submit: 'mktg-linkedin-draft' },
        member: { endpoint: '/api/mktg-agents/member-360/generate', agentKey: 'member-360', documentId: MEMBER_360_DOCUMENT_ID, submit: 'member-360-run' },
      }[surface];
      const bodies: Record<string, unknown>[] = [];
      let focusRead = false;
      let release: () => void = () => undefined;
      const delayed = new Promise<void>((done) => {
        release = done;
      });
      await page.route(`**${endpoint}`, async (route) => {
        bodies.push(route.request().postDataJSON());
        if (bodies.length === 2) await delayed;
        if (focusRead && outcome === 'started') {
          if (surface === 'member')
            return route.fulfill({ json: { sessionId: 'synthetic-new', ownerToken: 'synthetic-proof', runId: 'd'.repeat(64), documentId } });
          return route.fallback();
        }
        return route.fulfill({
          status: 409,
          json: {
            code: 'MKTG_RUN_ACTIVE',
            message: 'A run is in progress.',
            activeRunId: (focusRead ? 'c' : 'b').repeat(64),
            state: 'writing',
            agentKey,
            documentId,
            startedBy: 'Synthetic writer',
            startedByViewer: focusRead,
            startedAt: `2026-10-19T${focusRead ? '13' : '12'}:00:00Z`,
          },
        });
      });
      await open();
      if (surface === 'linkedin') await page.getByTestId('mktg-linkedin-content-text').locator('textarea').fill('Synthetic retained source');
      if (surface === 'member') await selectMember360Option(page, 'member-360-compare', 'No comparison');
      await page.getByTestId(submit).getByRole('button').click();
      const hostTestId = { catalog: undefined, linkedin: 'mktg-linkedin-active-run-confirm', member: 'member-360-active-run-confirm' }[surface];
      const dialog = activeRunConfirmDialog(page, hostTestId);
      await expect(dialog).toContainText('Checking the active run…');
      await expect(dialog.getByRole('button', { name: 'Discard and start over' })).toBeDisabled();
      const originalNode = await dialog.elementHandle();
      await page.screenshot({ path: info.outputPath('neutral-dialog.png'), fullPage: true });
      release();
      await expect(dialog).toContainText('Started 19 Oct 2026, 12:00.');
      focusRead = true;
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      if (outcome === 'fresh-conflict') {
        await expect(dialog).toContainText('Started 19 Oct 2026, 13:00.');
        expect(await originalNode?.evaluate((node) => node.isConnected)).toBe(true);
        await expect(dialog.getByRole('button', { name: 'Discard and start over' })).toBeEnabled();
      } else {
        await expect(dialog).toHaveCount(0);
        await expect(page.getByText('The earlier run has finished — yours started.', { exact: true })).toBeVisible();
      }
      expect(bodies.length).toBeGreaterThanOrEqual(3);
      for (const body of bodies) {
        expect(body).toEqual(bodies[0]);
        expect(body).not.toHaveProperty('discard');
      }
      await page.screenshot({ path: info.outputPath('settled-dialog.png'), fullPage: true });
    });
  }
}
