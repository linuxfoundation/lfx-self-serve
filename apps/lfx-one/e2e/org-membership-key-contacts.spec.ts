// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Org Membership Key Contacts spec-024 E2E coverage with deterministic BFF route stubs.

import { expect, Page, test } from '@playwright/test';

function foundationId(): string {
  return 'a0941000002wBz4AAE';
}

function foundationSlug(): string {
  return 'cncf';
}

function detailUrl(): string {
  return `/org/memberships/${foundationSlug()}`;
}

function loadTimeout(): number {
  return 30_000;
}

function catalogOrder(): string[] {
  return ['representative', 'billing', 'technical', 'po', 'marketing', 'pr', 'legal', 'event-sponsorship', 'authorized-signatory'];
}

function emptyRow(contactType: string, label: string, min: number, max: number) {
  return { contactType, contactTypeLabel: label, minContacts: min, maxContacts: max, people: [] as unknown[] };
}

function nineRows() {
  return [
    {
      contactType: 'representative',
      contactTypeLabel: 'Representative/Voting Contact',
      minContacts: 1,
      maxContacts: 1,
      people: [{ personId: 'kc-rep-1', firstName: 'Ada', lastName: 'Rep', fullName: 'Ada Rep', email: 'ada.rep@example.com', jobTitle: null, initials: 'AR' }],
    },
    {
      contactType: 'billing',
      contactTypeLabel: 'Billing Contact',
      minContacts: 1,
      maxContacts: 3,
      people: [
        { personId: 'kc-bill-1', firstName: 'Bea', lastName: 'Bill', fullName: 'Bea Bill', email: 'bea.bill@example.com', jobTitle: null, initials: 'BB' },
      ],
    },
    emptyRow('technical', 'Technical Contact', 1, 10),
    emptyRow('po', 'PO Contact', 0, 3),
    emptyRow('marketing', 'Marketing Contact', 1, 10),
    emptyRow('pr', 'PR Contact', 0, 3),
    emptyRow('legal', 'Legal Contact', 0, 3),
    emptyRow('event-sponsorship', 'Event Sponsorship Contact', 0, 3),
    emptyRow('authorized-signatory', 'Authorized Signatory', 1, 1),
  ];
}

function foundationHeader() {
  return {
    foundationId: foundationId(),
    foundationName: 'Cloud Native Computing Foundation (CNCF)',
    foundationLogo: null,
    membershipTier: 'Platinum Membership',
    tierStartDate: '2026-01-01',
    tierEndDate: '2026-12-31',
    memberSince: '2018-01-01',
    status: 'active',
  };
}

// Mocks membership-detail GET (single segment after /memberships/).
async function mockDetail(page: Page, body: unknown) {
  await page.route(/\/api\/orgs\/[^/]+\/lens\/memberships\/[^/]+$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function mockEmployees(page: Page, employees: unknown[], status = 200) {
  await page.route(/\/api\/orgs\/[^/]+\/lens\/key-contacts\/employees$/, async (route) => {
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ orgUid: 'x', employees }) });
  });
}

test.describe('Membership Key Contacts — read (US1)', () => {
  test('renders all 9 catalog rows in order, with empty-role labels', async ({ page }) => {
    await mockDetail(page, { foundation: foundationHeader(), keyContacts: nineRows() });
    await page.goto(detailUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('membership-detail-key-contacts-card')).toBeVisible({ timeout: loadTimeout() });

    for (const contactType of catalogOrder()) {
      await expect(page.getByTestId(`membership-detail-key-contacts-row-${contactType}`)).toBeVisible();
    }
    // Populated role shows the person; empty role shows the inline empty label.
    await expect(page.getByTestId('membership-detail-key-contacts-person-kc-rep-1')).toBeVisible();
    await expect(page.getByTestId('membership-detail-key-contacts-empty-technical')).toBeVisible();
  });

  test('no active membership → not-found state', async ({ page }) => {
    await mockDetail(page, { foundation: null, keyContacts: [] });
    await page.goto(detailUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('membership-detail-not-found')).toBeVisible({ timeout: loadTimeout() });
  });
});

