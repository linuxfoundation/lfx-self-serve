// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Reassign Key Contact Roles modal E2E (LFXV2-2067 main-row pencil). */

import { expect, Page, Route, test } from '@playwright/test';

const PEOPLE_KEY_CONTACTS_URL = '/org/people?tab=contacts';
const DATA_LOAD_TIMEOUT = 30_000;
const TOAST_TIMEOUT = 10_000;

const MOCK_UID = '4c46585f-878c-8285-b2e9-2dbfc38ddd9b';
const MOCK_ACCOUNT_ID = '0014100000Te2QjAAJ';
const MOCK_ACCOUNT_NAME = 'Acme Industries';
const MOCK_ACCOUNT_SLUG = 'acme-industries';

// Three roles across two foundations — gives concrete numbers for the subtitle and Save Changes label.
const MOCK_PERSON_EMAIL = 'ada.tester@example.com';
const MOCK_REPLACEMENT_EMAIL = 'cara.dev@example.com';

// Stable role keys: `${membershipUid}:${contactType}` (mirrors `buildReassignRoleOptions` in the component).
const ROLE_KEY_MARKETING_CNCF = 'msp-cncf:marketing';
const ROLE_KEY_TECHNICAL_CNCF = 'msp-cncf:technical';
const ROLE_KEY_LEGAL_EBPF = 'msp-ebpf:legal';

const MOCK_KEY_CONTACTS_RESPONSE = {
  assignments: [
    {
      contactUid: 'kc-marketing-cncf',
      membershipUid: 'msp-cncf',
      email: MOCK_PERSON_EMAIL,
      firstName: 'Ada',
      lastName: 'Tester',
      displayName: 'Ada Tester',
      title: 'Director, Open Source',
      role: 'Marketing Contact',
      foundationSlug: 'cncf',
      foundationName: 'Cloud Native Computing Foundation',
    },
    {
      contactUid: 'kc-technical-cncf',
      membershipUid: 'msp-cncf',
      email: MOCK_PERSON_EMAIL,
      firstName: 'Ada',
      lastName: 'Tester',
      displayName: 'Ada Tester',
      title: 'Director, Open Source',
      role: 'Technical Contact',
      foundationSlug: 'cncf',
      foundationName: 'Cloud Native Computing Foundation',
    },
    {
      contactUid: 'kc-legal-ebpf',
      membershipUid: 'msp-ebpf',
      email: MOCK_PERSON_EMAIL,
      firstName: 'Ada',
      lastName: 'Tester',
      displayName: 'Ada Tester',
      title: 'Director, Open Source',
      role: 'Legal Contact',
      foundationSlug: 'ebpf',
      foundationName: 'eBPF Foundation',
    },
  ],
  stats: {
    individualCount: 1,
    foundationsCovered: 2,
    unfilledRequiredRoleCount: 0,
  },
};

const MOCK_EMPLOYEES = [
  {
    email: MOCK_REPLACEMENT_EMAIL,
    firstName: 'Cara',
    lastName: 'Dev',
    fullName: 'Cara Dev',
    jobTitle: 'Senior Engineer',
    initials: 'CD',
  },
  {
    email: 'evan.qa@example.com',
    firstName: 'Evan',
    lastName: 'QA',
    fullName: 'Evan QA',
    jobTitle: 'QA Lead',
    initials: 'EQ',
  },
];

test.setTimeout(120_000);

/** Skip the test when Auth0 redirected (no TEST_USERNAME/TEST_PASSWORD configured). */
function skipWhenAuthMissing(page: Page): void {
  try {
    const { hostname } = new URL(page.url());
    if (hostname === 'auth0.com' || hostname.endsWith('.auth0.com')) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  } catch {
    // Malformed URL — let the test run and surface a useful failure.
  }
}

/** Stubs persona + role-grants so `selectedAccount().uid` resolves and `canEdit()` returns true. */
async function stubAccountContext(page: Page, opts: { writers: string[] } = { writers: [MOCK_UID] }): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        personas: ['contributor'],
        personaProjects: {},
        projects: [],
        organizations: [
          {
            accountId: MOCK_ACCOUNT_ID,
            accountName: MOCK_ACCOUNT_NAME,
            accountSlug: MOCK_ACCOUNT_SLUG,
            membershipTier: '',
            uid: MOCK_UID,
          },
        ],
        isRootWriter: false,
      }),
    })
  );

  await page.route('**/api/orgs/me/role-grants', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        writers: opts.writers,
        auditors: [],
        cascadingWriters: [],
        cascadingAuditors: [],
        username: 'e2e-org-people-reassign',
        loaded_at: new Date().toISOString(),
      }),
    })
  );
}

