// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  DEFAULT_ORG_TRAINING_GROUPS_PAGE_SIZE,
  DEFAULT_ORG_TRAINING_GROUPS_SORT_FIELD,
  DEFAULT_ORG_TRAINING_GROUPS_SORT_ORDER,
  DESCENDING_DEFAULT_ORG_TRAINING_GROUPS_SORT_FIELDS,
  EMPTY_ORG_TRAINING_GROUPS_RESPONSE,
  ENROLL_AGAIN_URL,
  ORG_TRAINING_GROUP_BY_OPTIONS,
  ORG_TRAINING_GROUPS_SCOPE_NOTES,
} from '@lfx-one/shared/constants';
import type {
  OrgTrainingGroupBy,
  OrgTrainingGroupEmployeesParams,
  OrgTrainingGroupRow,
  OrgTrainingGroupRowVm,
  OrgTrainingGroupsResponse,
  OrgTrainingGroupSortField,
  OrgTrainingGroupStatus,
  OrgTrainingStatsQuery,
  OrgTrainingTabId,
} from '@lfx-one/shared/interfaces';
import { ButtonComponent } from '@components/button/button.component';
import { TableComponent } from '@components/table/table.component';
import { OrgLensTrainingService } from '@shared/services/org-lens-training.service';
import { catchError, finalize, of, skip, switchMap } from 'rxjs';

import { OrgTrainingGroupEmployeesDrawerComponent } from '../org-training-group-employees-drawer/org-training-group-employees-drawer.component';

/**
 * The Training page's one group-by table: person-course pairs of the selected range and filters, grouped by `groupBy`,
 * split by product type into the Certifications and Trainings tabs. Sort and paging are table-local and the name search comes from the page; the
 * footer totals come from the response; only the Certified / Completed total equals its stat tile, while In progress and People per tab can differ (see `ORG_TRAINING_GROUPS_SCOPE_NOTES`).
 */
@Component({
  selector: 'lfx-org-training-groups-table',
  imports: [DecimalPipe, ButtonComponent, TableComponent, OrgTrainingGroupEmployeesDrawerComponent],
  templateUrl: './org-training-groups-table.component.html',
})
export class OrgTrainingGroupsTableComponent {
  private readonly trainingService = inject(OrgLensTrainingService);

  public readonly orgUid = input.required<string>();
  /** Range and filters from the URL. */
  public readonly query = input.required<OrgTrainingStatsQuery>();
  public readonly groupBy = input.required<OrgTrainingGroupBy>();
  public readonly tab = input.required<OrgTrainingTabId>();
  /** The page's name search (it sits in the filter row): narrows the rows below, never the stat tiles. */
  public readonly searchQuery = input<string>('');

  protected readonly browseUrl = ENROLL_AGAIN_URL;
  protected readonly pageSizeOptions = [10, 25, 50];

  // ─── Table-local state ─────────────────────────────────────────────────────
  protected readonly sortField = signal<OrgTrainingGroupSortField>(DEFAULT_ORG_TRAINING_GROUPS_SORT_FIELD);
  protected readonly sortOrder = signal<'ASC' | 'DESC'>(DEFAULT_ORG_TRAINING_GROUPS_SORT_ORDER);
  protected readonly pageSize = signal(DEFAULT_ORG_TRAINING_GROUPS_PAGE_SIZE);
  protected readonly loading = signal(false);
  protected readonly error = signal(false);
  private readonly retryTrigger = signal(0);

  // Drawer state
  protected readonly drawerVisible = signal(false);
  protected readonly drawerParams = signal<OrgTrainingGroupEmployeesParams | null>(null);
  protected readonly drawerLabel = signal('');
  protected readonly drawerCount = signal(0);

  private readonly viewKey = computed(() => JSON.stringify([this.orgUid(), this.query(), this.groupBy(), this.tab(), this.searchQuery()]));
  /** The view (org, filters, group-by, tab, search) the offset belongs to; a different view starts on page one. */
  private readonly paging = signal<{ viewKey: string; offset: number }>({ viewKey: '', offset: 0 });
  protected readonly offset = computed(() => {
    const paging = this.paging();
    return paging.viewKey === this.viewKey() ? paging.offset : 0;
  });

  protected readonly groups: Signal<OrgTrainingGroupsResponse> = this.initGroups();

  // Display strings per row, resolved once so the template calls no functions.
  protected readonly rows: Signal<OrgTrainingGroupRowVm[]> = computed(() => this.groups().data.map((row) => this.toRowVm(row)));
  protected readonly groupLabel = computed(() => ORG_TRAINING_GROUP_BY_OPTIONS.find((option) => option.value === this.groupBy())?.label ?? 'Course');
  protected readonly completedLabel = computed(() => (this.tab() === 'certifications' ? 'Certified' : 'Completed'));
  protected readonly completedTileLabel = computed(() => (this.tab() === 'certifications' ? 'Certifications' : 'Trainings completed'));
  protected readonly totalsNote = computed(
    () =>
      `Totals cover every row of this tab, not only this page or the search. ${this.completedLabel()} equals the “${this.completedTileLabel()}” tile for the same range and filters; People is distinct people, not the sum of the rows.`
  );
  protected readonly scopeNote = computed(() => ORG_TRAINING_GROUPS_SCOPE_NOTES[this.tab()]);
  protected readonly totalCompletedAriaLabel = computed(
    () => `${this.completedLabel()} total ${this.groups().totals.completed.toLocaleString('en-US')}, equals the ${this.completedTileLabel()} tile`
  );
  protected readonly rppOptions = computed<number[] | undefined>(() => (this.groups().total > this.pageSizeOptions[0] ? this.pageSizeOptions : undefined));
  protected readonly emptyTitle = computed(() => {
    const noun = this.tab() === 'certifications' ? 'certifications' : 'trainings';
    return this.searchQuery() ? `No ${noun} match your search` : `No ${noun} for these filters`;
  });

