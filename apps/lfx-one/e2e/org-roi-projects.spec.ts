// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
// Imported from the module, not the `utils` barrel: the barrel re-exports form.utils, which pulls
// in @angular/common and fails to load outside the Angular app with a JIT compiler error.
import { formatCurrency } from '@lfx-one/shared/utils/number.utils';

import { gotoOrgRoiPage, MOCK_PROJECT_INPUTS, MOCK_PROJECTS, NEGATIVE_PROJECTS, NEGATIVE_PROJECTS_TOTAL, stubOrgLensContext } from './helpers/org-roi.helper';

test.setTimeout(120_000);

/**
 * Every expected string is derived from the fixture through the same formatter the component uses.
 * The fixture's eight projects are shaped so each measure leaves a differently sized remainder, and
 * so two of them lose money — negative net return is 6.45% of production project rows across 775
 * organizations, so it is exercised here as a mainline path rather than as a variant fixture.
 */
const [KUBERNETES, OPENSTACK, CEPH] = MOCK_PROJECT_INPUTS;

const ALL_LOSS_MAKING = {
  method: 'logit',
  rows: MOCK_PROJECTS.rows.map((row) => {
    const project = row as { totalExpenditure: number; totalReturn: number; profit: number };
    return { ...project, totalReturn: project.totalExpenditure / 4, profit: project.totalExpenditure / 4 - project.totalExpenditure };
  }),
};

