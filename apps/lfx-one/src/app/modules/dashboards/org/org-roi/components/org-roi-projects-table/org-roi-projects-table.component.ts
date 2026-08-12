// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, Signal, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TableComponent } from '@components/table/table.component';
import {
  ORG_LENS_ROI_KPI_EXPLANATION,
  ORG_LENS_ROI_NO_VALUE,
  ORG_LENS_ROI_PROJECT_SORT_FIELDS,
  ORG_LENS_ROI_PROJECT_SORT_LABELS,
  ORG_LENS_ROI_PROJECTS_TABLE_DEFAULT_SORT,
  ORG_LENS_ROI_PROJECTS_TABLE_PAGE_SIZE,
  ORG_LENS_ROI_PROJECTS_TABLE_PAGE_SIZE_OPTIONS,
} from '@lfx-one/shared/constants';
import type {
  OrgLensRoiProjectAriaSort,
  OrgLensRoiProjectRow,
  OrgLensRoiProjectSortField,
  OrgLensRoiProjectTableRow,
  SortDirection,
} from '@lfx-one/shared/interfaces';
import { formatCurrency, formatPercent } from '@lfx-one/shared/utils';

/** Every project in the portfolio, sortable and paged. */
@Component({
  selector: 'lfx-org-roi-projects-table',
  imports: [TableComponent, RouterLink],
  templateUrl: './org-roi-projects-table.component.html',
})
export class OrgRoiProjectsTableComponent {
  private readonly router = inject(Router);

  /** The complete, uncapped project set — this view pages it rather than summarising it. */
  public readonly projects = input.required<OrgLensRoiProjectRow[]>();

  protected readonly sortFields = ORG_LENS_ROI_PROJECT_SORT_FIELDS;
  protected readonly sortLabels = ORG_LENS_ROI_PROJECT_SORT_LABELS;
  protected readonly pageSizeOptions = [...ORG_LENS_ROI_PROJECTS_TABLE_PAGE_SIZE_OPTIONS];

  /** The same wording the KPI band uses; the Investment column is a modelled cost. */
  protected readonly investmentExplanation = ORG_LENS_ROI_KPI_EXPLANATION.totalExpenditure;

  /**
   * Sort and page live in signals, not the URL. Encoding them would make this view's transient
   * state shareable and bookmarkable, which implies a durability the figures behind it do not
   * have — they are re-estimated on every pipeline run.
   */
  protected readonly sortField = signal<OrgLensRoiProjectSortField>(ORG_LENS_ROI_PROJECTS_TABLE_DEFAULT_SORT);
  protected readonly sortDir = signal<SortDirection>('desc');
  protected readonly pageSize = signal(ORG_LENS_ROI_PROJECTS_TABLE_PAGE_SIZE);
  protected readonly pageFirst = signal(0);

  protected readonly totalRecords: Signal<number> = computed(() => this.projects().length);

  protected readonly hasRows: Signal<boolean> = computed(() => this.totalRecords() > 0);

  protected readonly countLabel: Signal<string> = computed(() => `${this.totalRecords().toLocaleString('en-US')} projects`);

  protected readonly rows: Signal<OrgLensRoiProjectTableRow[]> = computed(() => {
    const field = this.sortField();
    const direction = this.sortDir() === 'asc' ? 1 : -1;
    return this.projects()
      .map((project) => this.toTableRow(project))
      .sort((a, b) => this.compareRows(a, b, direction, field));
  });

  protected readonly sortIconMap: Signal<Record<OrgLensRoiProjectSortField, string>> = computed(() => {
    const field = this.sortField();
    const active = this.sortDir() === 'asc' ? 'fa-solid fa-sort-up text-blue-500' : 'fa-solid fa-sort-down text-blue-500';
    const inactive = 'fa-light fa-sort text-gray-300';
    return this.mapOverFields((candidate) => (candidate === field ? active : inactive));
  });

  protected readonly ariaSortMap: Signal<Record<OrgLensRoiProjectSortField, OrgLensRoiProjectAriaSort>> = computed(() => {
    const field = this.sortField();
    const active: OrgLensRoiProjectAriaSort = this.sortDir() === 'asc' ? 'ascending' : 'descending';
    return this.mapOverFields((candidate) => (candidate === field ? active : 'none'));
  });

