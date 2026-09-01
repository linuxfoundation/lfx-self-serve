// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Meeting owner as the displayed organizer + owner picker in the edit wizard — GH-1673.
 *
 * Coverage:
 *   - Meeting cards show the owner as the primary organizer, replacing created_by; a zero-valued
 *     owner (meetings predating the field) falls back to the human created_by.
 *   - The "Organized by me" filter follows ownership: a meeting owned by the viewer matches even
 *     when someone else created it, and a meeting the viewer created but transferred away does not.
 *   - The edit wizard's Meeting Details step renders the saved owner directly in the organizer
 *     search box (as "Name (email)"); an untouched save omits the `owner` key entirely so upstream
 *     preserves the stored owner (including profile_picture, which the form never carries).
 *   - Picking a user in the organizer field sends `owner: {username, name, email}` on update, and
 *     the box re-renders to show the freshly picked name/email instead of the previous selection.
 *   - The search pool is the same committee-member directory Invite Guests uses; the picker's
 *     "Enter details manually" affordance still covers anyone outside it. Manual entry sends
 *     `owner: {name, email}` (no username) and an invalid email blocks the step.
 *   - Clearing (in-field ⊗ or the "Revert" button) restores the saved owner rather than emptying
 *     the field — upstream has no owner-removal path, so the following save still omits the
 *     `owner` key (create flow with no saved owner instead empties every control).
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD
 */

import type { PersistedPersonaState, PersonaType } from '@lfx-one/shared/interfaces';
import { LENS_COOKIE_KEY, PERSONA_COOKIE_KEY, SELECTED_PROJECT_COOKIE_KEY } from '@lfx-one/shared/constants';
import { expect, Page, Route, test } from '@playwright/test';

test.setTimeout(120_000);

const PAGE_LOAD_TIMEOUT = 20_000;
const ELEMENT_TIMEOUT = 10_000;

const MEETINGS_URL = '/meetings';

// Deterministic, far-future start so `hasMeetingEnded` never drops the fixtures and the wizard's
// futureDateTimeValidator keeps the hydrated form valid.
const FUTURE_START = '2099-03-04T15:00:00Z';

const CREATOR = { name: 'Ada Lovelace', username: 'alovelace-e2e', email: 'ada-e2e@example.com' };
const OWNER = { name: 'Grace Hopper', username: 'ghopper-e2e', email: 'grace-e2e@example.com' };
// Meetings predating the owner field carry an all-empty owner object in the index — the display
// must treat it as absent and fall back to created_by.
const ZERO_VALUED_OWNER = { user_id: '', username: '', email: '', name: '', profile_picture: '' };

const PROJECT_UID = 'p0000000-0000-0000-0000-00000000e001';
const PROJECT_SLUG = 'owner-e2e-project';
const PROJECT_NAME = 'Owner E2E Project';
const MOCK_MEETING_UID = 'm0000000-0000-0000-0000-00000000e001';

// UserSearchResult shape returned by GET /api/search/users for the committee_member pool the
// organizer picker now searches (no avatar field).
const PICKED_USER = {
  uid: 'user-e2e-owner-1',
  email: OWNER.email,
  first_name: 'Grace',
  last_name: 'Hopper',
  username: OWNER.username,
  job_title: null,
  organization: null,
  committee: null,
  type: 'committee_member',
};

// Distinct from OWNER/PICKED_USER — the revert test hydrates OWNER as the saved baseline and
// then picks this person, so the saved-owner row actually has something to disagree with
// (picking PICKED_USER there would just re-select OWNER and the row would never appear).
const DIFFERENT_PICKED_USER = {
  uid: 'user-e2e-owner-2',
  email: 'radia-e2e@example.com',
  first_name: 'Radia',
  last_name: 'Perlman',
  username: 'rperlman-e2e',
  job_title: null,
  organization: null,
  committee: null,
  type: 'committee_member',
};

function fulfillJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

