// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Messaging Framework view: the sub-panel empty states, through the real template.
 *
 * A stored Messaging Framework revision whose framework states nothing to avoid, whose report read
 * no source, failed on none, left no gap and raised no check must SAY so in each panel rather than
 * render a blank. The unit spec renders the view against a host; this pins the same fallbacks
 * through the real route, guard, document view and HTTP client, with the document and revision
 * reads stubbed so the page never reaches the real BFF.
 *
 * Coverage:
 *   F1  Framework tab, empty avoid list: `mktg-framework-view-avoid-empty`
 *   F2  Sources and gaps tab, nothing read / nothing failed / no gap / nothing to check:
 *       `mktg-framework-view-sources-read-empty`, `-sources-failed-empty`, `-gaps-empty`, `-checks-empty`
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
  MKTG_OS_AGENTS_ENABLED_FLAG,
  MKTG_OS_AGENTS_ROUTE_SEGMENT,
  PERSONA_COOKIE_KEY,
  SELECTED_PROJECT_COOKIE_KEY,
} from '@lfx-one/shared/constants';
import type {
  FoundationMessageContent,
  MktgDocumentDetailResponse,
  MktgDocumentType,
  MktgRevisionResponse,
  MktgRevisionSummary,
  PersistedPersonaState,
  PersonaType,
} from '@lfx-one/shared/interfaces';
import { expect, Page, Route, test } from '@playwright/test';

const PAGE_LOAD_TIMEOUT = 20_000;
const PROJECT_UID = 'p0000000-0000-0000-0000-00000000f0f0';
const PROJECT_SLUG = 'mktg-framework-e2e-project';
const PROJECT_NAME = 'Framework E2E Project';
const DOCUMENT_ID = 'messaging-framework';
const CONTENT_SHA = '0000000000000000000000000000000000000000000000000000000000000001';
const REVISION_ID = `1-${CONTENT_SHA}`;

const pair = (a: string, b: string): [string, string] => [a, b];

/**
 * A framework with nothing to avoid — the smallest content the shared validator accepts
 * (`FOUNDATION_MESSAGE_CONTENT_LIMITS`: every other list needs at least one entry).
 */
const CONTENT: FoundationMessageContent = {
  mf: {
    vision: 'A vision.',
    mission: 'A mission.',
    positioning: 'For platform teams, the project is the open release toolkit.',
    tagline: 'Release, open.',
    goals: [
      { id: 'adoption', n: 1, t: 'Adoption', vp: 'VP.', key: 'Key.', proof: [pair('1,200 members', 'Website')], bite: 'Adoption in the open', icps: ['users'] },
    ],
    crosscut: 'Every column grows the audience.',
    say: ['open release'],
    avoid: [],
    anchor: ['Which goal does this serve?'],
    notes: '',
  },
  icp: [
    {
      id: 'users',
      name: 'End users',
      kind: 'Individual',
      who: 'Engineers.',
      goals: ['adoption'],
      need: 'Need.',
      value: 'Value.',
      lead: 'Ship with confidence.',
      proof: [pair('A fact', 'Docs')],
      cta: 'Try it.',
      channels: ['Docs'],
      objection: ['Too early?', null],
      personas: [pair('SRE', 'uptime')],
      basis: 'Website',
    },
  ],
  mh: {
    umbrella: 'Umbrella.',
    line: 'Release, open.',
    pillars: [{ t: 'Open', m: 'Open message.', p: [pair('Fact', 'Web')] }],
    found: 'A Linux Foundation project.',
    aud: [pair('End users', 'Ship with confidence.')],
  },
  nums: [pair('1,200', 'members')],
};

function fulfillJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

function frameworkType(): MktgDocumentType {
  const type = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.agentKey === 'foundation-message');
  if (!type) {
    throw new Error('MKTG_DOCUMENT_TYPES has no foundation-message type');
  }
  return type;
}

/** The one stored revision: a JSON asset whose report read nothing, failed on nothing and found no gap. */
function revisionSummary(): MktgRevisionSummary {
  return {
    id: REVISION_ID,
    number: 1,
    createdAt: '2026-10-17T10:00:00.000Z',
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
  return { project: PROJECT_UID, type: frameworkType(), documentId: DOCUMENT_ID, revisions: [revisionSummary()] };
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
  // The document read (`/documents/foundation-message/<id>?project=`), then the revision read the view chains after it.
  await page.route(new RegExp(`/api/mktg-agents/documents/foundation-message/${DOCUMENT_ID}\\?`), (route) => fulfillJson(route, documentDetail()));
  await page.route(new RegExp(`/api/mktg-agents/documents/foundation-message/${DOCUMENT_ID}/revisions/`), (route) => fulfillJson(route, revisionResponse()));
}

/**
 * Boots the app and lands on the document view by SPA navigation: a full navigation would SSR the
 * route on the Express server, whose fetches bypass `page.route` and hit the real BFF.
 */
async function gotoFrameworkDocument(page: Page): Promise<void> {
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
  }, `/project/${MKTG_OS_AGENTS_ROUTE_SEGMENT}/documents/foundation-message/${DOCUMENT_ID}?project=${PROJECT_SLUG}`);

  await expect(page.getByTestId('mktg-document-view-page')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  await expect(page.getByTestId('mktg-framework-view')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
}

test.describe('Messaging Framework view empty states', () => {
  // The shell's sidebar is `hidden lg:flex`; a desktop viewport keeps the boot assertion valid on every project.
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(() => {
    if (!process.env.TEST_USERNAME || !process.env.TEST_PASSWORD) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  });

  test('F1: a framework with nothing to avoid says so on the framework tab', async ({ page }) => {
    await gotoFrameworkDocument(page);

    // The framework tab is the one open on arrival; its positioning proves the stored JSON rendered.
    await expect(page.getByTestId('mktg-framework-view-positioning')).toContainText('open release toolkit');
    const avoidEmpty = page.getByTestId('mktg-framework-view-avoid-empty');
    await expect(avoidEmpty).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(avoidEmpty).toHaveText('Nothing to avoid was stated.');
    await expect(page.getByTestId('mktg-framework-view-avoid')).toHaveCount(0);
  });

  test('F2: an empty report says nothing was read, every source was read, no gap was left and nothing is to check', async ({ page }) => {
    await gotoFrameworkDocument(page);

    await page.getByTestId('mktg-framework-view-tab-sources').click();

    await expect(page.getByTestId('mktg-framework-view-sources-read-empty')).toHaveText('Nothing was read.');
    await expect(page.getByTestId('mktg-framework-view-sources-failed-empty')).toHaveText('Every source was read.');
    await expect(page.getByTestId('mktg-framework-view-gaps-empty')).toHaveText('The sources left no gap.');
    await expect(page.getByTestId('mktg-framework-view-checks-empty')).toHaveText('Nothing to check.');
    // No list is rendered where its fallback is shown.
    await expect(page.getByTestId('mktg-framework-view-sources-read')).toHaveCount(0);
    await expect(page.getByTestId('mktg-framework-view-sources-failed')).toHaveCount(0);
    await expect(page.getByTestId('mktg-framework-view-gaps')).toHaveCount(0);
    await expect(page.getByTestId('mktg-framework-view-findings')).toHaveCount(0);
  });
});