  /**
   * Row click navigates to the project's ROI detail.
   *
   * Clicks inside the first cell's anchor are left alone — the router already handles those, and
   * intercepting them would navigate twice. A modifier-click anywhere in the row is left alone for
   * the same reason the anchor is: it means "open elsewhere", and routing the current tab would
   * take away a choice the viewer just made. A row with no slug does nothing, since the slug is the
   * route parameter and routing without one would land on a URL that cannot resolve.
   */
  public openProject(row: OrgLensRoiProjectTableRow, event: MouseEvent): void {
    if (!row.projectSlug) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('a')) return;
    void this.router.navigate(['/org/roi/projects', row.projectSlug]);
  }

  public toggleSort(field: OrgLensRoiProjectSortField): void {
    if (this.sortField() === field) this.sortDir.set(this.sortDir() === 'desc' ? 'asc' : 'desc');
    else {
      this.sortField.set(field);
      // A name sorts A-Z first; a money column is asked about largest-first.
      this.sortDir.set(field === 'name' ? 'asc' : 'desc');
    }
    // Otherwise a viewer on page 12 re-sorts and lands somewhere arbitrary in the new order.
    this.pageFirst.set(0);
  }

  public onPage(event: { first?: number; rows?: number }): void {
    this.pageSize.set(event.rows ?? this.pageSize());
    this.pageFirst.set(event.first ?? 0);
  }

  private mapOverFields<T>(valueFor: (field: OrgLensRoiProjectSortField) => T): Record<OrgLensRoiProjectSortField, T> {
    return Object.fromEntries(this.sortFields.map((field) => [field, valueFor(field)])) as Record<OrgLensRoiProjectSortField, T>;
  }

  /**
   * Codepoint order, deliberately not `localeCompare`. The tie-break key is an opaque warehouse id,
   * so collation carries no meaning — and an unpinned locale would let Node and the browser order
   * ties differently, which for an SSR-rendered table is a hydration mismatch.
   */
  private compareProjectIds(a: string, b: string): number {
    return Number(a > b) - Number(a < b);
  }

  private compareRows(a: OrgLensRoiProjectTableRow, b: OrgLensRoiProjectTableRow, direction: number, field: OrgLensRoiProjectSortField): number {
    const tieBreak = this.compareProjectIds(a.projectId, b.projectId);

    if (field === 'name') {
      // A locale comparison here, unlike the tie-break above. A project name is read by a person,
      // and codepoint order sorts by ASCII value — every capitalised name ahead of every lowercase
      // one, and accented names last. The locale is pinned so Node and the browser agree, which is
      // the SSR hydration concern that makes an *unpinned* comparison unusable.
      return a.projectName.localeCompare(b.projectName, 'en-US') * direction || tieBreak;
    }

    const left = this.sortValue(a, field);
    const right = this.sortValue(b, field);
    // A measure that has no value is not a small one. Nulls sort last in both directions, so
    // reversing the order never promotes "unknown" to the top of the table — which is why this
    // sits outside the direction multiply rather than inside it.
    if (left === null && right === null) return tieBreak;
    if (left === null) return 1;
    if (right === null) return -1;
    return (left - right) * direction || tieBreak;
  }

  private sortValue(row: OrgLensRoiProjectTableRow, field: OrgLensRoiProjectSortField): number | null {
    if (field === 'investment') return row.totalExpenditure;
    if (field === 'return') return row.totalReturn;
    if (field === 'profit') return row.profit;
    if (field === 'roi') return row.roi;
    if (field === 'bcr') return row.bcr;
    return row.breakevenMarkup;
  }

  /** Never re-derives roi, bcr or profit: they are defined once in the metric layer. */
  private toTableRow(project: OrgLensRoiProjectRow): OrgLensRoiProjectTableRow {
    return {
      projectId: project.projectId,
      projectSlug: project.projectSlug,
      projectName: project.projectName,
      totalExpenditure: project.totalExpenditure,
      totalReturn: project.totalReturn,
      profit: project.profit,
      roi: project.roi,
      bcr: project.bcr,
      breakevenMarkup: project.breakevenMarkup,
      investmentLabel: formatCurrency(project.totalExpenditure),
      returnLabel: formatCurrency(project.totalReturn),
      profitLabel: formatCurrency(project.profit),
      roiLabel: this.isRenderable(project.roi) ? `${formatPercent(project.roi * 100)}%` : ORG_LENS_ROI_NO_VALUE,
      bcrLabel: this.isRenderable(project.bcr) ? `${project.bcr.toFixed(1)}×` : ORG_LENS_ROI_NO_VALUE,
      breakevenMarkupLabel: this.isRenderable(project.breakevenMarkup) ? project.breakevenMarkup.toFixed(3) : ORG_LENS_ROI_NO_VALUE,
    };
  }

  /**
   * A measure is renderable only if it is actually a finite number. `=== null` is not enough: an
   * absent key is `undefined`, which slips past it and reaches `toFixed()`. These measures are
   * nullable by design, so anything non-numeric renders as the no-value indicator, never as 0.
   */
  private isRenderable(value: number | null | undefined): value is number {
    return typeof value === 'number' && Number.isFinite(value);
  }
}