// Gated on env vars rather than on URL sniffing so genuine auth-flow regressions (expired
// storageState, broken Auth0 login helper) still fail loudly when creds ARE configured.
const AUTH_CREDS_PRESENT = !!process.env.TEST_USERNAME && !!process.env.TEST_PASSWORD;

function skipWhenAuthMissing(): void {
  if (!AUTH_CREDS_PRESENT) {
    test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  }
}

/**
 * The signed-in user's LFID comes from the SSR auth context (TransferState), not an API the test
 * can stub — so the Me-lens fixtures have to be built around whoever is actually logged in. Reads
 * it back out of the serialized state the same way the app does (`username`, then the namespaced
 * claim).
 */
async function readViewerLfid(page: Page): Promise<string | null> {
  const raw = await page.locator('#ng-state').textContent();
  if (!raw) {
    return null;
  }
  try {
    const state = JSON.parse(raw) as Record<string, { user?: Record<string, string> }>;
    const user = state['auth']?.user;
    return user?.['username'] || user?.['https://sso.linuxfoundation.org/claims/username'] || null;
  } catch {
    return null;
  }
}

async function stubMeLensContext(page: Page): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    fulfillJson(route, {
      personas: ['contributor'],
      personaProjects: {},
      projects: [],
      organizations: [],
      isRootWriter: false,
    })
  );

  // Per-card lookups (materials, recordings, summaries, transcripts) are irrelevant here and each
  // component already degrades on error — 404 keeps them off the real backend.
  await page.route('**/api/meetings/*/attachments*', (route) => route.fulfill({ status: 404, body: '{}' }));
  await page.route('**/api/past-meetings/**', (route) => route.fulfill({ status: 404, body: '{}' }));
}

function upcomingMeeting(id: string, title: string, createdBy: { name: string; username: string; email: string }, extra: Record<string, unknown> = {}) {
  return {
    id,
    uid: id,
    title,
    description: title,
    start_time: FUTURE_START,
    duration: 60,
    timezone: 'UTC',
    meeting_type: 'Board',
    visibility: 'public',
    restricted: false,
    project_uid: 'proj-e2e',
    project_name: 'E2E Project',
    is_foundation: false,
    committees: [],
    occurrences: [],
    recurrence: null,
    created_by: createdBy,
    ...extra,
  };
}

/**
 * Loads the Me-lens meetings page with upcoming fixtures keyed to the signed-in user. The builder
 * receives the viewer's LFID so fixtures can make the viewer the owner (or the creator) at will.
 */
async function gotoMyMeetings(page: Page, buildUpcoming: (viewerLfid: string) => Record<string, unknown>[]): Promise<void> {
  skipWhenAuthMissing();
  await page.context().addCookies([{ name: LENS_COOKIE_KEY, value: 'me', domain: 'localhost', path: '/' }]);
  await stubMeLensContext(page);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);

  const viewerLfid = await readViewerLfid(page);
  if (!viewerLfid) {
    test.skip(true, 'Could not resolve the signed-in LFID from the SSR auth state');
    return;
  }

  await page.route('**/api/user/meetings*', (route) => fulfillJson(route, buildUpcoming(viewerLfid)));
  await page.route('**/api/user/past-meetings*', (route) => fulfillJson(route, []));

  await page.goto(MEETINGS_URL, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  if (!page.url().includes('/meetings')) {
    test.skip(true, 'Me lens is not available for this user — /meetings redirected away');
  }
}

const organizerPill = (page: Page) => page.getByTestId('organizer-filter-pills').getByTestId('filter-pill-organizer');
const card = (page: Page, id: string) => page.locator(`#meeting-${id}`);