  protected readonly sortAriaMap = computed<Record<OrgTrainingGroupSortField, string>>(() => ({
    label: this.ariaSort('label'),
    people: this.ariaSort('people'),
    coursesTaken: this.ariaSort('coursesTaken'),
    completed: this.ariaSort('completed'),
    inProgress: this.ariaSort('inProgress'),
  }));
  protected readonly sortIcons = computed<Record<OrgTrainingGroupSortField, string>>(() => ({
    label: this.sortIcon('label'),
    people: this.sortIcon('people'),
    coursesTaken: this.sortIcon('coursesTaken'),
    completed: this.sortIcon('completed'),
    inProgress: this.sortIcon('inProgress'),
  }));

  public constructor() {
    // A different organization's numbers must not be reachable through a drawer opened on the previous one.
    toObservable(this.orgUid)
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => {
        this.drawerVisible.set(false);
        this.drawerParams.set(null);
        this.drawerLabel.set('');
        this.drawerCount.set(0);
      });
  }

  protected onPageChange(event: { first: number; rows: number }): void {
    this.pageSize.set(event.rows);
    this.paging.set({ viewKey: this.viewKey(), offset: event.first });
  }

  protected onHeaderClick(field: OrgTrainingGroupSortField): void {
    if (field === this.sortField()) {
      this.sortOrder.update((order) => (order === 'ASC' ? 'DESC' : 'ASC'));
    } else {
      this.sortField.set(field);
      this.sortOrder.set(DESCENDING_DEFAULT_ORG_TRAINING_GROUPS_SORT_FIELDS.has(field) ? 'DESC' : 'ASC');
    }
    this.paging.set({ viewKey: this.viewKey(), offset: 0 });
  }

  protected retry(): void {
    this.retryTrigger.update((value) => value + 1);
  }

  protected openDrawer(row: OrgTrainingGroupRowVm, status: OrgTrainingGroupStatus): void {
    this.drawerParams.set({ groupBy: this.groupBy(), groupValue: row.key, tab: this.tab(), status });
    this.drawerLabel.set(row.label);
    this.drawerCount.set(status === 'completed' ? row.completed : row.inProgress);
    this.drawerVisible.set(true);
  }

  /** Foundation and level under a course name, the foundation under a project; other groupings have no such attributes. */
  private rowMeta(row: OrgTrainingGroupRow): string {
    switch (this.groupBy()) {
      case 'course':
        return [row.foundation, row.level].filter((part) => !!part).join(' · ');
      case 'project':
        return row.foundation ?? '';
      default:
        return '';
    }
  }

  private toRowVm(row: OrgTrainingGroupRow): OrgTrainingGroupRowVm {
    const completedStatus = this.completedLabel().toLowerCase();
    return {
      ...row,
      meta: this.rowMeta(row),
      completedAriaLabel: `${row.completed.toLocaleString('en-US')} ${completedStatus}, ${row.label}. Show people`,
      inProgressAriaLabel: `${row.inProgress.toLocaleString('en-US')} in progress, ${row.label}. Show people`,
    };
  }

  private ariaSort(field: OrgTrainingGroupSortField): string {
    if (this.sortField() !== field) return 'none';
    return this.sortOrder() === 'ASC' ? 'ascending' : 'descending';
  }

  private sortIcon(field: OrgTrainingGroupSortField): string {
    if (this.sortField() !== field) return 'fa-light fa-sort text-gray-300';
    return this.sortOrder() === 'ASC' ? 'fa-solid fa-caret-up text-blue-500' : 'fa-solid fa-caret-down text-blue-500';
  }

  private initGroups(): Signal<OrgTrainingGroupsResponse> {
    // One request per distinct view/sort/page; switchMap cancels the in-flight one.
    const request$ = toObservable(
      computed(() => ({
        orgUid: this.orgUid(),
        query: this.query(),
        params: {
          groupBy: this.groupBy(),
          tab: this.tab(),
          searchQuery: this.searchQuery() || undefined,
          sortField: this.sortField(),
          sortOrder: this.sortOrder(),
          pageSize: this.pageSize(),
          offset: this.offset(),
        },
        retry: this.retryTrigger(),
      }))
    );

    return toSignal(
      request$.pipe(
        switchMap(({ orgUid, query, params }) => {
          if (!orgUid) {
            this.loading.set(false);
            this.error.set(false);
            return of(EMPTY_ORG_TRAINING_GROUPS_RESPONSE);
          }
          this.loading.set(true);
          this.error.set(false);
          return this.trainingService.getGroups(orgUid, query, params).pipe(
            // A real failure is stated as such, never as an empty table.
            catchError((error: unknown) => {
              console.error('Failed to load training groups', error);
              this.error.set(true);
              return of(EMPTY_ORG_TRAINING_GROUPS_RESPONSE);
            }),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: EMPTY_ORG_TRAINING_GROUPS_RESPONSE }
    );
  }
}