async function stubKeyContactsList(page: Page, body: unknown = MOCK_KEY_CONTACTS_RESPONSE): Promise<void> {
  await page.route(/\/api\/orgs\/[^/]+\/lens\/people\/key-contacts$/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function stubEmployees(page: Page, employees: unknown[] = MOCK_EMPLOYEES, status = 200): Promise<void> {
  await page.route(/\/api\/orgs\/[^/]+\/lens\/key-contacts\/employees$/, (route) => {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ orgUid: MOCK_UID, employees }) });
  });
}

/** Stubs the slug-keyed PUT proxy; the handler decides what to return per request. */
async function stubReassignPut(page: Page, handler: (route: Route) => Promise<void> | void): Promise<void> {
  await page.route(/\/api\/orgs\/[^/]+\/lens\/key-contacts\/membership\/[^/]+\/[^/]+$/, async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    await handler(route);
  });
}

async function gotoKeyContactsTab(page: Page): Promise<void> {
  // Install stubs first; reload so the persona/role-grants fetches go through the mocks (mirrors org-profile S1).
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.reload({ waitUntil: 'domcontentloaded' });

  await page.goto(PEOPLE_KEY_CONTACTS_URL, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);

  if (!page.url().includes('/org/people')) {
    test.skip(true, 'org-lens-enabled flag appears off — /org/people redirected away');
  }

  // Wait for the contacts panel to mount before any assertion.
  await expect(page.getByTestId('org-people-panel-contacts')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
}

test.describe('Org People → Key Contacts — Reassign Key Contact Roles modal (LFXV2-2067)', () => {
  test('opens with the expected anatomy and reflects the fixture counts', async ({ page }) => {
    await stubAccountContext(page);
    await stubKeyContactsList(page);
    await stubEmployees(page);

    await gotoKeyContactsTab(page);

    // (1, 2) Tab loaded; the row for Ada Tester is visible because the fixture seeded it.
    const mainRow = page.getByTestId(`org-people-key-contacts-row-${MOCK_PERSON_EMAIL}`);
    await expect(mainRow).toBeVisible();

    // (3) Pencil renders on the main row (canEdit() true via writers stub).
    const pencil = page.getByTestId(`org-people-key-contacts-reassign-${MOCK_PERSON_EMAIL}`);
    await expect(pencil).toBeVisible();

    // (4, 5) Click the pencil → modal mounts.
    await pencil.click();
    const modal = page.getByTestId('reassign-key-contact-modal');
    await expect(modal).toBeVisible();

    // (6) Exactly one modal title with the canonical copy.
    const title = page.getByTestId('reassign-key-contact-title');
    await expect(title).toHaveCount(1);
    await expect(title).toHaveText('Reassign Key Contact Roles');

    // (7) Subtitle reflects the fixture: 3 roles across 2 foundations.
    await expect(page.getByTestId('reassign-key-contact-subtitle')).toHaveText('3 roles across 2 foundations');

    // (8, 9) Current contact card with the prescribed subheading + avatar/name/email.
    const currentCard = page.getByTestId('reassign-key-contact-current');
    await expect(currentCard).toBeVisible();
    // Heading copy is the exact prototype string; text-transform: uppercase is CSS so we assert the source-cased string.
    await expect(currentCard).toContainText('Current Contact');
    await expect(currentCard).toContainText('Will Be Removed From Selected Roles');
    await expect(page.getByTestId('reassign-key-contact-current-avatar')).toHaveText('AT'); // Ada Tester
    await expect(page.getByTestId('reassign-key-contact-current-name')).toHaveText('Ada Tester');
    await expect(page.getByTestId('reassign-key-contact-current-email')).toHaveText(MOCK_PERSON_EMAIL);

    // (10) "Select all" checkbox preselected — assert against the underlying <input> PrimeNG renders.
    const selectAll = page.getByTestId('reassign-key-contact-select-all');
    await expect(selectAll).toBeVisible();
    await expect(selectAll.locator('input[type=checkbox]')).toBeChecked();

    // (11) The role list contains exactly the 3 fixture rows, all preselected.
    const list = page.getByTestId('reassign-key-contact-roles-list');
    await expect(list).toBeVisible();
    for (const key of [ROLE_KEY_MARKETING_CNCF, ROLE_KEY_TECHNICAL_CNCF, ROLE_KEY_LEGAL_EBPF]) {
      await expect(page.getByTestId(`reassign-key-contact-role-row-${key}`)).toBeVisible();
      await expect(page.getByTestId(`reassign-key-contact-role-checkbox-${key}`).locator('input[type=checkbox]')).toBeChecked();
    }
    // Foundation labels render alongside the role pills (one per row).
    await expect(list).toContainText('Marketing Contact');
    await expect(list).toContainText('Technical Contact');
    await expect(list).toContainText('Legal Contact');
    await expect(list).toContainText('Cloud Native Computing Foundation');
    await expect(list).toContainText('eBPF Foundation');

    // (12) Info banner appears below the list with the canonical copy.
    const banner = page.getByTestId('reassign-key-contact-info-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveText("The person you assign below will replace the current contact in every role you've checked above.");

    // (13, 14) Assign-to section with three required form fields below the banner.
    const assignForm = page.getByTestId('reassign-key-contact-assign-form');
    await expect(assignForm).toBeVisible();
    await expect(page.getByTestId('reassign-key-contact-email-input')).toBeVisible();
    await expect(page.getByTestId('reassign-key-contact-first-name-input')).toBeVisible();
    await expect(page.getByTestId('reassign-key-contact-last-name-input')).toBeVisible();

    // (17) Action buttons at the bottom; primary label echoes the checked count (default = all 3).
    await expect(page.getByTestId('reassign-key-contact-cancel')).toBeVisible();
    await expect(page.getByTestId('reassign-key-contact-primary-button')).toHaveText(/Save Changes \(3 roles\)/);
  });

  test('save button label and subtitle update live as roles are toggled', async ({ page }) => {
    await stubAccountContext(page);
    await stubKeyContactsList(page);
    await stubEmployees(page);

    await gotoKeyContactsTab(page);
    await page.getByTestId(`org-people-key-contacts-reassign-${MOCK_PERSON_EMAIL}`).click();
    await expect(page.getByTestId('reassign-key-contact-modal')).toBeVisible();

    const subtitle = page.getByTestId('reassign-key-contact-subtitle');
    const primary = page.getByTestId('reassign-key-contact-primary-button');

    // Drop the Legal/eBPF row → 2 roles, 1 foundation; pluralization stays plural.
    await page.getByTestId(`reassign-key-contact-role-checkbox-${ROLE_KEY_LEGAL_EBPF}`).click();
    await expect(subtitle).toHaveText('2 roles across 1 foundation');
    await expect(primary).toHaveText(/Save Changes \(2 roles\)/);

    // Drop one more (Technical/CNCF) → 1 role, 1 foundation; both go singular.
    await page.getByTestId(`reassign-key-contact-role-checkbox-${ROLE_KEY_TECHNICAL_CNCF}`).click();
    await expect(subtitle).toHaveText('1 role across 1 foundation');
    await expect(primary).toHaveText(/Save Changes \(1 role\)/);

    // Drop the last one → none checked; primary disabled and label echoes 0.
    await page.getByTestId(`reassign-key-contact-role-checkbox-${ROLE_KEY_MARKETING_CNCF}`).click();
    await expect(subtitle).toHaveText('0 roles across 0 foundations');
    await expect(primary).toBeDisabled();
  });

  test('employee typeahead suggests matches and selecting one prefills first/last name', async ({ page }) => {
    await stubAccountContext(page);
    await stubKeyContactsList(page);
    await stubEmployees(page);

    await gotoKeyContactsTab(page);
    await page.getByTestId(`org-people-key-contacts-reassign-${MOCK_PERSON_EMAIL}`).click();
    await expect(page.getByTestId('reassign-key-contact-modal')).toBeVisible();

    // (15) Type into the email field → suggestions list opens and shows the match.
    await page.getByTestId('reassign-key-contact-email-input').fill('cara');
    const suggestions = page.getByTestId('reassign-key-contact-employee-suggestions');
    await expect(suggestions).toBeVisible();
    const option = page.getByTestId(`reassign-key-contact-employee-option-${MOCK_REPLACEMENT_EMAIL}`);
    await expect(option).toBeVisible();

    // (16) Click the suggestion → email/first/last fields prefill from the chosen employee.
    await option.click();
    await expect(page.getByTestId('reassign-key-contact-email-input')).toHaveValue(MOCK_REPLACEMENT_EMAIL);
    await expect(page.getByTestId('reassign-key-contact-first-name-input')).toHaveValue('Cara');
    await expect(page.getByTestId('reassign-key-contact-last-name-input')).toHaveValue('Dev');
    // Suggestion list closes after a selection.
    await expect(suggestions).toBeHidden();
  });

  test('save fans out PUTs, shows the spinner, then closes the modal and toasts on full success', async ({ page }) => {
    await stubAccountContext(page);
    await stubKeyContactsList(page);
    await stubEmployees(page);

    // Track the fan-out so we can assert one PUT per checked role (3 here, since "Select all" stays on).
    const putCalls: string[] = [];
    await stubReassignPut(page, async (route) => {
      putCalls.push(route.request().url());
      // Small delay so the spinner has time to render before the resolution closes the modal.
      await new Promise((r) => setTimeout(r, 200));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          contact: {
            contactType: 'marketing',
            contactTypeLabel: 'Marketing Contact',
            minContacts: 0,
            maxContacts: 10,
            people: [
              {
                personId: 'kc-replacement-id',
                firstName: 'Cara',
                lastName: 'Dev',
                fullName: 'Cara Dev',
                email: MOCK_REPLACEMENT_EMAIL,
                jobTitle: null,
                initials: 'CD',
              },
            ],
          },
        }),
      });
    });

    await gotoKeyContactsTab(page);
    await page.getByTestId(`org-people-key-contacts-reassign-${MOCK_PERSON_EMAIL}`).click();
    await expect(page.getByTestId('reassign-key-contact-modal')).toBeVisible();

    // Pick the replacement person via typeahead (also exercises the prefill path, but minimally).
    await page.getByTestId('reassign-key-contact-email-input').fill('cara');
    await page.getByTestId(`reassign-key-contact-employee-option-${MOCK_REPLACEMENT_EMAIL}`).click();

    // (18 — loading) Click Save → spinner becomes visible while the fan-out is in flight.
    await page.getByTestId('reassign-key-contact-primary-button').click();
    await expect(page.getByTestId('reassign-key-contact-primary-spinner')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('reassign-key-contact-primary-button')).toBeDisabled();

    // (18 — success) Modal closes once every PUT resolves.
    await expect(page.getByTestId('reassign-key-contact-modal')).toBeHidden({ timeout: TOAST_TIMEOUT });

    // Success toast container becomes visible (PrimeNG MessageService dispatches by `key`).
    await expect(page.getByTestId('org-people-key-contacts-toast-success')).toBeVisible({ timeout: TOAST_TIMEOUT });

    // One PUT per checked role. Default is all 3 selected; the modal does not reuse calls.
    expect(putCalls).toHaveLength(3);
    // Each foundation slug in the URL is one of the fixture's slugs (defensive parsing — we don't pin order).
    const slugSet = new Set(putCalls.map((u) => u.match(/\/membership\/([^/]+)\//)?.[1]));
    expect(slugSet).toEqual(new Set(['cncf', 'ebpf']));
  });

  test('save failure keeps the modal open with a retryable inline error and no false success toast', async ({ page }) => {
    await stubAccountContext(page);
    await stubKeyContactsList(page);
    await stubEmployees(page);

    // Every PUT fails — collapses to the modal's "Could not save changes" path because the BFF
    // surfaces nothing else and Promise.allSettled treats every leg as rejected.
    await stubReassignPut(page, (route) =>
      route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'KEY_CONTACT_WRITE_FAILED', message: "Couldn't save right now. Please try again.", conflict: false } }),
      })
    );

    await gotoKeyContactsTab(page);
    await page.getByTestId(`org-people-key-contacts-reassign-${MOCK_PERSON_EMAIL}`).click();
    await expect(page.getByTestId('reassign-key-contact-modal')).toBeVisible();

    await page.getByTestId('reassign-key-contact-email-input').fill('cara');
    await page.getByTestId(`reassign-key-contact-employee-option-${MOCK_REPLACEMENT_EMAIL}`).click();

    await page.getByTestId('reassign-key-contact-primary-button').click();

    // (18 — error) Inline save error surfaces; modal stays open so the user can retry without reopening.
    const saveError = page.getByTestId('reassign-key-contact-save-error');
    await expect(saveError).toBeVisible({ timeout: TOAST_TIMEOUT });
    await expect(saveError).toContainText("Couldn't save right now. Please try again.");
    await expect(page.getByTestId('reassign-key-contact-modal')).toBeVisible();

    // Spinner clears once the parent rejects so the user can re-click Save.
    await expect(page.getByTestId('reassign-key-contact-primary-spinner')).toBeHidden();
    await expect(page.getByTestId('reassign-key-contact-primary-button')).toBeEnabled();

    // No success toast on failure (negative assertion guards against accidental dispatches in the parent).
    await expect(page.getByTestId('org-people-key-contacts-toast-success')).toBeHidden();
  });
});
