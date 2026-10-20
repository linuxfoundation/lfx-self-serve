// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * FAQ view: the sub-panel empty states, through the real template.
 *
 * A stored FAQ revision whose every question is answered from the sources, and whose report read
 * no source, failed on none, left no gap and raised no check, must SAY so in each panel rather than
 * render a blank. The unit spec renders the view against a host; this pins the same fallbacks
 * through the real route, guard, document view and HTTP client, with the document and revision
 * reads stubbed so the page never reaches the real BFF.
 *
 * Coverage:
 *   Q1  Needs an answer tab, nothing unanswered: `mktg-faq-view-unanswered-empty`
 *   Q2  Sources and gaps tab, nothing read / nothing failed / no gap / nothing to check:
 *       `mktg-faq-view-sources-read-empty`, `-sources-failed-empty`, `-gaps-empty`, `-checks-empty`
 *
 * Prerequisites:
 * - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 * - `apps/lfx-one/.env` populated with TEST_USERNAME / TEST_PASSWORD
 *
 * The Marketing OS pages are dark-launched behind `mktg-os-agents-enabled`; the flag is pinned on
 * through the non-production localStorage override, so no LaunchDarkly targeting is needed.
 */

import {
  FEATURE_FLAG_OVERRIDE_STORAGE_KEY,
  LENS_COOKIE_KEY,
  MKTG_DOCUMENT_TYPES,
  MKTG_LIVING_DOCUMENT_ID,
  MKTG_OS_AGENTS_ENABLED_FLAG,
  MKTG_OS_AGENTS_ROUTE_SEGMENT,
  PERSONA_COOKIE_KEY,
  SELECTED_PROJECT_COOKIE_KEY,
} from '@lfx-one/shared/constants';
import type {
  FaqContent,
  MktgDocumentDetailResponse,
  MktgDocumentType,
  MktgRevisionResponse,
  MktgRevisionSummary,
  PersistedPersonaState,
  PersonaType,
} from '@lfx-one/shared/interfaces';
import { expect, Page, Route, test } from '@playwright/test';

const PAGE_LOAD_TIMEOUT = 20_000;
const PROJECT_UID = 'p0000000-0000-0000-0000-00000000faq0';
const PROJECT_SLUG = 'mktg-faq-e2e-project';
const PROJECT_NAME = 'FAQ E2E Project';
const DOCUMENT_ID = MKTG_LIVING_DOCUMENT_ID;
const CONTENT_SHA = '0000000000000000000000000000000000000000000000000000000000000002';
const REVISION_ID = `1-${CONTENT_SHA}`;

/**
 * An FAQ whose every question is answered — the smallest content the shared validator accepts
 * (`FAQ_CONTENT_LIMITS`: at least one group with at least one question), with no `null` answer,
 * so the view reads no unanswered question off it.
 */
const CONTENT: FaqContent = {
  faq: [['About the project', [['What is the project?', 'The project is an open release toolkit.', 'Website']]]],
};

function fulfillJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

function faqType(): MktgDocumentType {
  const type = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.agentKey === 'faq');
  if (!type) {
    throw new Error('MKTG_DOCUMENT_TYPES has no faq type');
  }
  return type;
}

/** The one stored revision: a JSON asset whose report read nothing, failed on nothing and found no gap. */
function revisionSummary(): MktgRevisionSummary {
  return {
    id: REVISION_ID,
    number: 1,
    createdAt: '2026-10-19T10:00:00.000Z',
    origin: 'generated',
    restoredFromNumber: null,
    intakeMode: 'form',
    status: '',
    contentSha256: CONTENT_SHA,
    format: 'json',
    commentCount: 0,
    latest: true,
  };
}

function documentDetail(): MktgDocumentDetailResponse {
  return { project: PROJECT_UID, type: faqType(), documentId: DOCUMENT_ID, revisions: [revisionSummary()] };
}

function revisionResponse(): MktgRevisionResponse {
  return {
    ...documentDetail(),
    revision: revisionSummary(),
    markdown: JSON.stringify(CONTENT),
    sidecar: { mode: 'draft', report: { sources_read: [], sources_failed: [], gaps: [], notes: '' }, checks: { findings: [] } },
  };
}

async function pinMktgFlag(page: Page): Promise<void> {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key as string, value as string), [
    FEATURE_FLAG_OVERRIDE_STORAGE_KEY,
    JSON.stringify({ [MKTG_OS_AGENTS_ENABLED_FLAG]: true }),
  ] as const);
}

async function seedContextCookies(page: Page): Promise<void> {
  const persona: PersistedPersonaState = { primary: 'executive-director' as PersonaType, all: ['executive-director' as PersonaType] };
  await page.context().addCookies([
    { name: PERSONA_COOKIE_KEY, value: encodeURIComponent(JSON.stringify(persona)), domain: 'localhost', path: '/', sameSite: 'Lax' },
    { name: LENS_COOKIE_KEY, value: 'project', domain: 'localhost', path: '/', sameSite: 'Lax' },
    {
      name: SELECTED_PROJECT_COOKIE_KEY,
      value: encodeURIComponent(JSON.stringify({ uid: PROJECT_UID, slug: PROJECT_SLUG, name: PROJECT_NAME })),
      domain: 'localhost',
      path: '/',
      sameSite: 'Lax',
    },
  ]);
}