test.describe('Meeting cards — owner shown as the organizer (GH-1673)', () => {
  test('chip shows the owner instead of the creator, falling back when the owner is zero-valued', async ({ page }) => {
    await gotoMyMeetings(page, () => [
      upcomingMeeting('owner-set', 'Owner Set', CREATOR, { owner: OWNER }),
      upcomingMeeting('owner-zero', 'Owner Zero', CREATOR, { owner: ZERO_VALUED_OWNER }),
    ]);

    const ownedChip = card(page, 'owner-set').getByTestId('meeting-organizer');
    await expect(ownedChip).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(ownedChip).toContainText(OWNER.name);
    // The owner replaces the created_by slot — the original creator must not linger in the chip.
    await expect(ownedChip).not.toContainText(CREATOR.name);

    const zeroValuedChip = card(page, 'owner-zero').getByTestId('meeting-organizer');
    await expect(zeroValuedChip).toContainText(CREATOR.name);
    await expect(zeroValuedChip).not.toContainText(OWNER.name);
  });

  test('"Organized by me" matches the owner, not the original creator, after a transfer', async ({ page }) => {
    await gotoMyMeetings(page, (viewerLfid) => {
      const viewer = { name: 'E2E Viewer', username: viewerLfid, email: 'viewer-e2e@example.com' };
      return [
        upcomingMeeting('owned-by-viewer', 'Owned By Viewer', CREATOR, { owner: viewer }),
        upcomingMeeting('transferred-away', 'Transferred Away', viewer, { owner: OWNER }),
      ];
    });

    await expect(card(page, 'owned-by-viewer')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(card(page, 'transferred-away')).toBeVisible();

    await organizerPill(page).click();

    // Ownership drives the filter: owned-but-not-created stays, created-but-transferred drops.
    await expect(card(page, 'owned-by-viewer')).toBeVisible();
    await expect(card(page, 'transferred-away')).toHaveCount(0);
  });
});

function buildProjectStub() {
  return {
    uid: PROJECT_UID,
    slug: PROJECT_SLUG,
    name: PROJECT_NAME,
    description: `${PROJECT_NAME} for meeting-owner wizard specs`,
    public: true,
    parent_uid: '',
    stage: 'Active',
    category: 'project',
    funding_model: [],
    charter_url: '',
    legal_entity_type: '',
    legal_entity_name: '',
    legal_parent_uid: '',
    autojoin_enabled: false,
    formation_date: '',
    logo_url: '',
    repository_url: '',
    website_url: '',
    created_at: '',
    updated_at: new Date().toISOString(),
    mailing_list_count: 0,
    writer: true,
  };
}

async function setPersonaAndLensCookies(page: Page, personas: string[], lens: 'foundation' | 'project'): Promise<void> {
  const state: PersistedPersonaState = {
    primary: personas[0] as PersonaType,
    all: personas as PersonaType[],
  };
  await page.context().addCookies([
    { name: PERSONA_COOKIE_KEY, value: encodeURIComponent(JSON.stringify(state)), domain: 'localhost', path: '/', sameSite: 'Lax' },
    { name: LENS_COOKIE_KEY, value: lens, domain: 'localhost', path: '/', sameSite: 'Lax' },
  ]);
}

async function setProjectCookie(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: SELECTED_PROJECT_COOKIE_KEY,
      value: encodeURIComponent(JSON.stringify({ uid: PROJECT_UID, slug: PROJECT_SLUG, name: PROJECT_NAME })),
      domain: 'localhost',
      path: '/',
      sameSite: 'Lax',
    },
  ]);
}

async function stubWizardContext(page: Page): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    fulfillJson(route, { personas: ['executive-director'], personaProjects: {}, projects: [], organizations: [], isRootWriter: true })
  );
  await page.route(`**/api/projects/${PROJECT_SLUG}*`, (route) => fulfillJson(route, buildProjectStub()));
  await page.route('**/api/projects/*/sfid*', (route) => fulfillJson(route, { sfid: null }));
  await page.route('**/api/committees/my-committee-uids*', (route) => fulfillJson(route, []));
  await page.route('**/api/committees*', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname !== '/api/committees') {
      return route.fallback();
    }
    return fulfillJson(route, []);
  });
  // Without this the app loads the test account's REAL projects and applyDefaultSelection can
  // override the seeded context mid-test. Including the seeded project preserves the selection.
  await page.route('**/api/nav/lens-items*', (route) => {
    const url = new URL(route.request().url());
    const isFoundation = url.searchParams.get('lens') !== 'project';
    const items = isFoundation ? [] : [{ uid: PROJECT_UID, slug: PROJECT_SLUG, name: PROJECT_NAME, logoUrl: null, isFoundation: false }];
    return fulfillJson(route, { items, next_page_token: null, upstream_failed: false, lens: isFoundation ? 'foundation' : 'project' });
  });
}

