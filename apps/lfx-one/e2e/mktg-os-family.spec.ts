// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect } from '@playwright/test';
import { MKTG_KIT_FAMILIES } from '../../../packages/shared/src/constants/mktg-kit.constants';
import { MKTG_DOCUMENT_TYPES } from '../../../packages/shared/src/constants/mktg-document-store.constants';
import { MKTG_AGENTS } from '../../../packages/shared/src/constants/mktg-os-agents.constants';
import { MKTG_AGENT_INTAKES } from '../../../packages/shared/src/constants/mktg-run.constants';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { linkedinProfileFromSetup } from '../../../packages/shared/src/utils/linkedin-post.utils';
import { kitTest as test, kitDocuments, kitJson, kitRevision, kitPrintMembers, KIT_PROJECT, openKit, setupKit } from './helpers/mktg-kit.helper';
import { linkedinEnvelope } from './helpers/mktg-linkedin.helper';

test.describe('Marketing family content', () => {
  test.beforeEach(async ({ page }) => {
    await suppressCookieBanner(page);
  });
  test('a started run uses the existing family header and row for writing progress', async ({ page }) => {
    const listing = kitDocuments(false);
    listing.runs = [
      {
        agentKey: 'foundation-message',
        project: listing.project,
        documentId: 'living',
        runId: 'synthetic-run',
        state: 'writing',
        startedAt: '2026-10-28T12:00:00Z',
      },
    ];
    await setupKit(page, { listing });
    await openKit(page, '/families/positioning-brand');
    await expect(page.getByTestId('mktg-family-run-status-row')).toContainText('Writing…');
    await expect(page.getByTestId('mktg-family-run-status')).toContainText('Messaging framework · Writing…');
    await expect(page.getByTestId('mktg-family-run').getByRole('link')).toHaveText('Create messaging framework');
    await expect(page.getByTestId('mktg-family-run-status').getByRole('link', { name: 'Open', exact: true })).toHaveAttribute(
      'href',
      /documents\/foundation-message\/living\?project=.*&run=synthetic-run$/
    );
    await expect(page.getByTestId('mktg-family-run-messaging-framework')).toContainText('Create messaging framework');
    await page.screenshot({ path: test.info().outputPath('family-writing.png'), fullPage: true });
  });
  for (const loaded of [false, true]) {
    for (const mount of ['project', 'foundation'] as const) {
      test(`${mount}: only unbuilt living rows offer fresh intake (loaded=${loaded})`, async ({ page }) => {
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
          if (loaded) {
            await expect(row.locator('lfx-button')).toHaveCount(0);
            continue;
          }
          if (MKTG_AGENT_INTAKES[agent.id].attachments?.some((attachment) => attachment.format === 'json' && !attachment.optional)) {
            await expect(row.getByTestId(`mktg-family-run-${asset.id}`).getByRole('button')).toBeDisabled();
            continue;
          }
          const action = row.getByTestId(`mktg-family-run-${asset.id}`).getByRole('link');
          await expect(action).toContainText('Create ' + (asset.runName ?? asset.label));
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
    await expect(page.getByTestId('mktg-family-assets').locator('lfx-button')).toHaveCount(0);
    await expect(page.getByTestId('mktg-family-run').getByRole('link')).toHaveText('Review 4 drafts');
    await expect(page.getByTestId('mktg-family-run').getByRole('link')).toHaveAttribute('href', /documents\/foundation-message\/living\?project=/);
    await expect(page.getByTestId('mktg-family-asset-icp')).toHaveCount(0);
    await expect(page.getByTestId('mktg-family-sources').getByRole('heading')).toContainText('2 sources read · 2 sources failed');
    const sources = page.getByTestId('mktg-family-sources-list');
    await expect(sources).toBeHidden();
    await page.getByTestId('mktg-family-sources-toggle').getByRole('button', { name: 'Show' }).click();
    await expect(sources).toBeVisible();
    await expect(sources).toContainText('Sources read on the last run: project.example, Synthetic plan.');
    await expect(page.getByTestId('mktg-family-sources')).toContainText('2 sources failed: README: Timed out; Analyst note: Login required.');
    await page.getByTestId('mktg-family-sources-toggle').getByRole('button', { name: 'Hide' }).click();
    await expect(sources).toBeHidden();
    await expect(page.getByTestId('mktg-family-approve').getByRole('heading')).toContainText('Sign-off · roadmap: two-role sign-off arrives in November');
    await expect(page.locator('#mktg-family-sign-off-text')).toBeHidden();
    await page.getByTestId('mktg-family-sign-off-toggle').getByRole('button', { name: 'Show' }).click();
    await expect(page.locator('#mktg-family-sign-off-text')).toBeVisible();
    await page.getByTestId('mktg-family-sign-off-toggle').getByRole('button', { name: 'Hide' }).click();
    await expect(page.locator('#mktg-family-sign-off-text')).toBeHidden();
    for (const id of ['family-export-pdf', 'family-export-slides']) {
      await expect(page.getByTestId(id).getByRole('button')).toBeDisabled();
    }
    // Nothing is stale, so the header offers no rebuild.
    await expect(page.getByTestId('mktg-family-rebuild')).toHaveCount(0);
    await expect(page.locator('lfx-mktg-family-export-actions')).toHaveAttribute('data-family-id', 'positioning-brand');
    await expect(page.getByTestId('mktg-family-exports')).toContainText('Google Slides: framework, brand kit, boilerplates and FAQ (approved current).');
  });
  test('a blocked next step links to the document that needs approval', async ({ page }) => {
    const listing = kitDocuments(true);
    for (const group of listing.groups) if (group.type.agentKey !== 'foundation-message') group.documents = [];
    await setupKit(page, { listing });
    await openKit(page, '/families/positioning-brand');
    const primary = page.getByTestId('mktg-family-run').getByRole('link');
    await expect(primary).toHaveText('Review and approve the framework');
    await expect(page.getByTestId('mktg-family-next-caption')).toHaveText('Then: boilerplates, FAQ and the brand kit');
    await primary.click();
    await expect(page.getByTestId('mktg-framework-view')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('family-approve-next.png'), fullPage: true });
  });
  for (const stale of [false, true]) {
    test(`approved living assets have ${stale ? 'an Update primary' : 'Export the kit without starting an export'}`, async ({ page }) => {
      const listing = kitDocuments(true);
      const members = kitPrintMembers();
      const requests: string[] = [];
      page.on('request', (request) => {
        const path = new URL(request.url()).pathname;
        if (path.startsWith('/api/mktg-')) requests.push(`${request.method()} ${path}`);
      });
      const framework = members.find((member) => member.agentKey === 'foundation-message');
      if (!framework) throw new Error('Missing synthetic approved framework');
      const ref = {
        agentKey: 'foundation-message' as const,
        revisionId: framework.revisionId,
        revisionNumber: framework.revisionNumber,
        contentSha256: framework.contentSha256,
      };
      for (const group of listing.groups)
        for (const document of group.documents) {
          const member = members.find((candidate) => candidate.agentKey === group.type.agentKey && candidate.documentId === document.documentId);
          if (member) document.latestRevisionId = member.revisionId;
          document.approvedCurrent = { revisionId: document.latestRevisionId, number: member?.revisionNumber ?? 3 };
          if (stale && group.type.agentKey === 'boilerplates')
            document.needsRebuild = { builtFrom: ref, rebuildFrom: { ...ref, revisionNumber: ref.revisionNumber + 1 } };
        }
      await setupKit(page, { listing, approvedFramework: true, approvedPrintMembers: members });
      await page.route('**/api/mktg-agents/slides-export/family/last?*', (route) => {
        const params = new URL(route.request().url()).searchParams;
        if (route.request().method() !== 'GET' || params.get('project') !== KIT_PROJECT.uid || params.get('familyId') !== 'positioning-brand') {
          return route.fallback();
        }
        return route.fulfill({ json: { last: null, currentMembers: members, skippedMembers: [], stale: false } });
      });
      await openKit(page, '/families/positioning-brand');
      // All approved immutable reads happen before either export action is chosen.
      await expect(page.getByTestId('family-export-pdf').getByRole('button')).toBeEnabled();
      expect(requests).toEqual(
        expect.arrayContaining(members.map((member) => `GET /api/mktg-agents/documents/${member.agentKey}/${member.documentId}/revisions/${member.revisionId}`))
      );
      if (stale) await expect(page.getByTestId('mktg-family-rebuild').getByRole('button')).toHaveText('Update boilerplates');
      else {
        const primary = page.getByTestId('mktg-family-run').getByRole('button', { name: 'Export the kit' });
        await primary.click();
        await expect(page.getByTestId('family-export-pdf').getByRole('button')).toBeFocused();
      }
      // Revealing the export card prepares reads only: no export, rebuild or other write.
      expect(requests.filter((request) => !request.startsWith('GET '))).toEqual([]);
      await page.screenshot({ path: test.info().outputPath(`family-approved-${stale}.png`), fullPage: true });
    });
  }
  test('family breadcrumb returns to the kit instead of the last stored asset', async ({ page }) => {
    await setupKit(page, { loaded: true });
    await openKit(page, '/families/positioning-brand');
    await expect(page.getByTestId('mktg-family-open-boilerplates')).toBeVisible();
    await page.getByTestId('mktg-breadcrumb-link-0').click();
    await expect(page).toHaveURL(/\/mktg-os-agents\?project=kit-synthetic-project$/);
    await expect(page.getByTestId('mktg-kit-page')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('family-breadcrumb-kit.png'), fullPage: true });
  });
  test('clicking a non-last row outside its link opens that row’s document', async ({ page }) => {
    await setupKit(page, { loaded: true });
    await openKit(page, '/families/positioning-brand');
    await expect(page.getByTestId('mktg-family-open-boilerplates')).toBeVisible();
    const state = page.getByTestId('mktg-family-state-messaging-framework');
    await state.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    const cell = await state.boundingBox();
    if (!cell) throw new Error('Missing visible framework state cell');
    // The stretched anchor intentionally receives clicks on the non-link cell area.
    await page.mouse.click(cell.x + cell.width / 2, cell.y + cell.height / 2);
    await expect(page).toHaveURL(/\/documents\/foundation-message\/living\?project=kit-synthetic-project/);
    await expect(page.getByTestId('mktg-framework-view')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('family-row-framework.png'), fullPage: true });
  });
  test('clicking the family title does not open an asset', async ({ page }) => {
    await setupKit(page, { loaded: true });
    await openKit(page, '/families/positioning-brand');
    await expect(page.getByTestId('mktg-family-open-boilerplates')).toBeVisible();
    const familyUrl = page.url();
    await page.getByTestId('mktg-family-title').click();
    await expect(page).toHaveURL(familyUrl);
    await expect(page.getByTestId('mktg-family-assets')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('family-title-inert.png'), fullPage: true });
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
    await expect(page.getByTestId('mktg-family-run').getByRole('link')).toHaveText('Create messaging framework');
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
      await expect(page.getByTestId(`mktg-family-run-reason-${id}`)).toHaveText('· after the framework is approved');
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
    await expect(page.getByTestId('mktg-family-actions')).toHaveCount(0);
    await expect(page.getByTestId('mktg-family-assets')).toHaveCount(0);
    release();
    await expect(page.getByTestId('mktg-family-asset-messaging-framework')).toContainText('Draft');
    await expect(page.getByTestId('mktg-family-loading')).toBeAttached();
    await expect(page.getByTestId('mktg-family-loading')).toBeEmpty();
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
    await expect(page.getByTestId('mktg-family-actions')).toHaveCount(0);
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
  test('names the available one-off Create steps without offering a rebuild', async ({ page }) => {
    await setupKit(page);
    await openKit(page, '/families/website-web');
    await expect(page.getByTestId('mktg-family-state-aeo-geo')).toContainText('Not run yet');
    await expect(page.getByTestId('mktg-family-run').getByRole('link')).toHaveAccessibleName('Create AEO/GEO scorecard');
    await expect(page.getByTestId('mktg-family-run-aeo-geo').getByRole('link')).toHaveText('Create AEO/GEO scorecard');
    await expect(page.getByTestId('mktg-family-rebuild')).toHaveCount(0);
    await openKit(page, '/families/member-sponsor');
    await expect(page.getByTestId('mktg-family-run').getByRole('link')).toHaveAccessibleName('Create Member 360');
    await expect(page.getByTestId('mktg-family-run-next')).toHaveCount(0);
    await expect(page.getByTestId('mktg-family-run-unavailable')).toHaveCount(0);
    await expect(page.getByTestId('mktg-family-run-coming-soon')).toHaveCount(0);
    await expect(page.getByTestId('mktg-family-asset-member-360')).toBeVisible();
  });
  for (const [familyId, agentId, label] of [
    ['social-community', 'linkedin-post', 'LinkedIn post'],
    ['member-sponsor', 'member-360', 'Member 360'],
  ]) {
    test(`${familyId} keeps Create and moves built-row entry to the document`, async ({ page }) => {
      const listing = kitDocuments(false);
      await setupKit(page, { listing });
      await openKit(page, '/families/' + familyId);
      await expect(page.getByTestId('mktg-family-run').getByRole('link')).toHaveText('Create ' + label);
      const action = page.getByTestId(`mktg-family-run-${agentId}`).getByRole('link');
      await expect(action).toHaveText('Create ' + label);
      await expect(action).toHaveAttribute(
        'href',
        `/project/mktg-os-agents/${agentId}?project=${KIT_PROJECT.slug}${agentId === 'linkedin-post' ? '&mode=new' : ''}`
      );
      const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === agentId);
      if (!type) throw new Error('Missing synthetic one-off type');
      const group = listing.groups.find((entry) => entry.type.agentKey === agentId);
      if (!group) throw new Error('Missing synthetic group');
      group.documents.push({
        agentKey: type.agentKey,
        documentId: 'run-000000000000000000000001',
        revisionCount: 1,
        latestRevisionId: 'synthetic',
        approvedCurrent: null,
        createdAt: new Date().toISOString(),
        updatedAt: null,
      });
      await openKit(page, '/families/' + familyId);
      await expect(action).toHaveCount(0);
      await expect(page.getByTestId(`mktg-family-open-${agentId}`)).toBeVisible();
      await expect(page.getByTestId('mktg-family-run').getByRole('link')).toHaveText('Create ' + label);
      await expect(page.getByTestId('mktg-family-run-next')).toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath(`family-${agentId}-run-again.png`), fullPage: true });
    });
  }
  for (const entry of [
    { name: 'last URL inputs', source: 'url', value: 'https://source.example/previous', share: '' },
    { name: 'oversized text re-entry', source: 'text', value: '', share: 'https://current.example/' },
  ]) {
    test(`LinkedIn Draft another opens ${entry.name} without starting a run`, async ({ page }) => {
      const answers: Record<string, string> = { content_source: entry.source, share_link: entry.share };
      if (entry.source === 'url') answers['content_url'] = entry.value;
      await setupKit(page, {
        loaded: true,
        intakes: {
          'linkedin-post': {
            answers,
            documentCount: 0,
            logoCount: 0,
          },
        },
      });
      const profile = linkedinProfileFromSetup({ name: 'Synthetic author', role: 'Maintainer', focus_areas: 'Code', primary_audience: 'Developers' });
      await page.route('**/api/mktg-agents/linkedin-post/profile', (route) =>
        route.fulfill({ json: { profile: { profile, profile_markdown: '# Synthetic profile' } } })
      );
      const type = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.agentKey === 'linkedin-post');
      if (!type) throw new Error('Missing synthetic LinkedIn document type');
      const document = kitRevision(type);
      const output = linkedinEnvelope();
      const response = {
        ...document,
        linkedinPost: { author: { name: 'Synthetic author' }, isAuthor: true, options: output.options, notes: output.notes, answers: { share_link: '' } },
      };
      const path = `/api/mktg-agents/documents/linkedin-post/${document.documentId}`;
      await page.route(
        (url) => url.pathname === path || url.pathname === `${path}/revisions/${document.revision.id}`,
        (route) =>
          route.request().method() === 'GET' && new URL(route.request().url()).searchParams.get('project') === KIT_PROJECT.uid
            ? kitJson(route, response)
            : route.fallback()
      );
      await openKit(page, '/families/social-community');
      await page.getByTestId('mktg-family-open-linkedin-post').click();
      await page.getByTestId('mktg-linkedin-draft-another').getByRole('button').click();
      await expect(page).toHaveURL(/linkedin-post\?project=kit-synthetic-project&mode=new(?:&source=text)?$/);
      await expect(page.getByTestId(`mktg-linkedin-source-${entry.source}`)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('textbox', { name: 'The content to post about', exact: true })).toHaveValue(entry.value);
      await expect(page.getByRole('textbox', { name: /Link to share/ })).toHaveValue(entry.share);
      if (entry.source === 'text') await expect(page.getByTestId('mktg-linkedin-intake-note')).toContainText('paste it again');
      await expect(page.getByTestId('mktg-linkedin-draft').getByRole('button')).toBeEnabled();
      await page.screenshot({ path: test.info().outputPath(`linkedin-${entry.source}-inputs.png`), fullPage: true });
    });
  }
  test('header and row Run links preserve native modifier clicks with project and fresh mode', async ({ page, context }) => {
    await setupKit(page);
    await openKit(page, '/families/positioning-brand');
    const action = page.getByTestId('mktg-family-run').getByRole('link');
    await expect(action).toHaveText('Create messaging framework');
    const href = `/project/mktg-os-agents/foundation-setup?project=${KIT_PROJECT.slug}&mode=new`;
    await expect(action).toHaveAttribute('href', href);
    // Stub only the new tab's document navigation; no live session or generation is needed to prove native linking.
    await context.route(
      (url) => url.pathname === '/project/mktg-os-agents/foundation-setup',
      (route) => route.fulfill({ contentType: 'text/html', body: '<main>Synthetic fresh intake destination</main>' })
    );
    for (const id of ['mktg-family-run', 'mktg-family-run-messaging-framework']) {
      const newPage = context.waitForEvent('page');
      await page
        .getByTestId(id)
        .getByRole('link')
        .click({ modifiers: ['ControlOrMeta'] });
      const destination = await newPage;
      await destination.waitForURL((url) => url.pathname + url.search === href);
      await destination.waitForLoadState('domcontentloaded');
      await expect(page.getByTestId('mktg-family-assets')).toBeVisible();
      await destination.close();
    }
    await page.screenshot({ path: test.info().outputPath('family-header-native-link.png'), fullPage: true });
  });
  for (const familyId of ['positioning-brand', 'social-community']) {
    test(`a denied ${familyId} listing hides primary actions and private state`, async ({ page }) => {
      await setupKit(page, { writer: false });
      await openKit(page, '/families/' + familyId);
      await expect(page.getByTestId('mktg-family-actions')).toHaveCount(0);
      await expect(page.getByTestId('mktg-family-error')).toContainText('write access');
      await expect(page.getByTestId('mktg-family-assets')).toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath(`family-reader-run-${familyId}.png`), fullPage: true });
    });
  }
  test('no access does not disclose asset states', async ({ page }) => {
    await setupKit(page, { writer: false });
    await openKit(page, '/families/positioning-brand');
    await expect(page.getByTestId('mktg-family-error')).toContainText('write access');
    await expect(page.getByTestId('mktg-family-assets')).toHaveCount(0);
  });
});
