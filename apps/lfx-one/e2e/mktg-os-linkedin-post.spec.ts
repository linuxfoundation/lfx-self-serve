// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import {
  LINKEDIN_API,
  LINKEDIN_POST_INTAKE,
  MKTG_DOCUMENTS_API_PATH,
  MKTG_PENDING_DOCUMENT_STORAGE_PREFIX,
  MKTG_RUN_FAILURE_REASON,
} from '@lfx-one/shared/constants';
import { LINKEDIN_RECORDED_CASES } from '@lfx-one/shared/constants/linkedin-post-recorded.fixture';
import { linkedinProfileFromSetup, renderLinkedinProfileMarkdown } from '@lfx-one/shared/utils/linkedin-post.utils';
import {
  json,
  linkedinEnvelope,
  LINKEDIN_RUN_TIMEOUT,
  LINKEDIN_TEST_PROFILE,
  openLinkedin,
  setupLinkedin,
  stubLinkedinClipboard,
} from './helpers/mktg-linkedin.helper';

test.describe('Marketing OS LinkedIn posts', () => {
  test('reloaded first-run failure offers Retry to empty setup without storing profile answers', async ({ page }, info) => {
    await suppressCookieBanner(page);
    await setupLinkedin(page);
    let dead = false;
    let polls = 0;
    await page.route(`**${LINKEDIN_API}/result`, (route) => {
      if (!dead) return json(route, { status: 'pending' });
      polls++;
      return json(route, { status: 'failed', failure: { eventType: 'runtime_error', reason: 'The agent could not start. Retry.' } });
    });
    await openLinkedin(page);
    for (const [key, value] of Object.entries(LINKEDIN_TEST_PROFILE.about))
      await page.getByTestId(`mktg-linkedin-profile-${key}`).locator('input, textarea').fill(value);
    await page.getByTestId('mktg-linkedin-save-profile').getByRole('button').click();
    await page.getByTestId('mktg-linkedin-content-text').locator('textarea').fill('Synthetic first-run source.');
    await page.getByTestId('mktg-linkedin-draft').getByRole('button').click();
    await expect(page.getByTestId('mktg-linkedin-generating')).toBeVisible();
    const profilesPersisted = await page.evaluate(
      (prefix) =>
        Object.keys(localStorage)
          .filter((key) => key.startsWith(prefix))
          .some((key) => {
            const pending = JSON.parse(localStorage.getItem(key) ?? '{}');
            return 'setup' in pending || 'profile' in pending || 'setup' in (pending.retryInputs ?? {});
          }),
      MKTG_PENDING_DOCUMENT_STORAGE_PREFIX
    );
    expect(profilesPersisted).toBe(false);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    dead = true;
    await openLinkedin(page);
    await expect(page.getByTestId('mktg-linkedin-error')).toContainText('The agent could not start', { timeout: LINKEDIN_RUN_TIMEOUT });
    expect(polls).toBe(1);
    await page.getByTestId('mktg-linkedin-retry-run').getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByTestId('mktg-linkedin-profile-form')).toBeVisible();
    await expect(page.getByTestId('mktg-linkedin-error')).toContainText("Your setup answers aren't kept in the browser — enter them again to draft");
    await expect(page.getByTestId('mktg-linkedin-profile-name').locator('input')).toHaveValue('');
    await expect(page.getByTestId('mktg-linkedin-generating')).toHaveCount(0);
    expect(polls).toBe(1);
    await page.screenshot({ path: info.outputPath('first-run-reload-empty-setup.png'), fullPage: true });
  });
  test('a dead session fails within one poll and Retry sends the identical inputs to a new session', async ({ page }, info) => {
    await suppressCookieBanner(page);
    await setupLinkedin(page, { saved: true });
    const submitted: unknown[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === `${LINKEDIN_API}/generate`) submitted.push(request.postDataJSON());
    });
    let polls = 0;
    await page.route(`**${LINKEDIN_API}/result`, (route) => {
      polls++;
      return json(route, {
        status: 'failed',
        failure: { eventType: 'runtime_error', reason: 'The agent could not start. Your inputs are kept — retry with a new run.' },
      });
    });
    await openLinkedin(page);
    await page.getByTestId('mktg-linkedin-content-text').locator('textarea').fill('Synthetic release notes kept for Retry.');
    await page.getByTestId('mktg-linkedin-draft').getByRole('button').click();
    await expect(page.getByTestId('mktg-linkedin-error')).toContainText('The agent could not start', { timeout: LINKEDIN_RUN_TIMEOUT });
    await expect.poll(() => polls).toBe(1);
    await expect(page.getByTestId('mktg-linkedin-generating')).toHaveCount(0);
    await expect(page.getByTestId('mktg-linkedin-content-text').locator('textarea')).toHaveValue('Synthetic release notes kept for Retry.');
    for (const action of ['cancel', 'save'] as const) {
      await page.getByTestId('mktg-linkedin-edit-profile').click();
      await expect(page.getByTestId('mktg-linkedin-profile-form')).toBeVisible();
      await page
        .getByTestId(`mktg-linkedin-${action === 'cancel' ? 'cancel-edit' : 'save-profile'}`)
        .getByRole('button')
        .click();
      await expect(page.getByTestId('mktg-linkedin-post-form')).toBeVisible();
      await expect(page.getByTestId('mktg-linkedin-error')).toContainText(MKTG_RUN_FAILURE_REASON);
      await expect(page.getByTestId('mktg-linkedin-retry-run').getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
      expect(submitted).toHaveLength(1);
      expect(polls).toBe(1);
    }
    await page.getByTestId('mktg-linkedin-content-text').locator('textarea').fill('');
    await page.getByTestId('mktg-linkedin-draft').getByRole('button').click();
    await expect(page.getByTestId('mktg-linkedin-error')).toContainText('Supply pasted text');
    expect(submitted).toHaveLength(1);
    expect(polls).toBe(1);
    await page.getByTestId('mktg-linkedin-retry-run').getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByTestId('mktg-linkedin-error')).toHaveCount(0);
    await expect.poll(() => submitted.length).toBe(2);
    expect(submitted[1]).toEqual(submitted[0]);
    await expect.poll(() => polls, { timeout: LINKEDIN_RUN_TIMEOUT }).toBe(2);
    await expect(page.getByTestId('mktg-linkedin-error')).toContainText('The agent could not start', { timeout: LINKEDIN_RUN_TIMEOUT });
    await page.screenshot({ path: info.outputPath('failed-session-retry.png'), fullPage: true });
  });

  for (const source of ['text', 'file', 'url'] as const)
    test(`restoring a pending dead ${source} run fails once and never resumes on another reload`, async ({ page }, info) => {
      await suppressCookieBanner(page);
      await setupLinkedin(page, { saved: true });
      let dead = false;
      let pollsAfterReload = 0;
      await page.route(`**${LINKEDIN_API}/result`, (route) => {
        if (!dead) return json(route, { status: 'pending', activity: [] });
        pollsAfterReload++;
        return json(route, { status: 'failed', failure: { eventType: 'runtime_error', reason: 'The agent could not start. Retry with a new run.' } });
      });
      await openLinkedin(page);
      if (source === 'file') {
        await page.getByTestId('mktg-linkedin-source-file').click();
        await page
          .getByTestId('mktg-linkedin-file')
          .locator('input[type="file"]')
          .first()
          .setInputFiles({ name: 'synthetic.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic file source.') });
      } else if (source === 'url') {
        await page.getByTestId('mktg-linkedin-source-url').click();
        await page.getByTestId('mktg-linkedin-content-url').locator('input').fill('https://source.example/release');
      } else await page.getByTestId('mktg-linkedin-content-text').locator('textarea').fill('Synthetic recoverable source.');
      await page.getByTestId('mktg-linkedin-draft').getByRole('button').click();
      await expect(page.getByTestId('mktg-linkedin-generating')).toBeVisible();
      // Leave the old app before the error occurs, preserving its pending capability.
      // Reopening performs a full document navigation, like reload, before restoring the route.
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      dead = true;
      await openLinkedin(page);
      await expect(page.getByTestId('mktg-linkedin-error')).toContainText('The agent could not start', { timeout: LINKEDIN_RUN_TIMEOUT });
      expect(pollsAfterReload).toBe(1);
      await expect(page.getByTestId('mktg-linkedin-retry-run').getByRole('button')).toHaveText('Retry');
      await expect(page.getByTestId('mktg-linkedin-generating')).toHaveCount(0);
      await page.getByTestId('mktg-linkedin-retry-run').getByRole('button').click();
      const prompts = { file: 'choose the file again', text: 'paste it again', url: 'enter the link again' };
      await expect(page.getByTestId('mktg-linkedin-error')).toContainText(prompts[source]);
      if (source === 'file') await expect(page.getByTestId('mktg-linkedin-file')).toBeVisible();
      else if (source === 'url') await expect(page.getByTestId('mktg-linkedin-content-url').locator('input')).toHaveValue('');
      else await expect(page.getByTestId('mktg-linkedin-content-text').locator('textarea')).toHaveValue('');
      await openLinkedin(page);
      await expect(page.getByTestId('mktg-linkedin-post-form')).toBeVisible();
      await expect(page.getByTestId('mktg-linkedin-generating')).toHaveCount(0);
      expect(pollsAfterReload).toBe(1);
      await page.screenshot({ path: info.outputPath('dead-capability-retired.png'), fullPage: true });
    });
  test('shared run uses fixed linked parents and Back returns from Family without bouncing', async ({ page }, info) => {
    // The helper calls suppressCookieBanner and stubs all LinkedIn reads and project rights.
    await setupLinkedin(page, { saved: true });
    await openLinkedin(page);
    const crumb = page.getByTestId('mktg-linkedin-breadcrumb');
    await expect(crumb.getByTestId('mktg-breadcrumb-current')).toHaveText('LinkedIn Post Agent');
    await expect(crumb.getByRole('link')).toHaveCount(2);
    await expect(crumb.getByTestId('mktg-breadcrumb-link-0')).toHaveAttribute('href', '/project/mktg-os-agents?project=linkedin-e2e');
    await expect(crumb.getByTestId('mktg-breadcrumb-link-1')).toHaveAttribute('href', '/project/mktg-os-agents/families/social-community?project=linkedin-e2e');
    await crumb.getByTestId('mktg-breadcrumb-link-1').click();
    await expect(page.getByTestId('mktg-family-page')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('mktg-linkedin-post-form')).toBeVisible();
    await expect(crumb.getByTestId('mktg-breadcrumb-current')).toHaveText('LinkedIn Post Agent');
    await page.screenshot({ path: info.outputPath('linkedin-fixed-parent-back.png'), fullPage: true });
  });
  test('profile edit keeps its URL until save, while Back and Cancel return to the draft inputs', async ({ page }, info) => {
    await setupLinkedin(page, { saved: true });
    await openLinkedin(page);
    await expect(page.getByTestId('mktg-linkedin-post-form')).toBeVisible();
    await page.getByTestId('mktg-linkedin-edit-profile').click();
    await expect(page).toHaveURL(/profile=edit/);
    await expect(page.getByTestId('mktg-linkedin-profile-form')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('mktg-linkedin-post-form')).toBeVisible();
    await page.goForward();
    await expect(page.getByTestId('mktg-linkedin-profile-form')).toBeVisible();
    await page.getByTestId('mktg-linkedin-cancel-edit').getByRole('button').click();
    await expect(page).not.toHaveURL(/profile=edit/);
    await expect(page.getByTestId('mktg-linkedin-post-form')).toBeVisible();
    await page.screenshot({ path: info.outputPath('profile-history.png'), fullPage: true });
  });
  test('a cold profile edit stays on intake when Cancel follows Family and Back', async ({ page }, info) => {
    await setupLinkedin(page, { saved: true }); // openLinkedin calls suppressCookieBanner(page).
    await openLinkedin(page);
    const runUrl = page.url();
    const editUrl = new URL(runUrl);
    editUrl.searchParams.set('profile', 'edit');
    await page.getByTestId('mktg-breadcrumb-link-1').click();
    await expect(page.getByTestId('mktg-family-page')).toBeVisible();
    // A full navigation creates an unmarked edit entry, independent of router predecessors.
    await page.goto(editUrl.toString());
    await expect(page.getByTestId('mktg-linkedin-profile-form')).toBeVisible();
    await page.getByTestId('mktg-breadcrumb-link-1').click();
    await expect(page.getByTestId('mktg-family-page')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('mktg-linkedin-profile-form')).toBeVisible();
    await page.getByTestId('mktg-linkedin-cancel-edit').getByRole('button').click();
    await expect(page).toHaveURL(runUrl);
    await expect(page.getByTestId('mktg-linkedin-post-form')).toBeVisible();
    await page.screenshot({ path: info.outputPath('cold-profile-family-back-cancel.png'), fullPage: true });
  });
  test('Edit → Save returns to the run entry and the next Back leaves for its family', async ({ page }, info) => {
    await setupLinkedin(page, { saved: true }); // openLinkedin calls suppressCookieBanner(page).
    await openLinkedin(page);
    await page.getByTestId('mktg-breadcrumb-link-1').click();
    await expect(page.getByTestId('mktg-family-page')).toBeVisible();
    await page.getByTestId('mktg-family-run').getByRole('button').click();
    await expect(page.getByTestId('mktg-linkedin-post-form')).toBeVisible();
    await page.getByTestId('mktg-linkedin-edit-profile').click();
    await expect(page).toHaveURL(/profile=edit/);
    await page.getByTestId('mktg-linkedin-save-profile').getByRole('button').click();
    await expect(page).not.toHaveURL(/profile=edit/);
    await expect(page.getByTestId('mktg-linkedin-post-form')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('mktg-family-page')).toBeVisible();
    await page.screenshot({ path: info.outputPath('profile-save-back-to-family.png'), fullPage: true });
  });
  test('content source filters push URLs and Back restores the previous input view', async ({ page }, info) => {
    await setupLinkedin(page, { saved: true });
    await openLinkedin(page);
    const entries = await page.evaluate(() => history.length);
    await page.getByTestId('mktg-linkedin-source-url').click();
    await expect(page).toHaveURL(/source=url/);
    expect(await page.evaluate(() => history.length)).toBe(entries + 1);
    await page.getByTestId('mktg-linkedin-source-file').click();
    await expect(page).toHaveURL(/source=file/);
    await page.goBack();
    await expect(page.getByTestId('mktg-linkedin-source-url')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('mktg-linkedin-content-url')).toBeVisible();
    await page.goBack();
    await expect(page).not.toHaveURL(/[?&]source=/);
    await expect(page.getByTestId('mktg-linkedin-content-text')).toBeVisible();
    await page.screenshot({ path: info.outputPath('source-history.png'), fullPage: true });
  });
  test('keeps a failed first-run profile recoverable and saves it without another generation', async ({ page }, info) => {
    await setupLinkedin(page);
    let starts = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === `${LINKEDIN_API}/generate`) starts++;
    });
    await page.route(`**${LINKEDIN_API}/result`, (route) =>
      json(route, {
        status: 'ready',
        persistence: { project: 'synthetic-project', s3_key: 'synthetic/post.md' },
        profileSaved: false,
        envelope: {
          ...linkedinEnvelope(),
          version: 1,
          profile_source: 'first_run_setup',
          inputs: { content_source: 'text', feedback_provided: false },
          profile_update_note: undefined,
        },
      })
    );
    await openLinkedin(page);
    for (const [key, value] of Object.entries(LINKEDIN_TEST_PROFILE.about))
      await page.getByTestId(`mktg-linkedin-profile-${key}`).locator('input, textarea').fill(value);
    await page.getByTestId('mktg-linkedin-save-profile').getByRole('button').click();
    await page.getByTestId('mktg-linkedin-content-text').locator('textarea').fill('Synthetic release notes.');
    await page.getByTestId('mktg-linkedin-draft').getByRole('button').click();
    await expect(page.getByTestId('mktg-linkedin-results')).toBeVisible({ timeout: LINKEDIN_RUN_TIMEOUT });
    await expect(page.getByTestId('mktg-linkedin-error')).toContainText('profile is not saved');
    await expect(page.getByText('Profile saved for your next post.', { exact: false })).toHaveCount(0);
    await expect(page.getByTestId('mktg-linkedin-option')).toHaveCount(3);
    await page.getByTestId('mktg-linkedin-edit-profile').click();
    await expect(page.getByTestId('mktg-linkedin-profile-form')).toBeVisible();
    await expect(page.getByTestId('mktg-linkedin-save-profile').getByRole('button')).toHaveText('Save profile');
    await page.getByTestId('mktg-linkedin-save-profile').getByRole('button').click();
    await expect(page.getByTestId('mktg-linkedin-results')).toBeVisible();
    await expect(page.getByText('Profile saved for your next post.', { exact: false })).toBeVisible();
    expect(starts).toBe(1);
    await page.screenshot({ path: info.outputPath('first-run-explicit-profile-recovery.png'), fullPage: true });
  });
  test('copies complete hashtag tokens and resets confirmation after changing the saved link', async ({ page }, info) => {
    await setupLinkedin(page, { saved: true });
    await stubLinkedinClipboard(page);
    const output = linkedinEnvelope();
    output.options = output.options.map((option) => ({ ...option, text: '#AIOps and #AI_2. [LINK]', hashtags: ['#AI', '#AIOps', '#AI_2'] }));
    await page.route(`**${LINKEDIN_API}/result`, (route) =>
      json(route, { status: 'ready', envelope: output, persistence: { project: 'synthetic-project', s3_key: 'synthetic/post.md' } })
    );
    await openLinkedin(page);
    await page.getByTestId('mktg-linkedin-content-text').locator('textarea').fill('Synthetic source.');
    await page.getByTestId('mktg-linkedin-draft').getByRole('button').click();
    const copy = page.getByTestId('mktg-linkedin-copy-1').getByRole('button');
    await copy.click({ timeout: LINKEDIN_RUN_TIMEOUT });
    expect(await page.evaluate(() => sessionStorage.getItem('linkedin-test-copy'))).toBe('#AIOps and #AI_2. [LINK]\n\n#AI');
    await expect(copy).toHaveText('Copied');
    await page.getByTestId('mktg-linkedin-share-link').locator('input').fill('https://public.example/new');
    await page.getByTestId('mktg-linkedin-share-link').locator('input').press('Enter');
    await expect(page.getByTestId('mktg-linkedin-share-status')).toHaveText('Link saved');
    await expect(copy).toHaveText('Copy post');
    await expect(page.getByTestId('mktg-linkedin-copy-notice')).toHaveCount(0);
    await copy.click();
    expect(await page.evaluate(() => sessionStorage.getItem('linkedin-test-copy'))).toContain('https://public.example/new');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async () => {
            throw new Error('Synthetic clipboard denial');
          },
        },
      });
    });
    await copy.click();
    await expect(copy).toHaveText('Copy post');
    await expect(page.getByTestId('mktg-linkedin-copy-error')).toContainText('Clipboard unavailable');
    await page.screenshot({ path: info.outputPath('token-copy-current-link.png'), fullPage: true });
  });
  test('keeps a selected file visible through profile editing and clears it on source change', async ({ page }, info) => {
    await setupLinkedin(page, { saved: true });
    await openLinkedin(page);
    await page.getByTestId('mktg-linkedin-source-file').click();
    await page
      .getByTestId('mktg-linkedin-file')
      .locator('input[type="file"]')
      .first()
      .setInputFiles({ name: 'synthetic-notes.txt', mimeType: 'text/plain', buffer: Buffer.from('List<T> <https://public.example/release>') });
    await expect(page.getByTestId('mktg-linkedin-selected-file')).toContainText('synthetic-notes.txt');
    await page.getByTestId('mktg-linkedin-edit-profile').click();
    await page.getByTestId('mktg-linkedin-cancel-edit').getByRole('button').click();
    await expect(page.getByTestId('mktg-linkedin-selected-file')).toContainText('synthetic-notes.txt');
    await page.getByTestId('mktg-linkedin-source-text').click();
    await page.getByTestId('mktg-linkedin-source-file').click();
    await expect(page.getByTestId('mktg-linkedin-selected-file')).toHaveCount(0);
    await page.getByTestId('mktg-linkedin-draft').getByRole('button').click();
    await expect(page.getByTestId('mktg-linkedin-error')).toContainText('Choose a text file');
    await expect(page.getByTestId('mktg-linkedin-page').locator('main, aside')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('file-source-reset.png'), fullPage: true });
  });
  test('applies an offered voice without reverting profile edits made after the draft', async ({ page }, info) => {
    await setupLinkedin(page, { saved: true });
    let current = LINKEDIN_TEST_PROFILE;
    await page.route(`**${LINKEDIN_API}/profile`, (route) => {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON();
        current = body.profile ?? linkedinProfileFromSetup(body.setup);
      }
      return json(route, { profile: { profile: current, profile_markdown: renderLinkedinProfileMarkdown(current) } });
    });
    const output = linkedinEnvelope();
    output.profile_source = 'saved_profile';
    output.profile_update_note = 'A clearer voice.';
    output.profile = { ...output.profile, voice: { ...output.profile.voice, tone: 'Clear and direct' } };
    await page.route(`**${LINKEDIN_API}/result`, (route) =>
      json(route, { status: 'ready', envelope: output, persistence: { project: 'synthetic-project', s3_key: 'synthetic/post.md' } })
    );
    await openLinkedin(page);
    await page.getByTestId('mktg-linkedin-content-text').locator('textarea').fill('Synthetic release.');
    await page.getByTestId('mktg-linkedin-draft').getByRole('button').click();
    await expect(page.getByTestId('mktg-linkedin-save-voice')).toBeVisible({ timeout: LINKEDIN_RUN_TIMEOUT });
    await page.getByTestId('mktg-linkedin-edit-profile').click();
    await page.getByTestId('mktg-linkedin-profile-name').locator('input').fill('Updated author');
    await page.getByTestId('mktg-linkedin-save-profile').getByRole('button').click();
    await expect(page.getByTestId('mktg-linkedin-profile-form')).toHaveCount(0);
    const saving = page.waitForRequest((request) => request.url().endsWith(`${LINKEDIN_API}/profile`) && request.method() === 'PUT');
    await page.getByTestId('mktg-linkedin-save-voice').getByRole('button').click();
    expect((await saving).postDataJSON().profile.about.name).toBe('Updated author');
    await expect(page.getByTestId('mktg-linkedin-save-voice').getByRole('button')).toHaveText('Voice saved');
    expect(current.voice.tone).toBe('Clear and direct');
    await page.screenshot({ path: info.outputPath('voice-preserves-current-about.png'), fullPage: true });
  });

  test('opens profile edit ahead of pending-run recovery', async ({ page }, info) => {
    await setupLinkedin(page, { saved: true });
    await page.route(`**${LINKEDIN_API}/result`, (route) => json(route, { status: 'pending', activity: [] }));
    await openLinkedin(page);
    await page.getByTestId('mktg-linkedin-content-text').locator('textarea').fill('Unfinished synthetic run.');
    await page.getByTestId('mktg-linkedin-draft').getByRole('button').click();
    await expect(page.getByTestId('mktg-linkedin-draft').getByRole('button')).toBeDisabled();
    await page.evaluate(() => {
      const url = new URL(location.href);
      url.searchParams.set('profile', 'edit');
      history.replaceState({}, '', url);
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('mktg-linkedin-profile-form')).toBeVisible({ timeout: LINKEDIN_RUN_TIMEOUT });
    await expect(page.getByTestId('mktg-linkedin-save-profile').getByRole('button')).toBeEnabled();
    await page.screenshot({ path: info.outputPath('pending-run-profile-edit.png'), fullPage: true });
  });
  test('setup-only Continue after run-page Edit leaves one Back to Family', async ({ page }, info) => {
    await setupLinkedin(page); // openLinkedin includes suppressCookieBanner(page).
    await openLinkedin(page);
    await page.getByTestId('mktg-breadcrumb-link-1').click();
    await page.getByTestId('mktg-family-run').getByRole('button').click();
    for (const [key, value] of Object.entries(LINKEDIN_TEST_PROFILE.about))
      await page.getByTestId(`mktg-linkedin-profile-${key}`).locator('input, textarea').fill(value);
    await page.getByTestId('mktg-linkedin-save-profile').getByRole('button').click();
    await page.getByTestId('mktg-linkedin-edit-profile').click();
    await expect(page).toHaveURL(/profile=edit/);
    await page.getByTestId('mktg-linkedin-profile-tone').locator('input').fill('Direct');
    await page.getByTestId('mktg-linkedin-save-profile').getByRole('button').click();
    await expect(page.getByTestId('mktg-linkedin-post-form')).toBeVisible();
    await expect(page).not.toHaveURL(/profile=edit/);
    await page.goBack();
    await expect(page.getByTestId('mktg-family-page')).toBeVisible();
    await page.screenshot({ path: info.outputPath('setup-edit-continue-back.png'), fullPage: true });
  });
  test('drops cancelled optional setup edits when the form reopens', async ({ page }, info) => {
    await setupLinkedin(page);
    await openLinkedin(page);
    for (const [key, value] of Object.entries({ name: 'Example author', role: 'Maintainer', focus_areas: 'Code', primary_audience: 'Developers' }))
      await page.getByTestId(`mktg-linkedin-profile-${key}`).locator('input, textarea').fill(value);
    await page.getByTestId('mktg-linkedin-save-profile').getByRole('button').click();
    await page.getByTestId('mktg-linkedin-edit-profile').click();
    await page.getByTestId('mktg-linkedin-profile-tone').locator('input').fill('Cancelled tone');
    await page.getByTestId('mktg-linkedin-cancel-edit').getByRole('button').click();
    await page.getByTestId('mktg-linkedin-edit-profile').click();
    await expect(page.getByTestId('mktg-linkedin-profile-tone').locator('input')).toHaveValue('');
    await page.screenshot({ path: info.outputPath('cancelled-setup-reset.png'), fullPage: true });
  });
  test('recorded2.0 additive research renders three options and the Run-board breadcrumb', async ({ page }, info) => {
    await setupLinkedin(page, { saved: true, recordedCase: 'form-note' });
    await openLinkedin(page);
    await expect(page.getByTestId('mktg-linkedin-breadcrumb')).toContainText('Example post project kit');
    await expect(page.getByTestId('mktg-linkedin-breadcrumb')).toContainText('Social & community');
    await expect(page.getByTestId('mktg-linkedin-breadcrumb')).toContainText('LinkedIn');
    await page.getByTestId('mktg-linkedin-content-text').locator('textarea').fill('Synthetic release notes.');
    const response = page.waitForResponse((value) => value.url().endsWith(`${LINKEDIN_API}/result`));
    await page.getByTestId('mktg-linkedin-draft').getByRole('button').click();
    expect((await (await response).json()).envelope.inputs).toHaveProperty('research');
    await expect(page.getByTestId('mktg-linkedin-option')).toHaveCount(3, { timeout: LINKEDIN_RUN_TIMEOUT });
    await page.screenshot({ path: info.outputPath('recorded2-options.png'), fullPage: true });
  });
  test('recorded profile questions occupy their own page and answers continue the SAME session', async ({ page }, info) => {
    const recorded = LINKEDIN_RECORDED_CASES.find((value) => value.name.endsWith('/first-run-setup'));
    if (!recorded) throw new Error('Missing recorded gap fixture');
    await setupLinkedin(page, { recordedCase: 'first-run-setup', questions: true });
    await openLinkedin(page);
    for (const [key, value] of Object.entries(recorded.envelope.profile.about))
      await page.getByTestId(`mktg-linkedin-profile-${key}`).locator('input, textarea').fill(value);
    await page.getByTestId('mktg-linkedin-profile-tone').locator('input').fill(recorded.envelope.profile.voice.tone);
    await page.getByTestId('mktg-linkedin-save-profile').getByRole('button').click();
    await page.getByTestId('mktg-linkedin-content-text').locator('textarea').fill('Synthetic release notes.');
    let generates = 0;
    page.on('request', (request) => {
      if (request.url().endsWith(`${LINKEDIN_API}/generate`)) generates++;
    });
    await page.getByTestId('mktg-linkedin-draft').getByRole('button').click();
    await expect(page.getByTestId('mktg-linkedin-questions')).toBeVisible({ timeout: LINKEDIN_RUN_TIMEOUT });
    await expect(page.getByTestId('mktg-linkedin-post-form')).toHaveCount(0);
    await expect(page.getByTestId('mktg-run-questions-progress')).toContainText('Question 1 of 3');
    await page.screenshot({ path: info.outputPath('recorded2-questions.png'), fullPage: true });
    await page.getByTestId('mktg-run-questions-next').getByRole('button').click();
    await page.getByTestId('mktg-run-questions-next').getByRole('button').click();
    const send = page.waitForRequest((request) => request.url().endsWith(`${LINKEDIN_API}/answers`));
    await page.getByTestId('mktg-run-questions-send').getByRole('button').click();
    expect((await send).postDataJSON()).toMatchObject({ sessionId: 'synthetic-session-1', questionsId: 'a'.repeat(64) });
    await expect(page.getByTestId('mktg-linkedin-option')).toHaveCount(3, { timeout: LINKEDIN_RUN_TIMEOUT });
    expect(generates).toBe(1);
    await expect(page.getByTestId('mktg-linkedin-questions')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('recorded2-after-answers.png'), fullPage: true });
  });
  test('first-run setup and pasted text produce three copyable options with separate notes', async ({ page }, info) => {
    await setupLinkedin(page);
    await stubLinkedinClipboard(page);
    await openLinkedin(page);
    await expect(page.getByRole('heading', { name: 'Set up your LinkedIn profile' })).toBeVisible();
    for (const [key, value] of Object.entries(LINKEDIN_TEST_PROFILE.about))
      await page.getByTestId(`mktg-linkedin-profile-${key}`).locator('input, textarea').fill(value);
    await page.getByTestId('mktg-linkedin-save-profile').click();
    await expect(page.getByTestId('mktg-linkedin-share-link').locator('input')).toHaveValue('');
    await page.getByTestId('mktg-linkedin-content-text').locator('textarea').fill('Example project released a new developer tool.');
    const request = page.waitForRequest((r) => r.url().endsWith(`${LINKEDIN_API}/generate`));
    await page.getByTestId('mktg-linkedin-draft').click();
    expect((await request).postDataJSON()).toMatchObject({ setup: { name: 'Example author' }, answers: { content_source: 'text' } });
    await expect(page.getByTestId('mktg-linkedin-option')).toHaveCount(3, { timeout: LINKEDIN_RUN_TIMEOUT });
    await expect(page.getByTestId('mktg-linkedin-notes')).toContainText('Verify handles');
    await expect(page.getByTestId('mktg-linkedin-add-link')).toHaveCount(3);
    await expect(page.getByTestId('mktg-linkedin-post-text').first()).not.toContainText('[LINK]');
    await expect(page.getByTestId('mktg-linkedin-post-text').first()).not.toContainText('Verify handles');
    await expect(page.getByRole('textbox', { name: /feedback/i })).toHaveCount(0);
    expect(
      await page.evaluate(() => {
        const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
        return typeof descriptor?.value?.writeText === 'function';
      })
    ).toBe(true);
    // The wrapper stretches across the option card; click its visible native
    // button rather than the host's potentially noninteractive center.
    await page.getByTestId('mktg-linkedin-copy-1').getByRole('button', { name: 'Copy post', exact: true }).click();
    await expect(page.getByTestId('mktg-linkedin-copy-1')).toContainText('Copied');
    const copied = await page.evaluate(() => sessionStorage.getItem('linkedin-test-copy'));
    expect(copied).toContain('Example release 1.');
    expect(copied).toContain('#Release');
    expect(copied).not.toContain('Verify handles');
    expect(copied).toContain('[LINK]');
    await expect(page.getByTestId('mktg-linkedin-copy-notice')).toContainText('still contains [LINK]');
    await page.screenshot({ path: info.outputPath('three-options.png'), fullPage: true });
    await page.getByTestId('mktg-linkedin-open-document').click();
    await expect(page).toHaveURL(/documents\/linkedin-post\/run-/);
    await expect(page.getByTestId('mktg-document-view-document').getByTestId('mktg-linkedin-option')).toHaveCount(3);
    await expect(page.getByTestId('mktg-linkedin-add-link')).toHaveCount(3);
    await expect(page.getByTestId('mktg-linkedin-share-link').locator('input')).toHaveAttribute('readonly', '');
    await expect(page.getByTestId('mktg-linkedin-share-link').locator('input')).toHaveValue('');
    await page.getByTestId('mktg-linkedin-copy-1').getByRole('button', { name: 'Copy post', exact: true }).click();
    await expect(page.getByTestId('mktg-linkedin-copy-notice')).toContainText('still contains [LINK]');
    await page.screenshot({ path: info.outputPath('one-off-document.png'), fullPage: true });
  });
  test('a saved profile can be edited without starting a run', async ({ page }, info) => {
    await setupLinkedin(page, { saved: true });
    await openLinkedin(page);
    await expect(page.getByTestId('mktg-linkedin-identity')).toContainText('Writing as Example author');
    let started = 0;
    page.on('request', (r) => {
      if (r.url().endsWith('/generate')) started++;
    });
    await page.getByTestId('mktg-linkedin-edit-profile').click();
    await expect(page.getByTestId('mktg-linkedin-profile-role').locator('input')).toHaveValue('Maintainer');
    await page.getByTestId('mktg-linkedin-cancel-edit').click();
    await expect(page.getByTestId('mktg-linkedin-post-form')).toBeVisible();
    await page.getByTestId('mktg-linkedin-edit-profile').click();
    await page.getByTestId('mktg-linkedin-profile-tone').locator('input').fill('direct');
    const request = page.waitForRequest((r) => r.method() === 'PUT' && r.url().endsWith('/profile'));
    await page.getByTestId('mktg-linkedin-save-profile').click();
    expect((await request).postDataJSON().setup.tone).toBe('direct');
    expect(started).toBe(0);
    await expect(page.getByTestId('mktg-linkedin-post-form')).toBeVisible();
    await page.screenshot({ path: info.outputPath('saved-profile.png'), fullPage: true });
  });
  for (const source of ['url', 'file'] as const)
    test(`draft from ${source} submits the source, not invented extracted text`, async ({ page }, info) => {
      await setupLinkedin(page, { saved: true });
      await stubLinkedinClipboard(page);
      await openLinkedin(page);
      await page.getByTestId(`mktg-linkedin-source-${source}`).click();
      if (source === 'url') {
        await page.getByTestId('mktg-linkedin-content-url').locator('input').fill('https://public.example/release');
        await expect(page.getByTestId('mktg-linkedin-share-link').locator('input')).toHaveValue('https://public.example/release');
        await page.getByTestId('mktg-linkedin-share-link').locator('input').fill('https://public.example/shared');
      } else {
        await expect(page.getByTestId('mktg-linkedin-share-link').locator('input')).toHaveValue('');
        // PrimeNG's advanced uploader renders two inputs; choose()/the dropzone
        // use its first, top-level advancedfileinput. Both share onFileSelect.
        await page
          .getByTestId('mktg-linkedin-file')
          .locator('input[type="file"]')
          .first()
          .setInputFiles({ name: 'release.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic release content') });
      }
      const request = page.waitForRequest((r) => r.url().endsWith('/generate'));
      await page.getByTestId('mktg-linkedin-draft').click();
      const body = (await request).postDataJSON();
      expect(body.answers.content_source).toBe(source);
      expect(body.answers.content_text).toBeUndefined();
      if (source === 'file') expect(Buffer.from(body.answers.content_file_base64, 'base64').toString()).toBe('Synthetic release content');
      await expect(page.getByTestId('mktg-linkedin-option')).toHaveCount(3, { timeout: LINKEDIN_RUN_TIMEOUT });
      if (source === 'url') {
        expect(body.answers.share_link).toBe('https://public.example/shared');
        await expect(page.getByTestId('mktg-linkedin-post-text').first()).toContainText('https://public.example/shared');
        await expect(page.getByTestId('mktg-linkedin-add-link')).toHaveCount(0);
        for (const number of [1, 2, 3])
          await expect(page.getByTestId(`mktg-linkedin-share-link-${number}`)).toHaveAttribute('href', 'https://public.example/shared');
        await page.getByTestId('mktg-linkedin-copy-1').getByRole('button', { name: 'Copy post', exact: true }).click();
        expect(await page.evaluate(() => sessionStorage.getItem('linkedin-test-copy'))).toContain('https://public.example/shared');
        await page.getByTestId('mktg-linkedin-open-document').click();
        await expect(page.getByTestId('mktg-document-view-document').getByTestId('mktg-linkedin-option')).toHaveCount(3);
        await expect(page.getByTestId('mktg-linkedin-post-text').first()).toContainText('https://public.example/shared');
        await expect(page.getByTestId('mktg-linkedin-share-link').locator('input')).toHaveValue('https://public.example/shared');
        await expect(page.getByTestId('mktg-linkedin-share-link').locator('input')).toHaveAttribute('readonly', '');
        await expect(page.getByTestId('mktg-document-view-revisions')).toHaveCount(0);
        for (const number of [1, 2, 3])
          await expect(page.getByTestId(`mktg-linkedin-share-link-${number}`)).toHaveAttribute('href', 'https://public.example/shared');
        await page.getByTestId('mktg-linkedin-copy-1').getByRole('button', { name: 'Copy post', exact: true }).click();
        const storedCopy = await page.evaluate(() => sessionStorage.getItem('linkedin-test-copy'));
        expect(storedCopy).toContain('https://public.example/shared');
        expect(storedCopy).not.toContain('[LINK]');
      }
      await page.screenshot({ path: info.outputPath(`${source}-options.png`), fullPage: true });
    });

  for (const priorFailure of [false, true])
    test(`Draft B uses its auto-filled link without PATCHing A; prior explicit save failed=${priorFailure}`, async ({ page }, info) => {
      await setupLinkedin(page, { saved: true });
      await stubLinkedinClipboard(page);
      await openLinkedin(page);
      const patches: string[] = [];
      await page.route(`**${LINKEDIN_API}/documents/*/share-link`, (route) => {
        patches.push(route.request().postDataJSON().share_link);
        return json(route, { error: 'Synthetic save failure' }, 503);
      });
      await page.getByTestId('mktg-linkedin-source-url').click();
      const url = page.getByTestId('mktg-linkedin-content-url').locator('input');
      const link = page.getByTestId('mktg-linkedin-share-link').locator('input');
      const draft = page.getByTestId('mktg-linkedin-draft').getByRole('button');
      await url.fill('https://public.example/post-a');
      const first = page.waitForResponse((response) => response.url().endsWith(`${LINKEDIN_API}/generate`));
      await draft.click();
      const runA = await (await first).json();
      await expect(page.getByTestId('mktg-linkedin-option')).toHaveCount(3, { timeout: LINKEDIN_RUN_TIMEOUT });
      if (priorFailure) {
        await link.fill('https://public.example/explicit-a');
        await url.focus();
        await expect(page.getByTestId('mktg-linkedin-share-error')).toContainText('restore the saved link');
        expect(patches).toEqual(['https://public.example/explicit-a']);
        await page.getByTestId('mktg-linkedin-source-text').click();
        await page.getByTestId('mktg-linkedin-source-url').click();
      }
      await url.fill('https://public.example/post-b');
      await expect(link).toHaveValue('https://public.example/post-b');
      await expect(page.getByTestId('mktg-linkedin-share-link-1')).toHaveAttribute('href', 'https://public.example/post-a');
      const next = page.waitForResponse((response) => response.url().endsWith(`${LINKEDIN_API}/generate`));
      await draft.click();
      const responseB = await next;
      const runB = await responseB.json();
      expect(responseB.request().postDataJSON().answers).toMatchObject({
        content_url: 'https://public.example/post-b',
        share_link: 'https://public.example/post-b',
      });
      expect(runB.sessionId).not.toBe(runA.sessionId);
      expect(runB.documentId).not.toBe(runA.documentId);
      await expect(page.getByTestId('mktg-linkedin-option')).toHaveCount(3, { timeout: LINKEDIN_RUN_TIMEOUT });
      expect(patches).toEqual(priorFailure ? ['https://public.example/explicit-a'] : []);
      await expect(page.getByTestId('mktg-linkedin-share-link-1')).toHaveAttribute('href', 'https://public.example/post-b');
      await page.getByTestId('mktg-linkedin-copy-1').getByRole('button', { name: 'Copy post', exact: true }).click();
      expect(await page.evaluate(() => sessionStorage.getItem('linkedin-test-copy'))).toContain('https://public.example/post-b');
      const documents = await page.evaluate(
        async (urls) => Promise.all(urls.map(async (url) => (await fetch(url)).json())),
        [runA.documentId, runB.documentId].map((id) => `${MKTG_DOCUMENTS_API_PATH}/${LINKEDIN_POST_INTAKE.agentId}/${id}`)
      );
      expect(documents[0]).toMatchObject({ documentId: runA.documentId, linkedinPost: { answers: { share_link: 'https://public.example/post-a' } } });
      expect(documents[1]).toMatchObject({ documentId: runB.documentId, linkedinPost: { answers: { share_link: 'https://public.example/post-b' } } });
      await page.screenshot({ path: info.outputPath(`new-draft-after-${priorFailure ? 'failed-explicit-save' : 'auto-prefill'}.png`), fullPage: true });
    });

  for (const apply of ['Enter', 'Open document'] as const)
    test(`post-draft link via ${apply} saves without generating and survives document reload`, async ({ page }, info) => {
      await setupLinkedin(page, { saved: true });
      await stubLinkedinClipboard(page);
      await openLinkedin(page);
      let generates = 0;
      const patches: string[] = [];
      page.on('request', (request) => {
        if (request.url().endsWith(`${LINKEDIN_API}/generate`)) generates++;
        if (request.method() === 'PATCH' && request.url().endsWith('/share-link')) patches.push(request.postDataJSON().share_link);
      });
      await page.getByTestId('mktg-linkedin-content-text').locator('textarea').fill('Synthetic release without a link.');
      await page.getByTestId('mktg-linkedin-draft').getByRole('button').click();
      await expect(page.getByTestId('mktg-linkedin-option')).toHaveCount(3);
      const field = page.getByTestId('mktg-linkedin-share-link').locator('input');
      await field.fill('https://public.example/after-draft');
      await expect(page.getByTestId('mktg-linkedin-add-link')).toHaveCount(3);
      if (apply === 'Enter') {
        await field.press('Enter');
        await expect(page.getByTestId('mktg-linkedin-share-status')).toHaveText('Link saved');
        await expect(page.getByTestId('mktg-linkedin-option')).toHaveCount(3);
        await expect(page.getByTestId('mktg-linkedin-share-link-1')).toHaveAttribute('href', 'https://public.example/after-draft');
        await field.press('Enter');
      }
      await page.getByTestId('mktg-linkedin-open-document').getByRole('button').click();
      await expect(page.getByTestId('mktg-document-view-document')).toBeVisible();
      await expect(page.getByTestId('mktg-linkedin-share-link-1')).toHaveAttribute('href', 'https://public.example/after-draft');
      await page.reload();
      await expect(page.getByTestId('mktg-linkedin-share-link-1')).toHaveAttribute('href', 'https://public.example/after-draft');
      await page.getByTestId('mktg-linkedin-copy-1').getByRole('button').click();
      expect(await page.evaluate(() => sessionStorage.getItem('linkedin-test-copy'))).toContain('https://public.example/after-draft');
      expect(generates).toBe(1);
      expect(patches).toEqual(['https://public.example/after-draft']);
      await page.screenshot({ path: info.outputPath(`post-draft-link-${apply === 'Enter' ? 'enter' : 'blur'}.png`), fullPage: true });
    });
  test('invalid post-draft link shows a clear error with no PATCH or new draft', async ({ page }, info) => {
    await setupLinkedin(page, { saved: true });
    await openLinkedin(page);
    let generates = 0;
    let patches = 0;
    page.on('request', (request) => {
      if (request.url().endsWith(`${LINKEDIN_API}/generate`)) generates++;
      if (request.method() === 'PATCH' && request.url().endsWith('/share-link')) patches++;
    });
    await page.getByTestId('mktg-linkedin-content-text').locator('textarea').fill('Synthetic release.');
    await page.getByTestId('mktg-linkedin-share-link').locator('input').fill('https://public.example/original');
    await page.getByTestId('mktg-linkedin-draft').getByRole('button').click();
    await expect(page.getByTestId('mktg-linkedin-option')).toHaveCount(3);
    await page.getByTestId('mktg-linkedin-share-link').locator('input').fill('javascript:bad');
    await page.getByTestId('mktg-linkedin-share-link').locator('input').press('Enter');
    await expect(page.getByTestId('mktg-linkedin-share-error')).toContainText('HTTPS');
    await expect(page.getByTestId('mktg-linkedin-share-link-1')).toHaveAttribute('href', 'https://public.example/original');
    expect(generates).toBe(1);
    expect(patches).toBe(0);
    await page.screenshot({ path: info.outputPath('post-draft-invalid-link.png'), fullPage: true });
  });

  test('author profile edit is consumed once and Draft another stays on intake after reload', async ({ page }, info) => {
    await setupLinkedin(page, { saved: true });
    await openLinkedin(page);
    await page.getByTestId('mktg-linkedin-content-text').locator('textarea').fill('Synthetic release.');
    await page.getByTestId('mktg-linkedin-draft').click();
    await page.getByTestId('mktg-linkedin-open-document').click();
    await expect(page.getByTestId('mktg-document-view-document')).toBeVisible();
    const documentUrl = page.url();
    await page.getByTestId('mktg-linkedin-document-edit-profile').click();
    await expect(page).toHaveURL(/[?&]profile=edit/);
    await expect(page.getByRole('heading', { name: 'Edit your LinkedIn profile', exact: true })).toBeVisible();
    await expect(page.getByTestId('mktg-linkedin-profile-form')).toBeVisible();
    await page.getByTestId('mktg-linkedin-save-profile').click();
    // Save consumes the pushed edit entry by returning to its document, not a duplicate intake URL.
    await expect(page).toHaveURL(documentUrl);
    await expect(page.getByTestId('mktg-document-view-document')).toBeVisible();
    await expect(page).not.toHaveURL(/[?&]profile=edit/);
    await page.reload();
    await expect(page).toHaveURL(documentUrl);
    await expect(page.getByTestId('mktg-document-view-document')).toBeVisible();
    await page.getByTestId('mktg-linkedin-draft-another').click();
    await expect(page).not.toHaveURL(/[?&]profile=edit/);
    await expect(page.getByTestId('mktg-linkedin-post-form')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('mktg-linkedin-post-form')).toBeVisible();
    await expect(page.getByTestId('mktg-linkedin-profile-form')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('profile-edit-consumed.png'), fullPage: true });
  });

  test('chip keyboard handoff at 390px edits one saved link for all options across reload', async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let runs = 0;
    page.on('request', (request) => {
      if (request.url().endsWith(`${LINKEDIN_API}/generate`)) runs++;
    });
    await setupLinkedin(page, { saved: true });
    await stubLinkedinClipboard(page);
    await openLinkedin(page);
    await page.getByTestId('mktg-linkedin-content-text').locator('textarea').fill('Synthetic source without a link.');
    await page.getByTestId('mktg-linkedin-draft').click();
    const chip = page.getByTestId('mktg-linkedin-add-link').first();
    await expect(chip).toHaveAccessibleName('Add your link');
    await chip.focus();
    await chip.press('Enter');
    await expect(page.getByTestId('mktg-linkedin-share-link').locator('input')).toBeFocused();
    await expect(page.getByTestId('mktg-linkedin-share-link').locator('input')).toBeInViewport();
    await page.getByTestId('mktg-linkedin-open-document').click();
    await expect(page.getByTestId('mktg-linkedin-document-author')).toContainText('Writing as Example author');
    await page.getByTestId('mktg-linkedin-add-link').first().focus();
    await page.getByTestId('mktg-linkedin-add-link').first().press('Enter');
    const field = page.getByTestId('mktg-linkedin-share-link').locator('input');
    await expect(field).toBeFocused();
    await expect(field).toBeEditable();
    await expect(field).toBeInViewport();
    await field.fill('https://public.example/edited');
    await expect(page.getByTestId('mktg-linkedin-add-link')).toHaveCount(3);
    await page.getByTestId('mktg-linkedin-save-link').click();
    await expect(page.getByTestId('mktg-linkedin-add-link')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('mktg-linkedin-share-link-1')).toHaveAttribute('href', 'https://public.example/edited');
    await page.getByTestId('mktg-linkedin-copy-1').getByRole('button').click();
    expect(await page.evaluate(() => sessionStorage.getItem('linkedin-test-copy'))).toContain('https://public.example/edited');
    expect(runs).toBe(1);
    await page.screenshot({ path: info.outputPath('editable-link-mobile.png'), fullPage: true });
  });
  for (const status of [403, 503])
    test(`failed link save ${status} keeps the saved text and copy, cancel restores the field`, async ({ page }, info) => {
      await setupLinkedin(page, { saved: true });
      await stubLinkedinClipboard(page);
      await openLinkedin(page);
      await page.getByTestId('mktg-linkedin-content-text').locator('textarea').fill('Synthetic release.');
      await page.getByTestId('mktg-linkedin-share-link').locator('input').fill('https://public.example/original');
      await page.getByTestId('mktg-linkedin-draft').click();
      await page.getByTestId('mktg-linkedin-open-document').click();
      await page.route(`**${LINKEDIN_API}/documents/*/share-link`, (route) => json(route, { error: 'Synthetic save failure' }, status));
      await page.getByTestId('mktg-linkedin-edit-link').click();
      await page.getByTestId('mktg-linkedin-share-link').locator('input').fill('https://public.example/unsaved');
      await page.getByTestId('mktg-linkedin-save-link').click();
      await expect(page.getByTestId('mktg-linkedin-share-error')).toContainText('could not be saved');
      await expect(page.getByTestId('mktg-linkedin-share-link-1')).toHaveAttribute('href', 'https://public.example/original');
      await page.getByTestId('mktg-linkedin-copy-1').getByRole('button').click();
      expect(await page.evaluate(() => sessionStorage.getItem('linkedin-test-copy'))).toContain('https://public.example/original');
      await page.getByTestId('mktg-linkedin-cancel-link').click();
      await expect(page.getByTestId('mktg-linkedin-share-link').locator('input')).toHaveValue('https://public.example/original');
      await page.screenshot({ path: info.outputPath(`save-error-cancel-${status}.png`), fullPage: true });
    });
  for (const name of ['Example author', null])
    test(`non-author attribution ${name ?? 'unavailable'} never offers editing another profile`, async ({ page }, info) => {
      await setupLinkedin(page, { saved: true, author: { name, isAuthor: false } });
      await openLinkedin(page);
      await page.getByTestId('mktg-linkedin-content-text').locator('textarea').fill('Synthetic release.');
      await page.getByTestId('mktg-linkedin-draft').click();
      await page.getByTestId('mktg-linkedin-open-document').click();
      await expect(page.getByTestId('mktg-linkedin-document-author')).toContainText(`Drafted by ${name ?? 'name unavailable'}`);
      await expect(page.getByTestId('mktg-linkedin-document-edit-profile')).toHaveCount(0);
      await expect(page.getByTestId('mktg-document-view-revision-chip')).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`viewer-${name ? 'resolved' : 'unavailable'}.png`), fullPage: true });
    });
});
