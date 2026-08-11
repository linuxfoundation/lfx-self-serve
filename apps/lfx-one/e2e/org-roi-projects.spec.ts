// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
// Imported from the module, not the `utils` barrel: the barrel re-exports form.utils, which pulls
// in @angular/common and fails to load outside the Angular app with a JIT compiler error.
import { formatCurrency } from '@lfx-one/shared/utils/number.utils';

import {
  BAR_MAX_ROWS,
  BUBBLE_MAX_POINTS,
  DEFAULT_SELECTED_PROJECTS,
  gotoOrgRoiPage,
  MANY_PROJECT_COUNT,
  MANY_PROJECT_INPUTS,
  MANY_PROJECTS,
  MOCK_PROJECT_INPUTS,
  MOCK_PROJECTS,
  NEGATIVE_PROJECTS,
  NEGATIVE_PROJECTS_TOTAL,
  NO_INVESTMENT_PROJECT,
  NO_VALUE,
  PICKER_DEFAULT_COUNT,
  PROJECTS_WITH_NULL_RATIOS,
  SANKEY_MAX_PROJECTS,
  stubOrgLensContext,
  UNSELECTED_PROJECT,
} from './helpers/org-roi.helper';

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
    // The donut summarises, but the payload behind it must carry every project — the projects
    // section and its table read the same response.
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

/**
 * The projects section: four views over the same complete project set, three of them driven by one
 * shared selection. Every expected string is derived from the fixture through the same formatter
 * the components use.
 */
