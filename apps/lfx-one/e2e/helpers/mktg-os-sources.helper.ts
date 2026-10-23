// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_DOCUMENT_TYPES } from '../../../../packages/shared/src/constants/mktg-document-store.constants';
import { MKTG_LAST_INTAKE_API } from '../../../../packages/shared/src/constants/mktg-last-intake.constants';
import { BRAND_KIT_INTAKE } from '../../../../packages/shared/src/constants/mktg-run.constants';
import { expect, Page } from '@playwright/test';
import { ApiMockHelper } from './api-mock.helper';
import { suppressCookieBanner } from './account-settings-email.helper';
import { DOCUMENT_PROJECT, fulfillDocumentJson } from './mktg-os-documents.helper';
import { setupNoQuestionsHandoff } from './mktg-os-handoff.helper';
import { DATA_LOAD_TIMEOUT } from './mktg-os-assets.helper';

/** Keep the shared sidebar setup at desktop width, then restore the actual device before any assertions/actions. */
export async function withDesktopSourcesSetup<T>(page: Page, setup: () => Promise<T>): Promise<T> {
  const viewport = page.viewportSize();
  if (viewport) await page.setViewportSize({ width: 1440, height: 1000 });
  try {
    return await setup();
  } finally {
    if (viewport && !page.isClosed()) await page.setViewportSize(viewport);
  }
}

/** Fresh-mode page proof; all agent/project/dependency/session data are synthetic. */
export async function setupFreshSources(page: Page, options: { state?: 'loaded' | 'empty' | 'error' | 'denied' | 'loading'; logoCount?: number } = {}) {
  await suppressCookieBanner(page);
  const handoff = await withDesktopSourcesSetup(page, () => setupNoQuestionsHandoff(page));
  await page.route('**/api/nav/lens-items*', (route) => {
    const lens = new URL(route.request().url()).searchParams.get('lens');
    return fulfillDocumentJson(route, {
      items: lens === 'project' || lens === 'foundation' ? [{ ...DOCUMENT_PROJECT, logoUrl: null, isFoundation: lens === 'foundation' }] : [],
      next_page_token: null,
      upstream_failed: false,
      lens,
    });
  });
  const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === BRAND_KIT_INTAKE.agentId && entry.kind === 'living');
  if (!type) throw new Error('Missing registered synthetic source type');
  if (options.state === 'denied') await ApiMockHelper.setupProjectSlugMock(page, { writer: false });
  const answers = {
    project_name: 'Synthetic source project',
    website_url: 'https://previous.example',
    brand_page_url: '',
    notes: 'Previous synthetic source notes.',
  };
  const generated: Record<string, unknown>[] = [];
  let polls = 0;
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'POST') return;
    if (path === BRAND_KIT_INTAKE.endpoints.generate) generated.push(request.postDataJSON() as Record<string, unknown>);
    if (path === BRAND_KIT_INTAKE.endpoints.result) polls++;
  });
  let release: () => void = () => undefined;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**${MKTG_LAST_INTAKE_API}/${type.agentKey}/last?*`, async (route) => {
    if (options.state === 'loading') await waiting;
    if (options.state === 'denied') return fulfillDocumentJson(route, { code: 'DENIED' }, 403);
    if (options.state === 'error') return fulfillDocumentJson(route, { code: 'MKTG_LAST_INTAKE_UNAVAILABLE' }, 503);
    return fulfillDocumentJson(route, { intake: options.state === 'empty' ? null : { answers, documentCount: 0, logoCount: options.logoCount ?? 0 } });
  });
  return {
    handoff,
    answers,
    generated,
    polls: () => polls,
    releaseHistory: () => release(),
    open: async (mount: 'project' | 'foundation' = 'project') => {
      await page.evaluate((destination) => {
        history.pushState({}, '', destination);
        dispatchEvent(new PopStateEvent('popstate'));
      }, `/${mount}/mktg-os-agents/${BRAND_KIT_INTAKE.agentId}?project=${DOCUMENT_PROJECT.slug}&mode=new`);
      await expect(page.getByTestId('mktg-run-sources')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    },
  };
}
