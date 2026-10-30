// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, Route, test } from '@playwright/test';
import { LINKEDIN_API } from '@lfx-one/shared/constants';
import { LINKEDIN_RECORDED_CASES } from '@lfx-one/shared/constants/linkedin-post-recorded.fixture';
import { LINKEDIN_RECORDED_PROGRESS } from '@lfx-one/shared/constants/linkedin-post-questions.fixture';
import { json, LINKEDIN_RUN_TIMEOUT, openLinkedin, setupLinkedin } from './helpers/mktg-linkedin.helper';

// openLinkedin calls suppressCookieBanner(page) before every navigation.
test.describe('Marketing OS LinkedIn structure and states', () => {
  test('recorded public feed and standalone questions expose main component test ids, never reasoning', async ({ page }, info) => {
    const recorded = LINKEDIN_RECORDED_CASES.find((value) => value.name.endsWith('/first-run-setup'));
    if (!recorded) throw new Error('Missing recorded gap fixture');
    await setupLinkedin(page, { recordedCase: 'first-run-setup', questions: true, live: true });
    await openLinkedin(page);
    for (const [key, value] of Object.entries(recorded.envelope.profile.about))
      await page.getByTestId(`mktg-linkedin-profile-${key}`).locator('input, textarea').fill(value);
    await page.getByTestId('mktg-linkedin-profile-tone').locator('input').fill(recorded.envelope.profile.voice.tone);
    await page.getByTestId('mktg-linkedin-save-profile').getByRole('button').click();
    await page.getByTestId('mktg-linkedin-source-url').click();
    await expect(page.getByTestId('mktg-linkedin-source-hint')).toContainText('Paste the public link; the agent reads the page.');
    await page.getByTestId('mktg-linkedin-source-text').click();
    await page.getByTestId('mktg-linkedin-content-text').locator('textarea').fill('Synthetic release notes.');
    await page.getByTestId('mktg-linkedin-draft').getByRole('button').click();
    const event = LINKEDIN_RECORDED_PROGRESS.find((value) => value.content.type === 'text');
    const text = event && 'data' in event.content && typeof event.content.data === 'string' ? event.content.data.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    expect(text).not.toBe('');
    await expect(page.getByTestId('mktg-document-view-run')).toContainText(text, { timeout: LINKEDIN_RUN_TIMEOUT });
    await expect(page.getByTestId('mktg-document-view-run')).not.toContainText('PRIVATE_REASONING_MARKER');
    await page.screenshot({ path: info.outputPath('recorded-public-feed.png'), fullPage: true });
    await expect(page.getByTestId('mktg-linkedin-questions')).toBeVisible({ timeout: LINKEDIN_RUN_TIMEOUT });
    await expect(page.getByTestId('mktg-run-questions')).toBeVisible();
    await expect(page.getByTestId('mktg-linkedin-post-form')).toHaveCount(0);
    await expect(page.getByTestId('mktg-linkedin-breadcrumb')).toContainText('Social & community');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb', exact: true })).toHaveCount(1);
    await expect(page.getByTestId('mktg-breadcrumb-link-1')).toHaveAttribute('href', /\/families\/social-community\?project=/);
    await expect(page.getByTestId('mktg-breadcrumb-link-0')).not.toHaveAttribute('href', /\/families\//);
    await page.screenshot({ path: info.outputPath('standalone-profile-questions.png'), fullPage: true });
  });
  test('profile loading is a neutral state until the read settles', async ({ page }, info) => {
    await setupLinkedin(page);
    let held: Route | undefined;
    await page.route(`**${LINKEDIN_API}/profile`, (route) => {
      held = route;
    });
    await openLinkedin(page);
    await expect(page.getByTestId('mktg-linkedin-loading')).toBeVisible();
    await expect(page.getByTestId('mktg-linkedin-profile-form')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('loading.png'), fullPage: true });
    if (held) await json(held, { profile: null });
  });
  test('no write access shows no intake and makes no LinkedIn profile request', async ({ page }, info) => {
    await setupLinkedin(page, { writer: false });
    const reads: string[] = [];
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (request.method() === 'GET' && path === `${LINKEDIN_API}/profile`) reads.push(path);
    });
    await openLinkedin(page);
    await expect(page.getByTestId('mktg-linkedin-no-access')).toBeVisible();
    await expect(page.getByTestId('mktg-linkedin-post-form')).toHaveCount(0);
    expect(reads).toHaveLength(0);
    await page.screenshot({ path: info.outputPath('no-access.png'), fullPage: true });
  });
  test('profile failure is distinct from first-run setup and offers retry', async ({ page }, info) => {
    await setupLinkedin(page, { profileError: true });
    await openLinkedin(page);
    await expect(page.getByTestId('mktg-linkedin-error')).toContainText('could not be loaded');
    await expect(page.getByTestId('mktg-linkedin-profile-form')).toHaveCount(0);
    await expect(page.getByTestId('mktg-linkedin-retry-load')).toBeVisible();
    await page.screenshot({ path: info.outputPath('load-error.png'), fullPage: true });
  });
  test('generation failure keeps the content and allows a new attempt', async ({ page }, info) => {
    await setupLinkedin(page, { saved: true });
    await page.route(`**${LINKEDIN_API}/generate`, (route) => json(route, { error: 'Synthetic outage' }, 503));
    await openLinkedin(page);
    await page.getByTestId('mktg-linkedin-content-text').locator('textarea').fill('Keep this source.');
    await page.getByTestId('mktg-linkedin-draft').click();
    await expect(page.getByTestId('mktg-linkedin-error')).toBeVisible();
    await expect(page.getByTestId('mktg-linkedin-content-text').locator('textarea')).toHaveValue('Keep this source.');
    await expect(page.getByTestId('mktg-linkedin-draft').getByRole('button')).toBeEnabled();
    await page.screenshot({ path: info.outputPath('generation-error.png'), fullPage: true });
  });

  for (const width of [390, 768, 1280, 1440])
    test(`three full options fit a ${width}px viewport without horizontal overflow`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await setupLinkedin(page, { saved: true });
      await openLinkedin(page);
      await page.getByTestId('mktg-linkedin-content-text').locator('textarea').fill('Synthetic release content.');
      await page.getByTestId('mktg-linkedin-draft').click();
      await expect(page.getByTestId('mktg-linkedin-option')).toHaveCount(3, { timeout: LINKEDIN_RUN_TIMEOUT });
      const overflow = await page.getByTestId('mktg-document-view-page').evaluate((element) => element.scrollWidth > element.clientWidth);
      expect(overflow).toBe(false);
      await page.screenshot({ path: info.outputPath(`options-${width}.png`), fullPage: true });
      await expect(page.getByTestId('mktg-document-view-document').getByTestId('mktg-linkedin-option')).toHaveCount(3);
      await expect(page.getByTestId('mktg-linkedin-share-link').locator('input')).toHaveAttribute('readonly', '');
      expect(await page.getByTestId('mktg-document-view-page').evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false);
      await expect(page.getByTestId('mktg-linkedin-document-author')).toBeVisible();
      await expect(page.getByTestId('mktg-linkedin-document-edit-profile')).toBeVisible();
      await page.getByTestId('mktg-linkedin-edit-link').getByRole('button').click();
      await expect(page.getByTestId('mktg-linkedin-save-link')).toBeVisible();
      await expect(page.getByTestId('mktg-linkedin-cancel-link')).toBeVisible();
      await page.route(`**${LINKEDIN_API}/documents/*/share-link`, (route) => json(route, { error: 'Synthetic save failure' }, 503));
      await page.getByTestId('mktg-linkedin-share-link').locator('input').fill('https://public.example/unsaved');
      await page.getByTestId('mktg-linkedin-save-link').getByRole('button').click();
      await expect(page.getByTestId('mktg-linkedin-share-error')).toBeVisible();
      await page.getByTestId('mktg-linkedin-cancel-link').getByRole('button').click();
      await page.screenshot({ path: info.outputPath(`stored-options-${width}.png`), fullPage: true });
    });
});
