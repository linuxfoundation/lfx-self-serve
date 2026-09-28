// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Structural contract for Propose a project (#3037): the data-testid hooks, form structure and ARIA the
 * content spec (project-proposals.spec.ts) and future changes rely on.
 */

import { expect, test } from '@playwright/test';

import { DATA_LOAD_TIMEOUT, gotoMyFormations } from './helpers/formation-checklist.helper';
import { waitForHydration } from './helpers/meeting-composer-guests.helper';
import { buildProposal, mockProjectApplicationApis, PROPOSAL_UID } from './helpers/project-application.helper';

test.setTimeout(120_000);

test.describe('Propose a project — structure (#3037)', () => {
  test('My Formations exposes the CTA and a tablist with both page tabs', async ({ page }) => {
    await mockProjectApplicationApis(page, []);
    await gotoMyFormations(page);

    const cta = page.getByTestId('my-formations-propose-project');
    await expect(cta).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    const tabs = page.getByTestId('my-formations-page-tabs');
    await expect(tabs).toHaveAttribute('role', 'tablist');
    await expect(page.getByTestId('my-formations-page-tabs-formations')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('my-formations-page-tabs-proposals')).toHaveAttribute('aria-selected', 'false');
  });

  test('the propose page renders four labelled sections, the aside, and the footer actions', async ({ page }) => {
    await mockProjectApplicationApis(page, []);
    await gotoMyFormations(page);
    await waitForHydration(page);
    await page.getByTestId('my-formations-propose-project').click();

    for (const section of ['project', 'organization', 'governance', 'about']) {
      await expect(page.getByTestId(`project-application-form-section-${section}`)).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    }
    // Every text control has a programmatic label.
    for (const id of ['pa-project-name', 'pa-repository', 'pa-website', 'pa-organization', 'pa-legal', 'pa-formation-list', 'pa-mission']) {
      await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1);
    }
    await expect(page.getByTestId('propose-project-aside')).toBeVisible();
    await expect(page.getByTestId('propose-project-contact')).toHaveAttribute('href', /^mailto:/);
    await expect(page.getByTestId('project-application-form-submit')).toBeVisible();
    await expect(page.getByTestId('project-application-form-cancel')).toBeVisible();
    // No parent project or logo inputs in this release.
    await expect(page.getByText('Parent project')).toHaveCount(0);
    await expect(page.getByText('Project logo')).toHaveCount(0);
  });

  test('the submitted proposals table and drawer expose their hooks', async ({ page }) => {
    await mockProjectApplicationApis(page, [buildProposal()]);
    await gotoMyFormations(page);
    await waitForHydration(page);
    await page.getByTestId('my-formations-page-tabs-proposals').click();

    await expect(page.getByTestId('project-applications-submitter')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('project-applications-table')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId(`project-applications-row-${PROPOSAL_UID}`)).toBeVisible();
    // Submitter mode has no submitter column.
    await expect(page.getByTestId(`project-applications-submitter-${PROPOSAL_UID}`)).toHaveCount(0);

    await page.getByTestId(`project-applications-open-${PROPOSAL_UID}`).click();
    await expect(page.getByTestId('project-application-drawer-body')).toBeVisible();
    await expect(page.getByTestId('project-application-drawer-actions')).toBeVisible();
    await expect(page.getByTestId('project-application-drawer-submitter')).toBeVisible();
    // Unknown answers still render, as plain text.
    await expect(page.getByTestId('project-application-drawer-answer-future_question')).toHaveText('kept');
  });
});