test.describe('Org Lens ROI Metrics — leading projects', () => {
  test('ranks projects by investment and labels the remainder with its project count', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);

    const donut = page.getByTestId('org-roi-projects-donut');
    await expect(donut).toBeVisible();
    await expect(page.getByTestId('org-roi-projects-donut-measure-investment')).toHaveAttribute('aria-pressed', 'true');

    const legend = page.getByTestId('org-roi-projects-donut-legend');
    await expect(legend).toContainText(KUBERNETES.name);
    await expect(legend).toContainText(formatCurrency(KUBERNETES.expenditure));
    await expect(legend).toContainText(OPENSTACK.name);
    await expect(legend).toContainText(CEPH.name);
    // Three projects cover 83.9% of investment, so the other five collapse into one entry.
    await expect(legend).toContainText('Other (5 projects)');
  });

  test('reorders and re-groups when the measure changes', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);

    const legend = page.getByTestId('org-roi-projects-donut-legend');
    await expect(legend).toContainText(CEPH.name);

    await page.getByTestId('org-roi-projects-donut-measure-return').click();
    await expect(page.getByTestId('org-roi-projects-donut-measure-return')).toHaveAttribute('aria-pressed', 'true');

    // Two projects already cover 81.8% of return, so Ceph moves from a slice into the remainder.
    await expect(legend).toContainText(formatCurrency(KUBERNETES.return));
    await expect(legend).toContainText(formatCurrency(OPENSTACK.return));
    await expect(legend).toContainText('Other (6 projects)');
    await expect(legend).not.toContainText(CEPH.name);
  });

  test('reports the true signed value of a negative net return', async ({ page }) => {
    // An arc cannot be negative, so the geometry is clamped — but the figure must survive that
    // clamp intact, or a loss-making project silently reads as costless.
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);

    await page.getByTestId('org-roi-projects-donut-measure-netReturn').click();
    await expect(page.getByTestId('org-roi-projects-donut-measure-netReturn')).toHaveAttribute('aria-pressed', 'true');

    const note = page.getByTestId('org-roi-projects-donut-negative-note');
    await expect(note).toBeVisible();
    await expect(note).toContainText(`${NEGATIVE_PROJECTS.length} projects have a negative net return`);
    await expect(note).toContainText(formatCurrency(NEGATIVE_PROJECTS_TOTAL));
    await expect(note).toContainText('cannot be sized as a slice');

    const list = page.getByTestId('org-roi-projects-donut-negative-list');
    for (const project of NEGATIVE_PROJECTS) {
      await expect(list).toContainText(project.name);
      // The signed figure itself, not just the project's name.
      await expect(list).toContainText(formatCurrency(project.profit));
    }

    // The chart still renders, sized by the profitable projects alone.
    await expect(page.getByTestId('org-roi-projects-donut-chart')).toBeVisible();

    // Loss-making projects are in exactly one place. They are excluded from the remainder as well
    // as from the arcs, so the remainder counts only the four profitable projects left over —
    // reporting them both here and inside "Other" would double-count them.
    const profitable = MOCK_PROJECT_INPUTS.filter((input) => input.return > input.expenditure);
    await expect(page.getByTestId('org-roi-projects-donut-legend')).toContainText(`Other (${profitable.length - 2} projects)`);
  });

  test('does not claim a negative net return on a measure that has none', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);

    // Investment is never negative, so the disclosure must not follow the viewer across tabs.
    await expect(page.getByTestId('org-roi-projects-donut-negative-note')).toHaveCount(0);

    await page.getByTestId('org-roi-projects-donut-measure-netReturn').click();
    await expect(page.getByTestId('org-roi-projects-donut-negative-note')).toBeVisible();

    await page.getByTestId('org-roi-projects-donut-measure-investment').click();
    await expect(page.getByTestId('org-roi-projects-donut-negative-note')).toHaveCount(0);
  });

  test('drops the chart but keeps the figures when no project has a positive net return', async ({ page }) => {
    await stubOrgLensContext(page, { projects: ALL_LOSS_MAKING });
    await gotoOrgRoiPage(page);

    await page.getByTestId('org-roi-projects-donut-measure-netReturn').click();

    await expect(page.getByTestId('org-roi-projects-donut-no-positive')).toBeVisible();
    await expect(page.getByTestId('org-roi-projects-donut-chart')).toHaveCount(0);
    // The absence of a drawable magnitude must not take the numbers with it.
    const list = page.getByTestId('org-roi-projects-donut-negative-list');
    await expect(list).toContainText(KUBERNETES.name);
    await expect(list).toContainText(formatCurrency(KUBERNETES.expenditure / 4 - KUBERNETES.expenditure));
  });

  test('carries the modelled-cost disclosure wherever a figure derives from modelled cost', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);

    const note = page.getByTestId('org-roi-projects-donut-modelled-cost-note');
    await expect(note).toBeVisible();
    await expect(note).toContainText('modelled cost');
    await expect(note).toContainText('not actual or reported compensation');
    await expect(note).toContainText('same for every organization');
    await expect(note).toContainText('No salary, payroll, or invoice data is used.');

    // Net Return is totalReturn − totalExpenditure, so it is a direct function of the modelled
    // cost and owes the same disclosure — the per-project loss figures render on this tab.
    await page.getByTestId('org-roi-projects-donut-measure-netReturn').click();
    await expect(page.getByTestId('org-roi-projects-donut-modelled-cost-note')).toBeVisible();

    // Total Return alone is not derived from investment, so it does not.
    await page.getByTestId('org-roi-projects-donut-measure-return').click();
    await expect(page.getByTestId('org-roi-projects-donut-modelled-cost-note')).toHaveCount(0);
  });

  test('serves the complete project set rather than a capped subset', async ({ page }) => {
    // The donut summarises, but the payload behind it must carry every project — the forthcoming
    // projects section and its table read the same response.
    const payloads: { rows: unknown[] }[] = [];
    page.on('response', async (response) => {
      if (!/\/lens\/roi\/projects(\?|$)/.test(response.url())) return;
      const body = (await response.json().catch(() => null)) as { rows: unknown[] } | null;
      if (body !== null) payloads.push(body);
    });

    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);
    await expect(page.getByTestId('org-roi-projects-donut-chart')).toBeVisible();

    expect(payloads.length).toBeGreaterThan(0);
    expect(payloads[0].rows).toHaveLength(MOCK_PROJECT_INPUTS.length);
  });

  test('names the chart for assistive technology and lists its values as text', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);

    await expect(page.getByTestId('org-roi-projects-donut-chart')).toHaveAttribute('aria-label', /doughnut chart of the leading projects by investment/i);
    await expect(page.getByTestId('org-roi-projects-donut-legend')).toBeVisible();
  });

  test('refuses an ungranted caller without rendering any project figure', async ({ page }) => {
    await stubOrgLensContext(page);
    await page.route('**/api/orgs/*/lens/roi/projects*', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'FORBIDDEN', message: 'You do not have access to Org Lens data for this organization.' }),
      })
    );
    await gotoOrgRoiPage(page);

    await expect(page.getByTestId('org-roi-projects-donut-forbidden')).toBeVisible();
    await expect(page.getByTestId('org-roi-projects-donut-legend')).toHaveCount(0);
    await expect(page.getByTestId('org-roi-projects-donut-chart')).toHaveCount(0);
  });

  test('distinguishes a 503 from a refusal on the projects read', async ({ page }) => {
    await stubOrgLensContext(page);
    await page.route('**/api/orgs/*/lens/roi/projects*', (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'ROLE_GRANTS_UNAVAILABLE' }) })
    );
    await gotoOrgRoiPage(page);

    await expect(page.getByTestId('org-roi-projects-donut-error')).toBeVisible();
    await expect(page.getByTestId('org-roi-projects-donut-forbidden')).toHaveCount(0);
  });
});
