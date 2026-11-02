// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  FEATURE_FLAG_OVERRIDE_STORAGE_KEY,
  LENS_COOKIE_KEY,
  MEMBER_360_WORKBOOK_CONTENT_TYPE,
  MKTG_DOCUMENT_TYPES,
  PERSONA_COOKIE_KEY,
  SELECTED_PROJECT_COOKIE_KEY,
} from '@lfx-one/shared/constants';
import { createHash } from 'node:crypto';
import type { MktgDocumentDetailResponse, MktgDocumentRunProgress, MktgRunFailureReason } from '@lfx-one/shared/interfaces';
import { expect, Page, Route } from '@playwright/test';

import { member360Fixture, member360Revision, MEMBER_360_PROJECT, MEMBER_360_STORED_DOCUMENT } from '../fixtures/mock-data/member-360.mock';
export { MEMBER_360_DOCUMENT_ID } from '../fixtures/mock-data/member-360.mock';
import { buildMember360Workbook } from '../../src/server/utils/member-360-workbook.util';
import { ApiMockHelper } from './api-mock.helper';
import { suppressCookieBanner } from './account-settings-email.helper';

export function json(route: Route, body: unknown): Promise<void> {
  return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
}

/** All API data, rights and auth are synthetic; no Guild key or real user session. */
export async function setupMember360(page: Page, options: { writer?: boolean; stored?: boolean; emptyEvidence?: boolean } = {}): Promise<void> {
  await suppressCookieBanner(page);
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: `Unmocked API endpoint: ${route.request().url()}` }) })
  );
  await page.route('**/api/mktg-agents/member-360/tracker?*', (route) => {
    expect(route.request().headers()['content-type']).toBe('application/octet-stream');
    expect(new URL(route.request().url()).searchParams.get('project')).toBe(MEMBER_360_PROJECT.uid);
    return json(route, {
      trackerId: 'a'.repeat(64),
      rowCount: 1,
      columnCount: 3,
      byteCount: 100,
    });
  });
  await page.route('**/api/mktg-agents/member-360/tracker/*?*', async (route) => {
    expect(route.request().method()).toBe('DELETE');
    expect(new URL(route.request().url()).searchParams.get('project')).toBe(MEMBER_360_PROJECT.uid);
    expect(route.request().postData()).toBeNull();
    await route.fulfill({ status: 204 });
  });
  await page.route('**/api/mktg-agents/member-360/documents/*/workbook?*', async (route) => {
    expect(new URL(route.request().url()).searchParams.get('project')).toBe(MEMBER_360_PROJECT.uid);
    await route.fulfill({
      contentType: MEMBER_360_WORKBOOK_CONTENT_TYPE,
      headers: { 'content-disposition': 'attachment; filename="Member360_sample-foundation_2026-Q3.xlsx"' },
      body: Buffer.from(await buildMember360Workbook(member360Fixture())),
    });
  });
  await ApiMockHelper.setupProjectSlugMock(page, { writer: options.writer ?? true, project: MEMBER_360_PROJECT });
  await page.route(/\/api\/projects(?:\?|$)/, (route) => json(route, [{ ...MEMBER_360_PROJECT, writer: options.writer ?? true }]));
  await page.route('**/api/projects/writer-summary', (route) => json(route, { hasWriterFoundation: false, hasWriterProject: options.writer ?? true }));
  await page.route('**/api/nav/favorite-projects', (route) => json(route, { value: '[]' }));
  await page.route('**/api/mktg-agents/*/stored?*', (route) => route.fulfill({ status: 404, body: '{}' }));
  await page.route('**/api/user/personas*', (route) =>
    json(route, { personas: ['executive-director'], personaProjects: {}, projects: [], organizations: [], isRootWriter: true })
  );
  await page.route('**/api/nav/lens-items*', (route) =>
    json(route, {
      items:
        new URL(route.request().url()).searchParams.get('lens') === 'project'
          ? [{ uid: MEMBER_360_PROJECT.uid, slug: MEMBER_360_PROJECT.slug, name: MEMBER_360_PROJECT.name, logoUrl: null, isFoundation: false }]
          : [],
      next_page_token: null,
      upstream_failed: false,
    })
  );
  await page.route('**/api/projects/*/sfid*', (route) => json(route, { sfid: null }));
  await page.route('**/api/mktg-agents/documents**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const view = member360Revision();
    if (options.emptyEvidence && view.member360) {
      view.member360.tabs.evidence = [];
      view.member360.content_sha256 = createHash('sha256').update(JSON.stringify(view.member360.tabs)).digest('hex');
    }
    if (!path.endsWith('/documents')) return json(route, view);
    return json(route, {
      project: MEMBER_360_PROJECT.uid,
      groups: MKTG_DOCUMENT_TYPES.map((type) => ({
        type,
        documents: options.stored && type.agentKey === 'member-360' ? [MEMBER_360_STORED_DOCUMENT] : [],
      })),
    });
  });
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [FEATURE_FLAG_OVERRIDE_STORAGE_KEY, JSON.stringify({ 'mktg-os-agents-enabled': true })]
  );
  await page.context().addCookies([
    {
      name: PERSONA_COOKIE_KEY,
      value: encodeURIComponent(JSON.stringify({ primary: 'executive-director', all: ['executive-director'] })),
      domain: 'localhost',
      path: '/',
    },
    { name: LENS_COOKIE_KEY, value: 'project', domain: 'localhost', path: '/' },
    {
      name: SELECTED_PROJECT_COOKIE_KEY,
      value: encodeURIComponent(JSON.stringify({ uid: MEMBER_360_PROJECT.uid, slug: MEMBER_360_PROJECT.slug, name: MEMBER_360_PROJECT.name })),
      domain: 'localhost',
      path: '/',
    },
  ]);
  // Use the public docs HTML solely as the app asset shell. Replace its auth
  // TransferState with a synthetic identity and skip root hydration because the
  // server rendered the public shell. No production auth path is changed.
  await page.route('**/docs', async (route) => {
    const response = await route.fetch();
    let html = await response.text();
    html = html.replace(/(<script[^>]*id="ng-state"[^>]*>)([\s\S]*?)(<\/script>)/, (_, open, body, close) => {
      const state = JSON.parse(body);
      state.runtimeConfig = { ...state.runtimeConfig, launchDarklyClientId: '', dataDogRumClientId: '', dataDogRumApplicationId: '', intercomAppId: '' };
      state.auth = {
        authenticated: true,
        user: {
          sub: 'synthetic-member-360-subject',
          name: 'Test Operator',
          email: 'operator@example.test',
          email_verified: true,
          picture: '',
          'https://sso.linuxfoundation.org/claims/username': 'synthetic-operator',
        },
        persona: 'executive-director',
        personas: ['executive-director'],
        organizations: [],
        projects: [],
        personaProjects: {},
      };
      return open + JSON.stringify(state).replace(/</g, '\\u003C') + close;
    });
    html = html.replace(/<lfx-root\b[^>]*>[\s\S]*?<\/lfx-root>/, '<lfx-root ngSkipHydration></lfx-root>');
    await route.fulfill({ response, body: html });
  });
  await page.goto('/docs', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('docs-shell-authed')).toBeAttached({ timeout: 20000 });
  await expect(page.getByTestId('docs-content')).toBeVisible({ timeout: 20000 });
}
/** Server-recorded progress; fixtures deliberately contain no creator/session capability or question text. */
export function member360Progress(
  state: MktgDocumentRunProgress['state'],
  failureReason?: MktgRunFailureReason,
  failureText?: string
): MktgDocumentDetailResponse {
  const view = member360Revision();
  return {
    project: view.project,
    type: view.type,
    documentId: view.documentId,
    revisions: [],
    current: null,
    approvedCurrent: null,
    runs: [
      {
        project: view.project,
        agentKey: view.type.agentKey,
        documentId: view.documentId,
        runId: 'b'.repeat(64),
        state,
        startedAt: '2026-10-19T10:00:00Z',
        failureReason,
        failureText,
        activity: Array.from({ length: 10 }, (_, index) => ({
          id: `step-${index + 1}`,
          kind: index % 2 ? 'search' : 'lfx',
          label: index % 2 ? 'Searching the web' : 'Checking LFX',
          status: index === 9 ? 'running' : 'done',
          startedAt: '2026-10-19T10:00:00Z',
        })),
      },
    ],
  };
}

export async function stubMember360Progress(page: Page, read: () => MktgDocumentDetailResponse): Promise<void> {
  await page.route('**/api/mktg-agents/documents/member-360/**', (route) =>
    json(route, new URL(route.request().url()).pathname.includes('/revisions/') ? member360Revision() : read())
  );
}

export async function selectMember360Option(page: Page, testId: string, label: string): Promise<void> {
  await page.getByTestId(testId).getByRole('combobox').click();
  await page.getByRole('option', { name: label, exact: true }).click();
}
export async function openMember360(page: Page, path = 'member-360'): Promise<void> {
  await page.evaluate((url) => {
    history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/project/mktg-os-agents/${path}?project=${MEMBER_360_PROJECT.slug}`);
  let testId = 'member-360-run-page';
  if (!path) testId = 'mktg-kit-page';
  if (path.startsWith('documents')) testId = 'mktg-document-view-page';
  await expect(page.getByTestId(testId)).toBeVisible({ timeout: 20000 });
}