/** Fully-valid meeting detail payload for the edit wizard; `owner` included only when given. */
function buildEditMeeting(owner?: Record<string, string>) {
  return {
    id: MOCK_MEETING_UID,
    title: 'Owner E2E Sync',
    description: 'Meeting stub for meeting-owner wizard specs',
    project_uid: PROJECT_UID,
    project_slug: PROJECT_SLUG,
    project_name: PROJECT_NAME,
    is_foundation: false,
    meeting_type: 'Board',
    visibility: 'public',
    restricted: false,
    start_time: FUTURE_START,
    duration: 60,
    timezone: 'UTC',
    early_join_time_minutes: 10,
    committees: [],
    occurrences: [],
    recording_enabled: false,
    transcript_enabled: false,
    youtube_upload_enabled: false,
    auto_email_reminder_enabled: false,
    show_meeting_attendees: false,
    registrant_count: 0,
    writer: true,
    organizer: true,
    ...(owner ? { owner } : {}),
  };
}

/**
 * Stubs every meeting endpoint the edit wizard touches and captures the PUT payload the wizard
 * sends on "Update Meeting" — the assertion surface for prepareOwnerData()'s include/omit rules.
 */
async function stubMeetingEdit(page: Page, meeting: Record<string, unknown>): Promise<{ put: Record<string, unknown> | null }> {
  const captured: { put: Record<string, unknown> | null } = { put: null };

  // Catch-all registered FIRST (Playwright matches routes in reverse registration order) so
  // incidental list/count calls from the edit page don't escape to the real BFF.
  await page.route('**/api/meetings*', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return fulfillJson(route, { data: [] });
  });
  await page.route(`**/api/meetings/${MOCK_MEETING_UID}/attachments*`, (route) => fulfillJson(route, []));
  await page.route(`**/api/meetings/${MOCK_MEETING_UID}/registrants*`, (route) => fulfillJson(route, []));
  // Exact-path predicate: Playwright glob `*` doesn't cross `/`, and the PUT carries ?editType=,
  // so a pathname match handles both the GET detail load and the update capture.
  await page.route(
    (url) => url.pathname === `/api/meetings/${MOCK_MEETING_UID}`,
    (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        return fulfillJson(route, meeting);
      }
      if (method === 'PUT') {
        captured.put = route.request().postDataJSON() as Record<string, unknown>;
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      return route.fallback();
    }
  );

  return captured;
}

/**
 * Client-side (SPA) navigation to the edit page. A full `page.goto()` SSRs the route on the
 * Express server — server-side fetches bypass `page.route` stubs and hit the real BFF, where the
 * stubbed meeting does not exist, so the component's error path redirects away before the client
 * boots. Booting on `/` first and navigating via pushState + popstate keeps every fetch stubbed.
 */