test.describe('Membership Key Contacts — employee search (US3)', () => {
  test('typing surfaces deduped suggestions and selecting populates the form', async ({ page }) => {
    await mockDetail(page, { foundation: foundationHeader(), keyContacts: nineRows() });
    await mockEmployees(page, [{ email: 'cara.dev@example.com', firstName: 'Cara', lastName: 'Dev', fullName: 'Cara Dev', jobTitle: null, initials: 'CD' }]);
    await page.goto(detailUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('membership-detail-key-contacts-card')).toBeVisible({ timeout: loadTimeout() });

    // Technical is empty + multi-slot → chooser → add form
    await page.getByTestId('membership-detail-key-contacts-edit-technical').click();
    await expect(page.getByTestId('edit-key-contact-modal')).toBeVisible();
    await page.getByTestId('edit-key-contact-email-input').fill('cara');
    await expect(page.getByTestId('edit-key-contact-employee-suggestions')).toBeVisible();
    await page.getByTestId('edit-key-contact-employee-option-cara.dev@example.com').click();
    await expect(page.getByTestId('edit-key-contact-first-name-input')).toHaveValue('Cara');
    await expect(page.getByTestId('edit-key-contact-last-name-input')).toHaveValue('Dev');
  });

  test('employee search failure still allows manual entry (FR-026)', async ({ page }) => {
    await mockDetail(page, { foundation: foundationHeader(), keyContacts: nineRows() });
    await mockEmployees(page, [], 502);
    await page.goto(detailUrl(), { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('membership-detail-key-contacts-card')).toBeVisible({ timeout: loadTimeout() });

    await page.getByTestId('membership-detail-key-contacts-edit-technical').click();
    await expect(page.getByTestId('edit-key-contact-search-unavailable')).toBeVisible();
    await expect(page.getByTestId('edit-key-contact-email-input')).toBeEditable();
  });
});

test.describe('Membership Key Contacts — pessimistic writes (US2)', () => {
  test('add reflects only after the backend confirms, then shows success toast', async ({ page }) => {
    await mockDetail(page, { foundation: foundationHeader(), keyContacts: nineRows() });
    await mockEmployees(page, []);
    await page.route(/\/api\/orgs\/[^/]+\/lens\/memberships\/[^/]+\/key-contacts$/, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const contact = {
        contactType: 'technical',
        contactTypeLabel: 'Technical Contact',
        minContacts: 1,
        maxContacts: 10,
        people: [
          { personId: 'kc-tech-new', firstName: 'Tom', lastName: 'Tech', fullName: 'Tom Tech', email: 'tom.tech@example.com', jobTitle: null, initials: 'TT' },
        ],
      };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ contact }) });
    });

    await page.goto(detailUrl(), { waitUntil: 'domcontentloaded' });
    await page.getByTestId('membership-detail-key-contacts-edit-technical').click();
    await page.getByTestId('edit-key-contact-email-input').fill('tom.tech@example.com');
    await page.getByTestId('edit-key-contact-first-name-input').fill('Tom');
    await page.getByTestId('edit-key-contact-last-name-input').fill('Tech');
    await page.getByTestId('edit-key-contact-primary-button').click();

    await expect(page.getByTestId('key-contact-toast-success-added')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('membership-detail-key-contacts-person-kc-tech-new')).toBeVisible();
    // Modal closes only after the backend confirms and the row is reconciled.
    await expect(page.getByTestId('edit-key-contact-modal')).toBeHidden();
  });

  test('capacity conflict keeps the modal open with an inline error and no false save', async ({ page }) => {
    await mockDetail(page, { foundation: foundationHeader(), keyContacts: nineRows() });
    await mockEmployees(page, []);
    await page.route(/\/api\/orgs\/[^/]+\/lens\/memberships\/[^/]+\/key-contacts$/, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'CONFLICT', message: 'Capacity limit reached for this role.', conflict: false } }),
      });
    });

    await page.goto(detailUrl(), { waitUntil: 'domcontentloaded' });
    await page.getByTestId('membership-detail-key-contacts-edit-technical').click();
    await page.getByTestId('edit-key-contact-email-input').fill('over.cap@example.com');
    await page.getByTestId('edit-key-contact-first-name-input').fill('Over');
    await page.getByTestId('edit-key-contact-last-name-input').fill('Cap');
    await page.getByTestId('edit-key-contact-primary-button').click();

    // Modal stays open with the inline error so the user can retry without reopening.
    const saveError = page.getByTestId('edit-key-contact-save-error');
    await expect(saveError).toBeVisible({ timeout: 10_000 });
    await expect(saveError).toContainText('Capacity limit reached for this role.');
    await expect(page.getByTestId('edit-key-contact-modal')).toBeVisible();
    await expect(page.getByTestId('membership-detail-key-contacts-empty-technical')).toBeVisible();
  });

  test('5xx server error keeps the modal open with a retryable fallback error', async ({ page }) => {
    await mockDetail(page, { foundation: foundationHeader(), keyContacts: nineRows() });
    await mockEmployees(page, []);
    // The BFF collapses upstream 5xx to a 502 + generic fallback (no raw noise leaks).
    await page.route(/\/api\/orgs\/[^/]+\/lens\/memberships\/[^/]+\/key-contacts$/, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'KEY_CONTACT_WRITE_FAILED', message: "Couldn't save right now. Please try again.", conflict: false } }),
      });
    });

    await page.goto(detailUrl(), { waitUntil: 'domcontentloaded' });
    await page.getByTestId('membership-detail-key-contacts-edit-technical').click();
    await page.getByTestId('edit-key-contact-email-input').fill('boom.5xx@example.com');
    await page.getByTestId('edit-key-contact-first-name-input').fill('Boom');
    await page.getByTestId('edit-key-contact-last-name-input').fill('Server');
    await page.getByTestId('edit-key-contact-primary-button').click();

    // Modal stays open with the generic fallback so the user can retry without reopening.
    const saveError = page.getByTestId('edit-key-contact-save-error');
    await expect(saveError).toBeVisible({ timeout: 10_000 });
    await expect(saveError).toContainText("Couldn't save right now. Please try again.");
    await expect(page.getByTestId('edit-key-contact-modal')).toBeVisible();
    await expect(page.getByTestId('membership-detail-key-contacts-empty-technical')).toBeVisible();
  });
});