test.describe('Org Lens ROI Metrics — projects section', () => {
  test('opens on the comparison view with the top projects by return already selected', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);

    const section = page.getByTestId('org-roi-projects-section');
    await expect(section).toBeVisible();
    await expect(page.getByTestId('org-roi-projects-section-tab-bar')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('org-roi-projects-bar-chart')).toBeVisible();

    const chips = page.getByTestId('org-roi-project-picker-chips');
    for (const project of DEFAULT_SELECTED_PROJECTS) {
      await expect(chips).toContainText(project.name);
    }
    // The sixth-ranked project is not selected by default, which is what makes the default a
    // selection rather than just "everything".
    await expect(chips).not.toContainText(UNSELECTED_PROJECT.name);
  });

  test('shares one selection across the comparison, flow and efficiency views', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);

    const removed = DEFAULT_SELECTED_PROJECTS[0];
    await page.getByTestId(`org-roi-project-picker-remove-prj-${removed.slug}`).click();
    await expect(page.getByTestId('org-roi-project-picker-chips')).not.toContainText(removed.name);

    // The selection belongs to the section, not to whichever view happened to change it.
    await page.getByTestId('org-roi-projects-section-tab-sankey').click();
    await expect(page.getByTestId('org-roi-project-picker-chips')).not.toContainText(removed.name);

    await page.getByTestId('org-roi-projects-section-tab-bubble').click();
    await expect(page.getByTestId('org-roi-project-picker-chips')).not.toContainText(removed.name);
    await expect(page.getByTestId('org-roi-projects-bubble-table')).not.toContainText(removed.name);
  });

  test('applies the Top, All and None presets', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);

    await page.getByTestId('org-roi-project-picker-none').click();
    await expect(page.getByTestId('org-roi-project-picker-empty')).toBeVisible();
    await expect(page.getByTestId('org-roi-projects-bar-empty')).toBeVisible();

    await page.getByTestId('org-roi-project-picker-all').click();
    const chips = page.getByTestId('org-roi-project-picker-chips');
    for (const project of MOCK_PROJECT_INPUTS) {
      await expect(chips).toContainText(project.name);
    }

    await page.getByTestId('org-roi-project-picker-top').click();
    await expect(chips).not.toContainText(UNSELECTED_PROJECT.name);
  });

  test('adds a project by search', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);

    await page.locator('[data-test="org-roi-project-picker-search"]').fill(UNSELECTED_PROJECT.name);
    await expect(page.getByTestId('org-roi-project-picker-match-count')).toContainText('1 project matches.');

    await page.getByTestId(`org-roi-project-picker-add-prj-${UNSELECTED_PROJECT.slug}`).click();
    await expect(page.getByTestId('org-roi-project-picker-chips')).toContainText(UNSELECTED_PROJECT.name);
    // Adding clears the query, so the box is ready for the next search rather than still filtered.
    await expect(page.locator('[data-test="org-roi-project-picker-search"]')).toHaveValue('');
  });

  test('reports how many projects a search actually matched, not how many it drew', async ({ page }) => {
    // The match list is capped for readability. Reporting the capped length told a viewer
    // searching a large portfolio that 20 projects matched when hundreds did.
    await stubOrgLensContext(page, { projects: MANY_PROJECTS });
    await gotoOrgRoiPage(page);

    await page.locator('[data-test="org-roi-project-picker-search"]').fill('Project');
    const label = page.getByTestId('org-roi-project-picker-match-count');
    // Every project bar the five already selected matches the shared prefix.
    await expect(label).toContainText(`${(MANY_PROJECT_COUNT - PICKER_DEFAULT_COUNT).toLocaleString('en-US')} projects match`);
    await expect(label).toContainText('showing the first');
  });

  test('keeps an emptied selection empty when the estimation method changes', async ({ page }) => {
    // None is a choice. Restoring the default on the next payload treated it as an absence, so a
    // method switch silently put five projects back onto a deliberately cleared chart.
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);

    await page.getByTestId('org-roi-project-picker-none').click();
    await expect(page.getByTestId('org-roi-project-picker-empty')).toBeVisible();

    await page.getByTestId('org-roi-assumptions-trigger').click();
    await page.getByTestId('org-roi-assumptions-method-direct').click();

    await expect(page.getByTestId('org-roi-project-picker-empty')).toBeVisible();
    await expect(page.getByTestId('org-roi-projects-bar-empty')).toBeVisible();
  });

  test('renders projects after a failed read is retried under another method', async ({ page }) => {
    // An end-to-end recovery path rather than a regression guard: the selection logic distinguishes
    // "never chosen" from "emptied", so a failed read can no longer strand the charts blank by
    // construction. Keyed on the method in the request rather than on a call count — the donut and
    // the section both read this endpoint, and how many times either retries is not this test's
    // business to predict.
    await stubOrgLensContext(page);
    await page.route('**/api/orgs/*/lens/roi/projects*', (route) => {
      const failed = new URL(route.request().url()).searchParams.get('method') === 'logit';
      if (failed) {
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'UNAVAILABLE' }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PROJECTS) });
    });
    await gotoOrgRoiPage(page);

    await expect(page.getByTestId('org-roi-projects-section-error')).toBeVisible();

    // Switching method re-issues the read, which now succeeds.
    await page.getByTestId('org-roi-assumptions-trigger').click();
    await page.getByTestId('org-roi-assumptions-method-direct').click();

    const chips = page.getByTestId('org-roi-project-picker-chips');
    await expect(chips).toBeVisible();
    await expect(chips).toContainText(DEFAULT_SELECTED_PROJECTS[0].name);
    await expect(page.getByTestId('org-roi-projects-bar-chart')).toBeVisible();
  });

  test('does not offer an already-selected project as a search match', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);

    const selected = DEFAULT_SELECTED_PROJECTS[0];
    await page.locator('[data-test="org-roi-project-picker-search"]').fill(selected.name);
    await expect(page.getByTestId('org-roi-project-picker-match-count')).toContainText('No unselected project matches that name.');
  });

  test('states that the comparison bars use separate scales and never rescales the stack', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);

    await expect(page.getByTestId('org-roi-projects-bar-scale-note')).toContainText('separate scales');

    // Categories sum to their project's investment by construction, so this warning must be absent
    // for a fixture whose parts add up — the fixture builder carries the balance in its last
    // category precisely so this holds.
    await expect(page.getByTestId('org-roi-projects-bar-reconciliation-warning')).toHaveCount(0);

    const table = page.getByTestId('org-roi-projects-bar-table');
    const leader = DEFAULT_SELECTED_PROJECTS[0];
    await expect(table).toContainText(formatCurrency(leader.expenditure));
    await expect(table).toContainText(formatCurrency(leader.return));
  });

  test('toggles the flow view between investment and return', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);
    await page.getByTestId('org-roi-projects-section-tab-sankey').click();

    await expect(page.getByTestId('org-roi-projects-sankey-measure-investment')).toHaveAttribute('aria-pressed', 'true');
    const flows = page.getByTestId('org-roi-projects-sankey-table');
    // Investment fans out through its categories, so the org node reaches a category, not a project.
    await expect(flows).toContainText('Your organization');
    await expect(flows).toContainText('Code Contribution');

    await page.getByTestId('org-roi-projects-sankey-measure-return').click();
    await expect(page.getByTestId('org-roi-projects-sankey-measure-return')).toHaveAttribute('aria-pressed', 'true');
    await expect(flows).toContainText(formatCurrency(DEFAULT_SELECTED_PROJECTS[0].return));
    // Return is not decomposed by category in the warehouse, so no category node may appear.
    await expect(flows).not.toContainText('Code Contribution');
  });

  test('carries the modelled-cost disclosure on every view that shows an investment figure', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);

    const barNote = page.getByTestId('org-roi-projects-bar-modelled-cost-note');
    await expect(barNote).toContainText('modelled cost');
    await expect(barNote).toContainText('not actual or reported compensation');

    await page.getByTestId('org-roi-projects-section-tab-sankey').click();
    await expect(page.getByTestId('org-roi-projects-sankey-modelled-cost-note')).toContainText('modelled cost');
    // The return flow is not derived from investment, so it does not owe the disclosure.
    await page.getByTestId('org-roi-projects-sankey-measure-return').click();
    await expect(page.getByTestId('org-roi-projects-sankey-modelled-cost-note')).toHaveCount(0);

    await page.getByTestId('org-roi-projects-section-tab-bubble').click();
    await expect(page.getByTestId('org-roi-projects-bubble-modelled-cost-note')).toContainText('modelled cost');

    await page.getByTestId('org-roi-projects-section-tab-table').click();
    await expect(page.getByTestId('org-roi-projects-table-modelled-cost-note')).toContainText('modelled cost');
  });

  test('names every chart for assistive technology and lists its values as text', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);

    await expect(page.getByTestId('org-roi-projects-bar-chart')).toHaveAttribute('aria-label', /bar chart comparing modelled investment/i);
    await expect(page.getByTestId('org-roi-projects-bar-table')).toHaveCount(1);

    await page.getByTestId('org-roi-projects-section-tab-sankey').click();
    await expect(page.getByTestId('org-roi-projects-sankey-chart')).toHaveAttribute('aria-label', /flow diagram of modelled investment/i);
    await expect(page.getByTestId('org-roi-projects-sankey-table')).toHaveCount(1);

    await page.getByTestId('org-roi-projects-section-tab-bubble').click();
    await expect(page.getByTestId('org-roi-projects-bubble-chart')).toHaveAttribute('aria-label', /logarithmic axes/i);
    await expect(page.getByTestId('org-roi-projects-bubble-table')).toHaveCount(1);
  });

  test('explains the logarithmic axes on the efficiency view', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);
    await page.getByTestId('org-roi-projects-section-tab-bubble').click();

    await expect(page.getByTestId('org-roi-projects-bubble-scale-note')).toContainText('logarithmic');
    // The fixture has no zero-valued project, so nothing is floored and the caveat must not appear.
    await expect(page.getByTestId('org-roi-projects-bubble-floored-note')).toHaveCount(0);
  });

  test('discloses a project it had to draw at the axis floor', async ({ page }) => {
    await stubOrgLensContext(page, { projects: PROJECTS_WITH_NULL_RATIOS });
    await gotoOrgRoiPage(page);
    await page.getByTestId('org-roi-projects-section-tab-bubble').click();
    await page.getByTestId('org-roi-project-picker-all').click();

    const note = page.getByTestId('org-roi-projects-bubble-floored-note');
    await expect(note).toBeVisible();
    await expect(note).toContainText(NO_INVESTMENT_PROJECT.projectName);
    // Its true figures are still reported, unfloored.
    await expect(page.getByTestId('org-roi-projects-bubble-table')).toContainText(NO_INVESTMENT_PROJECT.projectName);
  });

  test('pages the table through the complete project set', async ({ page }) => {
    await stubOrgLensContext(page, { projects: MANY_PROJECTS });
    await gotoOrgRoiPage(page);
    await page.getByTestId('org-roi-projects-section-tab-table').click();

    await expect(page.getByTestId('org-roi-projects-table-count')).toContainText(`${MANY_PROJECT_COUNT.toLocaleString('en-US')} projects`);

    // The payload arrives ordered by return descending, so the first page opens on the leader and
    // the last project is nowhere near it.
    const first = MANY_PROJECT_INPUTS[0];
    const last = MANY_PROJECT_INPUTS[MANY_PROJECT_COUNT - 1];
    await expect(page.getByTestId(`org-roi-projects-table-row-prj-${first.slug}`)).toBeVisible();
    await expect(page.getByTestId(`org-roi-projects-table-row-prj-${last.slug}`)).toHaveCount(0);

    // Reversing the sort must reach the other end of the same complete set — not of a capped one.
    await page.getByTestId('org-roi-projects-table-sort-return').click();
    await expect(page.getByTestId(`org-roi-projects-table-row-prj-${last.slug}`)).toBeVisible();
    await expect(page.getByTestId(`org-roi-projects-table-row-prj-${first.slug}`)).toHaveCount(0);
  });

  test('sorts by a metric column and shows the direction', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);
    await page.getByTestId('org-roi-projects-section-tab-table').click();

    const cheapest = [...MOCK_PROJECT_INPUTS].sort((a, b) => a.expenditure - b.expenditure)[0];
    await page.getByTestId('org-roi-projects-table-sort-investment').click();
    // First click on a money column sorts largest-first, so the cheapest project is not the leader.
    const rows = page.locator('[data-testid^="org-roi-projects-table-row-"]');
    await expect(rows.first()).not.toContainText(cheapest.name);

    await page.getByTestId('org-roi-projects-table-sort-investment').click();
    await expect(rows.first()).toContainText(cheapest.name);
  });

  test('renders an undefined ratio as the no-value indicator, never as zero', async ({ page }) => {
    await stubOrgLensContext(page, { projects: PROJECTS_WITH_NULL_RATIOS });
    await gotoOrgRoiPage(page);
    await page.getByTestId('org-roi-projects-section-tab-table').click();

    const row = page.getByTestId(`org-roi-projects-table-row-${NO_INVESTMENT_PROJECT.projectId}`);
    await expect(row).toBeVisible();
    // A blank ROI means "there was no investment to divide by", not "it broke even".
    await expect(row).toContainText(NO_VALUE);
    await expect(row).not.toContainText('0.0%');
  });

  test('does not offer the picker on the table, which pages the complete set', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);

    await expect(page.getByTestId('org-roi-project-picker')).toBeVisible();
    await page.getByTestId('org-roi-projects-section-tab-table').click();
    await expect(page.getByTestId('org-roi-project-picker')).toHaveCount(0);
  });

  test('discloses how many selected projects a chart could not draw', async ({ page }) => {
    await stubOrgLensContext(page, { projects: MANY_PROJECTS });
    await gotoOrgRoiPage(page);
    await page.getByTestId('org-roi-project-picker-all').click();

    // "All" is a legitimate selection on a portfolio this size, so the shortfall is disclosed
    // rather than the selection being silently capped at the picker.
    const barNote = page.getByTestId('org-roi-projects-bar-truncation-note');
    await expect(barNote).toBeVisible();
    await expect(barNote).toContainText(`${MANY_PROJECT_COUNT - BAR_MAX_ROWS} more`);

    await page.getByTestId('org-roi-projects-section-tab-sankey').click();
    const sankeyNote = page.getByTestId('org-roi-projects-sankey-truncation-note');
    await expect(sankeyNote).toBeVisible();
    await expect(sankeyNote).toContainText(`${MANY_PROJECT_COUNT - SANKEY_MAX_PROJECTS} more`);

    // A scatter tolerates far more points than bars or flows, so its ceiling is higher — but the
    // fixture still exceeds it, and it owes the same disclosure.
    await page.getByTestId('org-roi-projects-section-tab-bubble').click();
    const bubbleNote = page.getByTestId('org-roi-projects-bubble-truncation-note');
    await expect(bubbleNote).toBeVisible();
    await expect(bubbleNote).toContainText(`${MANY_PROJECT_COUNT - BUBBLE_MAX_POINTS} more`);
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

    await expect(page.getByTestId('org-roi-projects-section-forbidden')).toBeVisible();
    await expect(page.getByTestId('org-roi-project-picker')).toHaveCount(0);
    await expect(page.getByTestId('org-roi-projects-bar-chart')).toHaveCount(0);
  });

  test('distinguishes a 503 from a refusal in the projects section', async ({ page }) => {
    await stubOrgLensContext(page);
    await page.route('**/api/orgs/*/lens/roi/projects*', (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'ROLE_GRANTS_UNAVAILABLE' }) })
    );
    await gotoOrgRoiPage(page);

    await expect(page.getByTestId('org-roi-projects-section-error')).toBeVisible();
    await expect(page.getByTestId('org-roi-projects-section-forbidden')).toHaveCount(0);
  });
});
