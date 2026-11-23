// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Propose a project (#3037) — Me-lens intake, the submitter's "Submitted proposals" tab, and the
 * formation team's "Project proposals" queue on The Linux Foundation's Formations page. Deterministic via
 * stateful route mocks (`project-application.helper.ts`); see project-proposals-robust.spec.ts for the
 * structural contract.
 */

import { expect, Page, test } from '@playwright/test';

import {
  DATA_LOAD_TIMEOUT,
  gotoMyFormations,
  setPersonaCookie,
  skipWhenAuthMissing,
  stubFormationFlag,
  stubPersona,
} from './helpers/formation-checklist.helper';
import { waitForHydration } from './helpers/meeting-composer-guests.helper';
import { buildProposal, mockProjectApplicationApis, PARENT_PROJECT_UID, PROPOSAL_UID } from './helpers/project-application.helper';

test.setTimeout(120_000);

async function confirmDialog(page: Page, label: string): Promise<void> {
  await page.locator('.p-confirmdialog').getByRole('button', { name: label }).click();
}

test.describe('Propose a project — submitter (#3037)', () => {
  test('submits the intake form and lands on Submitted proposals with the new row', async ({ page }) => {
    const state = await mockProjectApplicationApis(page, []);
    await gotoMyFormations(page);

    await page.getByTestId('my-formations-propose-project').click();
    await expect(page).toHaveURL(/\/formations\/propose$/, { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('propose-project-title')).toHaveText('Propose a project');
    // SSR hydration re-navigates to the same url and rebuilds the form; interact only once it settles.
    await waitForHydration(page);

    // Required answers are enforced before anything is sent.
    await page.getByTestId('project-application-form-submit').click();
    await expect(page.getByTestId('project-application-form-project-name-error')).toBeVisible();
    expect(state.requests.filter((request) => request.method === 'POST')).toHaveLength(0);

    await page.locator('#pa-project-name').fill('Harbor Signals');
    await page.locator('#pa-repository').fill('https://github.com/harbor-signals/core');
    await page.locator('#pa-website').fill('https://harbor-signals.example');
    await page.getByTestId('project-application-form-trademark').getByText('Not sure').click();
    await page.locator('#pa-organization').fill('Harbor Labs');
    await page.locator('#pa-legal').fill('legal@harbor-labs.example');
    await page.locator('#pa-formation-list').fill('ops@harbor-labs.example, dev@harbor-labs.example');
    await page.locator('[data-test="project-application-form-license"]').click();
    await page.getByRole('option', { name: 'MIT', exact: true }).click();
    await page.getByTestId('project-application-form-chat').getByText('Discord').click();
    await page.locator('#pa-mission').fill('The Mission of the Project is to share signals.');
    await page.getByTestId('project-application-form-agreement').getByText('DCO only').click();
    await page.getByTestId('project-application-form-spec').getByText('Yes').click();
    await page.locator('#pa-description').fill('A shared signals exchange.');
    await expect(page.getByTestId('project-application-form-description-count')).toContainText('26 / 1000');

    await page.getByTestId('project-application-form-submit').click();

    await expect(page).toHaveURL(/\/formations\?tab=proposals$/, { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId(`project-applications-open-${PROPOSAL_UID}`)).toHaveText('Harbor Signals', { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId(`project-applications-state-${PROPOSAL_UID}`)).toContainText('Submitted');

    const create = state.requests.find((request) => request.method === 'POST');
    // Only the answers leave the browser — the BFF adds the submitter identity from the session.
    expect(create?.body).toEqual({
      application: {
        project_name: 'Harbor Signals',
        project_repository_url: 'https://github.com/harbor-signals/core',
        project_website: 'https://harbor-signals.example',
        trademark_status: 'Not sure',
        contributing_organization: 'Harbor Labs',
        legal_contact_email: 'legal@harbor-labs.example',
        formation_list: ['ops@harbor-labs.example', 'dev@harbor-labs.example'],
        license: 'MIT',
        chat_platform: 'Discord',
        mission_statement: 'The Mission of the Project is to share signals.',
        agreement_type: 'DCO',
        is_spec_project: true,
        description: 'A shared signals exchange.',
      },
    });
  });

  test('revises with If-Match, keeping answers the form does not render', async ({ page }) => {
    const state = await mockProjectApplicationApis(page, [buildProposal({ revision: 3 })]);
    await gotoMyFormations(page);
    await waitForHydration(page);
    await page.getByTestId('my-formations-page-tabs-proposals').click();

    await page.getByTestId(`project-applications-open-${PROPOSAL_UID}`).click({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('project-application-drawer-title')).toHaveText('Harbor Signals');
    // A submitter never sees the formation team's decisions.
    await expect(page.getByTestId('project-application-drawer-accept')).toHaveCount(0);
    await expect(page.getByTestId('project-application-drawer-deny')).toHaveCount(0);

    await page.getByTestId('project-application-drawer-revise').click();
    await page.locator('#pa-project-name').fill('Harbor Signals Exchange');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByTestId('project-application-drawer-title')).toHaveText('Harbor Signals Exchange', { timeout: DATA_LOAD_TIMEOUT });
    const revise = state.requests.find((request) => request.method === 'PUT');
    expect(revise?.ifMatch).toBe('3');
    expect((revise?.body as { application: Record<string, unknown> }).application).toMatchObject({
      project_name: 'Harbor Signals Exchange',
      future_question: 'kept',
    });
  });

  test('withdraws after confirmation, then deletes after confirmation', async ({ page }) => {
    const state = await mockProjectApplicationApis(page, [buildProposal({ revision: 2 })]);
    await gotoMyFormations(page);
    await waitForHydration(page);
    await page.getByTestId('my-formations-page-tabs-proposals').click();
    await page.getByTestId(`project-applications-open-${PROPOSAL_UID}`).click({ timeout: DATA_LOAD_TIMEOUT });

    // An open proposal keeps withdraw and delete in the footer's More menu; Revise is the submitter's primary action.
    await expect(page.getByTestId('project-application-drawer-delete')).toHaveCount(0);
    const more = page.getByTestId('project-application-drawer-actions').getByRole('button', { name: 'More actions' });
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('menuitem', { name: 'Withdraw' }).click();
    await confirmDialog(page, 'Withdraw');
    await expect(page.getByTestId('project-application-drawer-state')).toContainText('Withdrawn', { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('project-application-drawer-revise')).toHaveCount(0);
    await expect(page.getByTestId('project-application-drawer-more')).toHaveCount(0);
    expect(state.requests.find((request) => request.path.endsWith('/withdraw'))?.ifMatch).toBe('2');

    await page.getByTestId('project-application-drawer-delete').click();
    await confirmDialog(page, 'Delete');
    await expect(page.getByTestId(`project-applications-row-${PROPOSAL_UID}`)).toHaveCount(0, { timeout: DATA_LOAD_TIMEOUT });
    expect(state.requests.find((request) => request.method === 'DELETE')?.ifMatch).toBe('3');
  });
});

test.describe('Project proposals — empty and no-results states (#3037)', () => {
  test('a submitter with no proposals sees the empty state with a Propose CTA', async ({ page }) => {
    await mockProjectApplicationApis(page, []);
    await gotoMyFormations(page);
    await waitForHydration(page);
    await page.getByTestId('my-formations-page-tabs-proposals').click();

    const empty = page.getByTestId('project-applications-empty-state');
    await expect(empty).toContainText('No proposals yet', { timeout: DATA_LOAD_TIMEOUT });
    await expect(empty.getByRole('link', { name: 'Propose a project' }).or(empty.getByRole('button', { name: 'Propose a project' }))).toBeVisible();
    await expect(page.getByTestId('project-applications-table')).toHaveCount(0);
  });

  test('a search with no match shows No results, and Reset restores the row', async ({ page }) => {
    await mockProjectApplicationApis(page, [buildProposal()]);
    await gotoMyFormations(page);
    await waitForHydration(page);
    await page.getByTestId('my-formations-page-tabs-proposals').click();
    await expect(page.getByTestId(`project-applications-row-${PROPOSAL_UID}`)).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.locator('[data-test="project-applications-search-input"]').fill('no such proposal');
    await expect(page.getByTestId('project-applications-no-results')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await page.getByTestId('project-applications-no-results').getByRole('button', { name: 'Reset filters' }).click();
    await expect(page.getByTestId(`project-applications-row-${PROPOSAL_UID}`)).toBeVisible();
  });
});

const TLF_UID = 'f0000000-0000-0000-0000-0000000000aa';

test.describe('Project proposals — formation team queue (#3037)', () => {
  async function gotoLfFormations(
    page: Page,
    isFormationTeam: boolean,
    proposal = buildProposal({ revision: 5 }),
    search = 'tab=proposals'
  ): Promise<Awaited<ReturnType<typeof mockProjectApplicationApis>>> {
    await stubFormationFlag(page, true);
    await stubPersona(page, true);
    await setPersonaCookie(page);
    const tlf = { uid: TLF_UID, slug: 'tlf', name: 'The Linux Foundation', logoUrl: null, isFoundation: true };
    await page.route('**/api/nav/lens-items*', (route) => {
      const lens = new URL(route.request().url()).searchParams.get('lens') ?? 'foundation';
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: lens === 'foundation' ? [tlf] : [], next_page_token: null, upstream_failed: false, lens }),
      });
    });
    await page.route('**/api/projects/tlf', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ uid: tlf.uid, slug: 'tlf', name: tlf.name, stage: 'Active', writer: false, auditor: true }),
          })
        : route.fallback()
    );
    // The propose page and the review surfaces read the foundation by uid; a funded, active membership project counts as one.
    await page.route(`**/api/projects/${TLF_UID}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          uid: TLF_UID,
          slug: 'tlf',
          name: tlf.name,
          stage: 'Active',
          funding: 'Funded',
          funding_model: ['Membership'],
          legal_entity_type: 'Corporation',
        }),
      })
    );
    await page.route('**/api/formations?*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ rows: [], tiles: { total: 0, foundations: 0, projects: 0, ready: 0, blocked: 0, blocked_items: 0, on_hold: 0, unmapped: 0 } }),
      })
    );
    const state = await mockProjectApplicationApis(page, [proposal], isFormationTeam);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await page.goto(`/foundation/formations?project=tlf&${search}`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await waitForHydration(page);
    return state;
  }

  test('accepts a proposal under a chosen parent project', async ({ page }) => {
    const state = await gotoLfFormations(page, true);

    await expect(page.getByTestId('formations-queue-page-tabs-proposals')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId(`project-applications-submitter-${PROPOSAL_UID}`)).toContainText('casey@example.org', { timeout: DATA_LOAD_TIMEOUT });
    await page.getByTestId(`project-applications-open-${PROPOSAL_UID}`).click();
    // The formation team sees who submitted, with a mailto link, on the header meta line.
    await expect(page.getByTestId('project-application-drawer-submitter')).toContainText('Casey Example');
    await expect(page.getByTestId('project-application-drawer-submitter-email')).toHaveAttribute('href', 'mailto:casey@example.org');

    await page.getByTestId('project-application-drawer-accept').click();
    await expect(page.getByTestId('project-application-accept-confirm').locator('button')).toBeDisabled();
    await page.locator('#project-application-accept-parent').fill('Harbor');
    await page.getByText('Harbor Foundation').click();
    await page.getByTestId('project-application-accept-confirm').click();

    await expect(page.getByTestId('project-application-drawer-state')).toContainText('Accepted', { timeout: DATA_LOAD_TIMEOUT });
    const accept = state.requests.find((request) => request.path.endsWith('/accept'));
    expect(accept?.ifMatch).toBe('5');
    expect(accept?.body).toMatchObject({ parent_project_uid: PARENT_PROJECT_UID, application: { future_question: 'kept' } });
  });

  test('denies a proposal after confirmation and keeps it in the queue', async ({ page }) => {
    await gotoLfFormations(page, true);
    await page.getByTestId(`project-applications-open-${PROPOSAL_UID}`).click({ timeout: DATA_LOAD_TIMEOUT });
    await page.getByTestId('project-application-drawer-deny').click();
    await confirmDialog(page, 'Deny');
    await expect(page.getByTestId(`project-applications-state-${PROPOSAL_UID}`)).toContainText('Denied', { timeout: DATA_LOAD_TIMEOUT });
  });

  test('shows the pending count on the tab, and drops it after a deny (#5229)', async ({ page }) => {
    await gotoLfFormations(page, true);
    const tab = page.getByTestId('formations-queue-page-tabs-proposals');
    await expect(tab).toHaveAttribute('aria-label', 'Project proposals, 1 awaiting review', { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('formations-queue-page-tabs-proposals-count')).toHaveText('1');

    await page.getByTestId(`project-applications-open-${PROPOSAL_UID}`).click();
    await page.getByTestId('project-application-drawer-deny').click();
    await confirmDialog(page, 'Deny');
    await expect(page.getByTestId('formations-queue-page-tabs-proposals-count')).toHaveCount(0, { timeout: DATA_LOAD_TIMEOUT });
  });

  test('?application=<uid> opens that proposal once and leaves the URL clean (#5229)', async ({ page }) => {
    await gotoLfFormations(page, true, buildProposal({ revision: 5 }), `tab=proposals&application=${PROPOSAL_UID}`);
    await expect(page.getByTestId('project-application-drawer-submitter')).toContainText('Casey Example', { timeout: DATA_LOAD_TIMEOUT });
    await expect(page).not.toHaveURL(/application=/);
  });

  test('an empty queue shows the staff empty state', async ({ page }) => {
    const state = await gotoLfFormations(page, true);
    state.applications = [];
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForHydration(page);
    await expect(page.getByTestId('project-applications-empty-state')).toContainText('No project proposals yet', { timeout: DATA_LOAD_TIMEOUT });
  });

  test('hides the proposals tab from a caller outside the formation team', async ({ page }) => {
    await gotoLfFormations(page, false);
    await expect(page.getByTestId('formations-queue-container')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('formations-queue-page-tabs')).toHaveCount(0);
    await expect(page.getByTestId('formations-queue-proposals')).toHaveCount(0);
  });

  test('offers "Propose a project" on the foundation queue and carries the foundation into the form and the create body (#5187)', async ({ page }) => {
    const state = await gotoLfFormations(page, false, buildProposal({ revision: 5 }));
    state.applications = [];

    await page.getByTestId('formations-queue-propose-project').click({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page).toHaveURL(new RegExp(`/formations/propose\\?parent=${TLF_UID}$`), { timeout: DATA_LOAD_TIMEOUT });
    await waitForHydration(page);
    await expect(page.getByTestId('propose-project-parent-line')).toContainText('Proposing under The Linux Foundation', { timeout: DATA_LOAD_TIMEOUT });

    await page.locator('#pa-project-name').fill('Harbor Signals');
    await page.locator('#pa-repository').fill('https://github.com/harbor-signals/core');
    await page.locator('#pa-website').fill('https://harbor-signals.example');
    await page.getByTestId('project-application-form-trademark').getByText('Not sure').click();
    await page.locator('#pa-organization').fill('Harbor Labs');
    await page.locator('#pa-legal').fill('legal@harbor-labs.example');
    await page.locator('[data-test="project-application-form-license"]').click();
    await page.getByRole('option', { name: 'MIT', exact: true }).click();
    await page.getByTestId('project-application-form-chat').getByText('Discord').click();
    await page.locator('#pa-mission').fill('The Mission of the Project is to share signals.');
    await page.getByTestId('project-application-form-agreement').getByText('DCO only').click();
    await page.getByTestId('project-application-form-spec').getByText('Yes').click();
    await page.locator('#pa-description').fill('A shared signals exchange.');
    await page.getByTestId('project-application-form-submit').click();

    await expect.poll(() => state.requests.some((request) => request.method === 'POST')).toBe(true);
    expect(state.requests.find((request) => request.method === 'POST')?.body).toMatchObject({ target_parent_uid: TLF_UID });
  });

  test('"Change" drops the foundation, and a malformed parent is ignored without a message (#5187)', async ({ page }) => {
    await gotoLfFormations(page, false);
    await page.goto(`/formations/propose?parent=${TLF_UID}`, { waitUntil: 'domcontentloaded' });
    await waitForHydration(page);
    await expect(page.getByTestId('propose-project-parent-line')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await page.getByTestId('propose-project-parent-change').click();
    await expect(page.getByTestId('propose-project-parent')).toHaveCount(0);
    await expect(page).toHaveURL(/\/formations\/propose$/);

    await page.goto('/formations/propose?parent=not-a-uuid', { waitUntil: 'domcontentloaded' });
    await waitForHydration(page);
    await expect(page.getByTestId('propose-project-title')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('propose-project-parent')).toHaveCount(0);
  });

  test('shows "Started from" to the formation team and prefills the parent when accepting (#5187)', async ({ page }) => {
    const state = await gotoLfFormations(page, true, buildProposal({ revision: 5, target_parent_uid: TLF_UID }));

    await expect(page.getByTestId(`project-applications-started-from-${PROPOSAL_UID}`)).toContainText('Started from: The Linux Foundation', {
      timeout: DATA_LOAD_TIMEOUT,
    });
    await page.getByTestId(`project-applications-open-${PROPOSAL_UID}`).click();
    await expect(page.getByTestId('project-application-drawer-started-from')).toContainText('Started from: The Linux Foundation');

    await page.getByTestId('project-application-drawer-accept').click();
    await expect(page.locator('#project-application-accept-parent')).toHaveValue('The Linux Foundation');
    await page.getByTestId('project-application-accept-confirm').click();

    await expect(page.getByTestId('project-application-drawer-state')).toContainText('Accepted', { timeout: DATA_LOAD_TIMEOUT });
    expect(state.requests.find((request) => request.path.endsWith('/accept'))?.body).toMatchObject({ parent_project_uid: TLF_UID });
  });
});