async function gotoEditPage(page: Page): Promise<void> {
  skipWhenAuthMissing();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  // The '/' boot SSRs with the real backend persona data and can Set-Cookie a real selection,
  // racing the stubbed context — re-assert the intended cookie post-boot.
  await setProjectCookie(page);
  await page.evaluate((url) => {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/project/meetings/${MOCK_MEETING_UID}/edit`);
}

/** Step 1 (Meeting Type) → step 2 (Meeting Details), where the organizer picker lives. */
async function openDetailsStep(page: Page): Promise<void> {
  await expect(page.getByTestId('meeting-manage-title')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  await page.getByTestId('meeting-manage-next-btn').click();
  await expect(page.getByTestId('meeting-details-organizer-search')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
}

/** Steps 2 → 5 via the shared Next control (edit mode), then "Update Meeting" fires the PUT. */
async function saveFromDetailsStep(page: Page): Promise<void> {
  await page.getByTestId('meeting-manage-next-btn').click(); // Platform & Features
  await page.getByTestId('meeting-manage-next-btn').click(); // Resources & Links
  await page.getByTestId('meeting-manage-next-btn').click(); // Invite Guests
  const updateButton = page.getByTestId('meeting-manage-update-btn');
  await expect(updateButton).toBeEnabled({ timeout: ELEMENT_TIMEOUT });
  await updateButton.click();
}

test.describe('Meeting edit wizard — owner picker (GH-1673)', () => {
  test.beforeEach(async ({ page }) => {
    await setPersonaAndLensCookies(page, ['executive-director'], 'project');
    await setProjectCookie(page);
    await stubWizardContext(page);
  });

  test('renders the saved owner directly in the box and an untouched save omits the owner key', async ({ page }) => {
    const captured = await stubMeetingEdit(page, buildEditMeeting({ user_id: 'u-owner-e2e', ...OWNER }));

    await gotoEditPage(page);
    await openDetailsStep(page);

    // The box is the single source of display truth — hydration renders "Name (email)" directly,
    // no separate confirmation line needed.
    await expect(page.getByTestId('meeting-details-organizer-search').locator('input')).toHaveValue(`${OWNER.name} (${OWNER.email})`);
    // Untouched picker → no saved/current mismatch → the revert row stays hidden.
    await expect(page.getByTestId('meeting-details-organizer-saved')).toHaveCount(0);

    await saveFromDetailsStep(page);

    await expect.poll(() => captured.put, { timeout: ELEMENT_TIMEOUT }).not.toBeNull();
    // Untouched picker → key omitted → upstream preserves the stored owner (incl. its avatar).
    expect(Object.keys(captured.put as Record<string, unknown>)).not.toContain('owner');
  });

  test('reverting a fresh pick restores the saved owner in the box and the save omits the owner key', async ({ page }) => {
    const captured = await stubMeetingEdit(page, buildEditMeeting({ user_id: 'u-owner-e2e', ...OWNER }));
    await page.route('**/api/search/users*', (route) => fulfillJson(route, { results: [DIFFERENT_PICKED_USER] }));

    await gotoEditPage(page);
    await openDetailsStep(page);

    const input = page.getByTestId('meeting-details-organizer-search').locator('input');
    await expect(input).toHaveValue(`${OWNER.name} (${OWNER.email})`);

    // Pick a different organizer — the box re-renders with the fresh pick, and the saved-owner row
    // appears since the picker now disagrees with the saved baseline.
    const pickedName = `${DIFFERENT_PICKED_USER.first_name} ${DIFFERENT_PICKED_USER.last_name}`;
    await input.fill('Radia');
    await page.getByRole('option').filter({ hasText: pickedName }).click();
    await expect(input).toHaveValue(`${pickedName} (${DIFFERENT_PICKED_USER.email})`);
    await expect(page.getByTestId('meeting-details-organizer-saved')).toContainText(`Saved organizer: ${OWNER.name} (${OWNER.email})`);

    // Revert restores the saved owner and hides the row again.
    await page.getByTestId('meeting-details-organizer-revert').click();
    await expect(input).toHaveValue(`${OWNER.name} (${OWNER.email})`);
    await expect(page.getByTestId('meeting-details-organizer-saved')).toHaveCount(0);

    await saveFromDetailsStep(page);

    await expect.poll(() => captured.put, { timeout: ELEMENT_TIMEOUT }).not.toBeNull();
    // Reverted controls match the hydrated baseline → key omitted → upstream keeps the stored
    // owner (there is no owner-removal path upstream, hence revert rather than empty).
    expect(Object.keys(captured.put as Record<string, unknown>)).not.toContain('owner');
  });

  test('picking an organizer sends owner {username, name, email} on update', async ({ page }) => {
    const captured = await stubMeetingEdit(page, buildEditMeeting());
    await page.route('**/api/search/users*', (route) => fulfillJson(route, { results: [PICKED_USER] }));

    await gotoEditPage(page);
    await openDetailsStep(page);

    // No saved owner → box starts empty.
    await expect(page.getByTestId('meeting-details-organizer-search').locator('input')).toHaveValue('');

    await page.getByTestId('meeting-details-organizer-search').locator('input').fill('Grace');
    await page.getByRole('option').filter({ hasText: OWNER.name }).click();
    await expect(page.getByTestId('meeting-details-organizer-search').locator('input')).toHaveValue(`${OWNER.name} (${OWNER.email})`);
    // No saved owner to compare against, so no revert row even though a pick was made.
    await expect(page.getByTestId('meeting-details-organizer-saved')).toHaveCount(0);

    await saveFromDetailsStep(page);

    await expect.poll(() => captured.put, { timeout: ELEMENT_TIMEOUT }).not.toBeNull();
    expect((captured.put as Record<string, unknown>)['owner']).toEqual({ username: OWNER.username, name: OWNER.name, email: OWNER.email });
  });

  test('clearing with no saved owner empties the box and the save omits the owner key', async ({ page }) => {
    const captured = await stubMeetingEdit(page, buildEditMeeting());
    await page.route('**/api/search/users*', (route) => fulfillJson(route, { results: [PICKED_USER] }));

    await gotoEditPage(page);
    await openDetailsStep(page);

    const input = page.getByTestId('meeting-details-organizer-search').locator('input');
    await input.fill('Grace');
    await page.getByRole('option').filter({ hasText: OWNER.name }).click();
    await expect(input).toHaveValue(`${OWNER.name} (${OWNER.email})`);

    // In-field clear on a create-style (no saved-owner) edit empties the box outright — there's
    // nothing to revert to.
    await page.getByTestId('meeting-details-organizer-search').locator('.p-autocomplete-clear-icon').click();
    await expect(input).toHaveValue('');

    await saveFromDetailsStep(page);

    await expect.poll(() => captured.put, { timeout: ELEMENT_TIMEOUT }).not.toBeNull();
    expect(Object.keys(captured.put as Record<string, unknown>)).not.toContain('owner');
  });

  test('manual entry sends owner {name, email} without a username on update', async ({ page }) => {
    const MANUAL_OWNER = { name: 'Radia Perlman', email: 'radia-e2e@example.com' };
    const captured = await stubMeetingEdit(page, buildEditMeeting());
    // The wanted person is not among the committee members returned — the results list shows
    // someone else, and the overlay's "Enter details manually" footer is the way out.
    await page.route('**/api/search/users*', (route) => fulfillJson(route, { results: [PICKED_USER] }));

    await gotoEditPage(page);
    await openDetailsStep(page);

    await page.getByTestId('meeting-details-organizer-search').locator('input').fill('Radia');
    await page.getByRole('button', { name: 'Enter details manually' }).click();

    // Manual mode swaps the search out for name/email inputs.
    await expect(page.getByTestId('meeting-details-organizer-manual')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('meeting-details-organizer-search')).toHaveCount(0);

    const nameInput = page.getByTestId('meeting-details-organizer-name-input').locator('input');
    const emailInput = page.getByTestId('meeting-details-organizer-email-input').locator('input');
    await nameInput.fill(MANUAL_OWNER.name);

    // An invalid email must gate the step (Validators.email feeds isStepValid). The disabled
    // state lives on the wrapper's inner native button, not the lfx-button host the testid is on.
    const nextButton = page.getByTestId('meeting-manage-next-btn').locator('button');
    await emailInput.fill('not-an-email');
    await expect(nextButton).toBeDisabled();
    await emailInput.fill(MANUAL_OWNER.email);
    await expect(nextButton).toBeEnabled();

    await saveFromDetailsStep(page);

    await expect.poll(() => captured.put, { timeout: ELEMENT_TIMEOUT }).not.toBeNull();
    // No username: a hand-typed identity is name+email only.
    expect((captured.put as Record<string, unknown>)['owner']).toEqual({ name: MANUAL_OWNER.name, email: MANUAL_OWNER.email });
  });
});