/** The project lens context and the document view's two reads, all stubbed so the page never reaches the real BFF. */
async function stubContext(page: Page): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    fulfillJson(route, { personas: ['executive-director'], personaProjects: {}, projects: [], organizations: [], isRootWriter: true })
  );
  await page.route(`**/api/projects/${PROJECT_SLUG}*`, (route) =>
    fulfillJson(route, { uid: PROJECT_UID, slug: PROJECT_SLUG, name: PROJECT_NAME, parent_uid: '', writer: true })
  );
  await page.route('**/api/projects/*/sfid*', (route) => fulfillJson(route, { sfid: null }));
  // Without this the app loads the test account's REAL projects and can override the seeded context.
  await page.route('**/api/nav/lens-items*', (route) => {
    const isFoundation = new URL(route.request().url()).searchParams.get('lens') !== 'project';
    const items = isFoundation ? [] : [{ uid: PROJECT_UID, slug: PROJECT_SLUG, name: PROJECT_NAME, logoUrl: null, isFoundation: false }];
    return fulfillJson(route, { items, next_page_token: null, upstream_failed: false, lens: isFoundation ? 'foundation' : 'project' });
  });
  // The document read (`/documents/faq/<id>?project=`), then the revision read the view chains after it.
  await page.route(new RegExp(`/api/mktg-agents/documents/faq/${DOCUMENT_ID}\\?`), (route) => fulfillJson(route, documentDetail()));
  await page.route(new RegExp(`/api/mktg-agents/documents/faq/${DOCUMENT_ID}/revisions/`), (route) => fulfillJson(route, revisionResponse()));
}

/**
 * Boots the app and lands on the document view by SPA navigation: a full navigation would SSR the
 * route on the Express server, whose fetches bypass `page.route` and hit the real BFF.
 */
async function gotoFaqDocument(page: Page): Promise<void> {
  await pinMktgFlag(page);
  await seedContextCookies(page);
  await stubContext(page);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  // The '/' boot can Set-Cookie the account's real selection; re-assert the intended context.
  await seedContextCookies(page);
  await page.evaluate((url) => {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/project/${MKTG_OS_AGENTS_ROUTE_SEGMENT}/documents/faq/${DOCUMENT_ID}?project=${PROJECT_SLUG}`);

  await expect(page.getByTestId('mktg-document-view-page')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  await expect(page.getByTestId('mktg-faq-view')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
}

test.describe('FAQ view empty states', () => {
  // The shell's sidebar is `hidden lg:flex`; a desktop viewport keeps the boot assertion valid on every project.
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(() => {
    if (!process.env['TEST_USERNAME'] || !process.env['TEST_PASSWORD']) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  });

  test('Q1: an FAQ with every question answered says so on the needs-an-answer tab', async ({ page }) => {
    await gotoFaqDocument(page);

    // The FAQ tab is the one open on arrival; its answer proves the stored JSON rendered.
    await expect(page.getByTestId('mktg-faq-view-question-0-0')).toContainText('open release toolkit');
    // Nothing is unanswered, so neither the header chip nor the callout shows.
    await expect(page.getByTestId('mktg-faq-view-unanswered-chip')).toHaveCount(0);
    await expect(page.getByTestId('mktg-faq-view-unanswered-callout')).toHaveCount(0);

    await page.getByTestId('mktg-faq-view-tab-unanswered').click();

    const unansweredEmpty = page.getByTestId('mktg-faq-view-unanswered-empty');
    await expect(unansweredEmpty).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(unansweredEmpty).toHaveText('Every question is answered from the sources.');
    await expect(page.getByTestId('mktg-faq-view-unanswered-list')).toHaveCount(0);
  });

  test('Q2: an empty report says nothing was read, every source was read, no gap was left and nothing is to check', async ({ page }) => {
    await gotoFaqDocument(page);

    await page.getByTestId('mktg-faq-view-tab-sources').click();

    await expect(page.getByTestId('mktg-faq-view-sources-read-empty')).toHaveText('Nothing was read.');
    await expect(page.getByTestId('mktg-faq-view-sources-failed-empty')).toHaveText('Every source was read.');
    await expect(page.getByTestId('mktg-faq-view-gaps-empty')).toHaveText('The sources left no gap.');
    await expect(page.getByTestId('mktg-faq-view-checks-empty')).toHaveText('Nothing to check.');
    // No list is rendered where its fallback is shown.
    await expect(page.getByTestId('mktg-faq-view-sources-read')).toHaveCount(0);
    await expect(page.getByTestId('mktg-faq-view-sources-failed')).toHaveCount(0);
    await expect(page.getByTestId('mktg-faq-view-gaps')).toHaveCount(0);
    await expect(page.getByTestId('mktg-faq-view-report-notes')).toHaveCount(0);
    await expect(page.getByTestId('mktg-faq-view-findings')).toHaveCount(0);
  });
});
