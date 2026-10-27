// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  EMPTY_ORG_CONTRIBUTORS_RESPONSE,
  ORG_CODE_CONTRIBUTIONS_DEFINITION,
  ORG_CODE_METRIC_LABEL,
  ORG_CODE_METRIC_OPTIONS,
  ORG_COMMIT_SCOPE_OPTIONS,
  ORG_COMMITS_DEFINITION,
  ORG_CONTRIBUTORS_INITIAL_LIMIT,
  ORG_PEOPLE_DEFAULT_TIME_RANGE,
  ORG_PEOPLE_TIME_RANGE_OPTIONS,
  ORG_PROJECT_SCOPE_OPTIONS,
} from '@lfx-one/shared/constants';
import type {
  OrgCodeMetric,
  OrgCodeMetricOption,
  OrgCommitFilters,
  OrgCommitScope,
  OrgCommitScopeOption,
  OrgContributorExpandedRowVm,
  OrgContributorProjectRow,
  OrgContributorRow,
  OrgContributorRowVm,
  OrgContributorsResponse,
  OrgContributorSortColumn,
  OrgContributorSortDirection,
  OrgDropdownOption,
  OrgPeopleTimeRange,
  OrgPeopleTimeRangeOption,
  OrgProjectScope,
  OrgProjectScopeOption,
} from '@lfx-one/shared/interfaces';
import { TooltipModule } from 'primeng/tooltip';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, map, merge, of, skip, Subject, switchMap, tap } from 'rxjs';

import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { AccountContextService } from '@services/account-context.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { avatarColorClass, orgCommitFiltersUrlParams, readOrgCommitFilters, sameOrgCommitFilters } from '@lfx-one/shared/utils';
import { formatLongDateUtc } from '@shared/utils/date-format.util';
import { computePersonInitials } from '@shared/utils/person-avatar.util';

import { ContributorsService } from '../../services/contributors.service';

/** Contributors tab body — search + foundation + project + time-range + commit-filter bar, four stat cards (Maintainers / Contributors / Projects / Foundations), sortable table with chevron-toggled per-project Projects Involved sub-table. */
@Component({
  selector: 'lfx-org-people-contributors',
  imports: [DecimalPipe, ReactiveFormsModule, EmptyStateComponent, InputTextComponent, SelectComponent, SkeletonModule, TooltipModule],
  templateUrl: './contributors.component.html',
})
export class ContributorsComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly dataService = inject(ContributorsService);
  private readonly drawer = inject(PersonDetailDrawerService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly initialLimit = ORG_CONTRIBUTORS_INITIAL_LIMIT;
  protected readonly timeRangeOptions: OrgPeopleTimeRangeOption[] = [...ORG_PEOPLE_TIME_RANGE_OPTIONS];
  protected readonly projectScopeOptions: OrgProjectScopeOption[] = [...ORG_PROJECT_SCOPE_OPTIONS];
  protected readonly commitScopeOptions: OrgCommitScopeOption[] = [...ORG_COMMIT_SCOPE_OPTIONS];
  protected readonly metricOptions: OrgCodeMetricOption[] = [...ORG_CODE_METRIC_OPTIONS];
  protected readonly tableSkeletonRows: readonly number[] = [0, 1, 2, 3, 4, 5];
  protected readonly statSkeletonLabels: readonly string[] = ['Maintainers', 'Contributors', 'Projects', 'Foundations'];

  // The commit filters follow `?projectScope=` / `?commitScope=` / `?metric=` (shared with All Employees) and are written back on change.
  private readonly initialFilters = readOrgCommitFilters((name) => this.route.snapshot.queryParamMap.get(name));

  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
    foundation: new FormControl<string>('', { nonNullable: true }),
    project: new FormControl<string>('', { nonNullable: true }),
    timeRange: new FormControl<OrgPeopleTimeRange>(ORG_PEOPLE_DEFAULT_TIME_RANGE, { nonNullable: true }),
    projectScope: new FormControl<OrgProjectScope>(this.initialFilters.projectScope, { nonNullable: true }),
    commitScope: new FormControl<OrgCommitScope>(this.initialFilters.commitScope, { nonNullable: true }),
    metric: new FormControl<OrgCodeMetric>(this.initialFilters.metric, { nonNullable: true }),
  });

  // Default sort per Item 4 R4.4 lock: Role asc then Commits desc — encoded as the active column 'role' with secondary tiebreak in initSortedRows.
  protected readonly sortColumn = signal<OrgContributorSortColumn>('role');
  protected readonly sortDirection = signal<OrgContributorSortDirection>(1);
  protected readonly limit = signal<number>(ORG_CONTRIBUTORS_INITIAL_LIMIT);
  protected readonly expansion = signal<Record<string, boolean>>({});
  protected readonly retryTrigger = signal<number>(0);
  private readonly loadingState = signal<boolean>(true);
  private readonly fetchErrorState = signal<boolean>(false);

  protected readonly isLoading = this.loadingState.asReadonly();
  protected readonly fetchError = this.fetchErrorState.asReadonly();

  // Mirror reactive form into a signal; debounce ~150ms so per-keystroke filtering doesn't thrash through the computed graph.
  // A selection cleared for a new response skips the debounce, so the response never renders behind it.
  private readonly selectionsPruned$ = new Subject<void>();
  private readonly filterValues = toSignal(
    merge(this.filterForm.valueChanges.pipe(debounceTime(150)), this.selectionsPruned$.pipe(map(() => this.filterForm.getRawValue()))),
    { initialValue: this.filterForm.getRawValue() }
  );

  private readonly orgUid$ = toObservable(this.accountContext.selectedAccount).pipe(
    map((account) => account.uid),
    distinctUntilChanged()
  );

  // Time range observable feeds the BFF refetch (A1 architecture: one slice per timeRange). distinctUntilChanged guards against duplicate emits when the form is reset to its current value.
  private readonly timeRange$ = toObservable(this.timeRangeControl()).pipe(distinctUntilChanged());

  // The commit filters also refetch (they change the read and the most-active project), undebounced like the time range.
  protected readonly commitFilters: Signal<OrgCommitFilters> = this.initCommitFilters();
  private readonly commitFilters$ = toObservable(this.commitFilters).pipe(distinctUntilChanged(sameOrgCommitFilters));
  protected readonly countLabel = computed(() => ORG_CODE_METRIC_LABEL[this.commitFilters().metric]);
  protected readonly countTooltip = computed(() => (this.commitFilters().metric === 'code' ? ORG_CODE_CONTRIBUTIONS_DEFINITION : ORG_COMMITS_DEFINITION));

  protected readonly response: Signal<OrgContributorsResponse> = this.initResponse();

  protected readonly foundationOptions: Signal<OrgDropdownOption[]> = computed(() => this.initFoundationOptions());
  protected readonly projectOptions: Signal<OrgDropdownOption[]> = computed(() => this.initProjectOptions());

  // Person rows are the canonical source. Stats anchor on the BFF response (Item 3 lock — they don't react to the filter trio).
  protected readonly filteredContributors: Signal<OrgContributorRow[]> = computed(() => this.initFilteredContributors());

  protected readonly viewRows: Signal<OrgContributorRowVm[]> = computed(() => this.initViewRows());

  protected readonly sortedRows: Signal<OrgContributorRowVm[]> = computed(() => this.initSortedRows());

  protected readonly totalFiltered = computed(() => this.sortedRows().length);
  protected readonly visibleRows = computed(() => this.sortedRows().slice(0, this.limit()));
  protected readonly canShowMore = computed(() => this.limit() < this.totalFiltered());

  protected readonly footerCountLabel: Signal<string> = computed(() => this.initFooterCountLabel());

  protected readonly isFiltering: Signal<boolean> = computed(() => this.initIsFiltering());

  protected readonly ariaSortMap: Signal<Record<OrgContributorSortColumn, 'ascending' | 'descending' | 'none'>> = computed(() => this.initAriaSortMap());

  protected readonly sortIconMap: Signal<Record<OrgContributorSortColumn, string>> = computed(() => this.initSortIconMap());

  // Pre-decorated expansion rows per personKey. Source of truth = the filter-aware projects, so the sub-table follows the foundation/project filter without re-deriving per row.
  protected readonly expandedRowsMap: Signal<Record<string, OrgContributorExpandedRowVm[]>> = computed(() => this.initExpandedRowsMap());

  public constructor() {
    this.orgUid$.pipe(skip(1), takeUntilDestroyed()).subscribe(() => this.resetAllState());

    combineLatest([toObservable(this.sortColumn), toObservable(this.sortDirection)])
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => this.limit.set(ORG_CONTRIBUTORS_INITIAL_LIMIT));

    this.filterForm.valueChanges.pipe(debounceTime(150), takeUntilDestroyed()).subscribe(() => {
      this.limit.set(ORG_CONTRIBUTORS_INITIAL_LIMIT);
      this.expansion.set({});
    });

    // The commit scope does not apply to code contributions, so its picker is disabled under that metric.
    this.commitFilters$.pipe(takeUntilDestroyed()).subscribe(({ metric }) => {
      const commitScope = this.filterForm.controls.commitScope;
      if (metric === 'code') commitScope.disable({ emitEvent: false });
      else commitScope.enable({ emitEvent: false });
    });

    // Written back only when they differ from the URL, so following a URL change does not navigate again.
    this.commitFilters$.pipe(takeUntilDestroyed()).subscribe((filters) => {
      if (
        sameOrgCommitFilters(
          filters,
          readOrgCommitFilters((name) => this.route.snapshot.queryParamMap.get(name))
        )
      )
        return;
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: orgCommitFiltersUrlParams(filters),
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });

    // A query-only navigation (back/forward, the All Employees tab writing the shared params) keeps this component.
    this.route.queryParamMap
      .pipe(
        map((params) => readOrgCommitFilters((name) => params.get(name))),
        distinctUntilChanged(sameOrgCommitFilters),
        takeUntilDestroyed()
      )
      .subscribe((filters) => {
        if (!sameOrgCommitFilters(filters, this.commitFilters())) this.filterForm.patchValue(filters);
      });
  }

  protected onSort(column: OrgContributorSortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.update((d) => (d === 1 ? -1 : 1));
      return;
    }
    this.sortColumn.set(column);
    // Numeric/date columns desc on first click; string columns asc.
    this.sortDirection.set(column === 'commits' || column === 'lastActive' ? -1 : 1);
  }

  protected toggleRow(personKey: string): void {
    this.expansion.update((state) => {
      const next = { ...state };
      if (next[personKey]) delete next[personKey];
      else next[personKey] = true;
      return next;
    });
  }

  protected onRowKeydown(event: KeyboardEvent, personKey: string): void {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.toggleRow(personKey);
  }

  protected onPersonClick(row: OrgContributorRowVm, event: Event): void {
    event.stopPropagation();
    this.drawer.open({
      personKey: row.personKey,
      name: row.displayName,
      title: row.title,
      initials: row.initials,
      avatarColorClass: row.avatarColorClass,
      defaultTab: 'code',
    });
  }

  protected showAll(): void {
    this.limit.set(this.totalFiltered());
  }

  protected retry(): void {
    this.retryTrigger.update((v) => v + 1);
  }

  private initFoundationOptions(): OrgDropdownOption[] {
    return [{ label: 'All Foundations', value: '' }, ...this.response().foundationOptions.map((f) => ({ label: f.foundationName, value: f.foundationId }))];
  }

  private initProjectOptions(): OrgDropdownOption[] {
    return [{ label: 'All Projects', value: '' }, ...this.response().projectOptions.map((p) => ({ label: p.projectName, value: p.projectId }))];
  }

  private initFilteredContributors(): OrgContributorRow[] {
    const values = this.filterValues();
    const q = (values.search ?? '').trim().toLowerCase();
    const foundationId = values.foundation ?? '';
    const projectId = values.project ?? '';

    // Pre-build a person→project-id set when a foundation or project filter is active so we can narrow without re-walking the full projects[] per row.
    let personKeysScoped: Set<string> | null = null;
    if (foundationId || projectId) {
      personKeysScoped = new Set<string>();
      for (const p of this.response().projects) {
        if (foundationId && p.foundationId !== foundationId) continue;
        if (projectId && p.projectId !== projectId) continue;
        personKeysScoped.add(p.personKey);
      }
    }

    return this.response().contributors.filter((row) => {
      if (personKeysScoped && !personKeysScoped.has(row.personKey)) return false;
      if (q) {
        const inName = row.displayName.toLowerCase().includes(q);
        const inTitle = (row.title ?? '').toLowerCase().includes(q);
        if (!inName && !inTitle) return false;
      }
      return true;
    });
  }

  private initViewRows(): OrgContributorRowVm[] {
    const metric = this.commitFilters().metric;
    return this.filteredContributors().map((c) => ({
      personKey: c.personKey,
      displayName: c.displayName,
      title: c.title,
      initials: computePersonInitials(c.displayName),
      avatarColorClass: avatarColorClass(c.personKey),
      role: c.role,
      count: metric === 'code' ? c.codeActivities : c.commits,
      lastActiveTs: c.lastActiveTs,
      lastActiveLabel: c.lastActiveTs ? formatLongDateUtc(c.lastActiveTs) : '—',
      projectsCount: c.projectsCount,
      mostActiveProjectName: c.mostActiveProjectName,
      mostActiveProjectFoundationName: c.mostActiveProjectFoundationName,
    }));
  }

  private initSortedRows(): OrgContributorRowVm[] {
    const rows = this.viewRows();
    const col = this.sortColumn();
    const dir = this.sortDirection();
    const copy = [...rows];
    copy.sort((a, b) => {
      switch (col) {
        case 'name':
          return a.displayName.localeCompare(b.displayName) * dir;
        case 'role': {
          // Maintainer < Contributor in alpha order. ASC default puts Maintainers first; tiebreak count desc (Item 4 R4.4 lock).
          const va = a.role === 'Maintainer' ? 0 : 1;
          const vb = b.role === 'Maintainer' ? 0 : 1;
          if (va !== vb) return (va - vb) * dir;
          if (a.count !== b.count) return b.count - a.count;
          return a.displayName.localeCompare(b.displayName);
        }
        case 'commits': {
          if (a.count !== b.count) return (a.count - b.count) * dir;
          return a.displayName.localeCompare(b.displayName);
        }
        case 'lastActive': {
          const ta = a.lastActiveTs ?? '';
          const tb = b.lastActiveTs ?? '';
          if (ta !== tb) return ta > tb ? dir : -dir;
          return a.displayName.localeCompare(b.displayName);
        }
        case 'mostActiveProject': {
          const pa = a.mostActiveProjectName ?? '';
          const pb = b.mostActiveProjectName ?? '';
          if (pa !== pb) return pa.localeCompare(pb) * dir;
          return a.displayName.localeCompare(b.displayName);
        }
      }
    });
    return copy;
  }

  private initFooterCountLabel(): string {
    const visible = Math.min(this.limit(), this.totalFiltered());
    return `Showing ${visible.toLocaleString()} of ${this.totalFiltered().toLocaleString()}`;
  }

  private initIsFiltering(): boolean {
    const values = this.filterValues();
    const hasSearch = (values.search ?? '').trim().length > 0;
    const hasFoundation = !!(values.foundation ?? '');
    const hasProject = !!(values.project ?? '');
    const timeRange: OrgPeopleTimeRange = values.timeRange ?? ORG_PEOPLE_DEFAULT_TIME_RANGE;
    const hasTimeFilter = timeRange !== ORG_PEOPLE_DEFAULT_TIME_RANGE;
    return hasSearch || hasFoundation || hasProject || hasTimeFilter;
  }

  private initAriaSortMap(): Record<OrgContributorSortColumn, 'ascending' | 'descending' | 'none'> {
    const active = this.sortColumn();
    const direction: 'ascending' | 'descending' = this.sortDirection() === 1 ? 'ascending' : 'descending';
    return {
      name: active === 'name' ? direction : 'none',
      role: active === 'role' ? direction : 'none',
      commits: active === 'commits' ? direction : 'none',
      lastActive: active === 'lastActive' ? direction : 'none',
      mostActiveProject: active === 'mostActiveProject' ? direction : 'none',
    };
  }

  private initSortIconMap(): Record<OrgContributorSortColumn, string> {
    const active = this.sortColumn();
    const activeIcon = this.sortDirection() === 1 ? 'fa-light fa-sort-up' : 'fa-light fa-sort-down';
    const iconFor = (col: OrgContributorSortColumn): string => (active === col ? activeIcon : 'fa-light fa-sort');
    return {
      name: iconFor('name'),
      role: iconFor('role'),
      commits: iconFor('commits'),
      lastActive: iconFor('lastActive'),
      mostActiveProject: iconFor('mostActiveProject'),
    };
  }

  private initExpandedRowsMap(): Record<string, OrgContributorExpandedRowVm[]> {
    const values = this.filterValues();
    const foundationId = values.foundation ?? '';
    const projectId = values.project ?? '';
    const metric = this.commitFilters().metric;

    const grouped = new Map<string, OrgContributorProjectRow[]>();
    for (const p of this.response().projects) {
      if (foundationId && p.foundationId !== foundationId) continue;
      if (projectId && p.projectId !== projectId) continue;
      const list = grouped.get(p.personKey) ?? [];
      list.push(p);
      grouped.set(p.personKey, list);
    }

    const out: Record<string, OrgContributorExpandedRowVm[]> = {};
    for (const [personKey, projects] of grouped) {
      out[personKey] = collapseExpandedRows(projects, metric);
    }
    return out;
  }

  private initResponse(): Signal<OrgContributorsResponse> {
    return toSignal(
      combineLatest([this.orgUid$, this.timeRange$, this.commitFilters$, toObservable(this.retryTrigger)]).pipe(
        tap(() => {
          this.loadingState.set(true);
          this.fetchErrorState.set(false);
        }),
        switchMap(([orgUid, timeRange, filters]) => {
          if (!orgUid) {
            this.loadingState.set(false);
            return of({ ...EMPTY_ORG_CONTRIBUTORS_RESPONSE, timeRange });
          }
          return this.dataService.getContributors(orgUid, timeRange, filters).pipe(
            tap((res) => {
              this.dropSelectionsAbsentFrom(res);
              this.loadingState.set(false);
            }),
            catchError(() => {
              this.fetchErrorState.set(true);
              this.loadingState.set(false);
              return of({ ...EMPTY_ORG_CONTRIBUTORS_RESPONSE, timeRange });
            })
          );
        })
      ),
      { initialValue: EMPTY_ORG_CONTRIBUTORS_RESPONSE }
    );
  }

  /** Stable timeRange Signal — bypass the filter-trio debounce so BFF refetch fires per distinct value. */
  private timeRangeControl(): Signal<OrgPeopleTimeRange> {
    return toSignal(this.filterForm.controls.timeRange.valueChanges, {
      initialValue: this.filterForm.controls.timeRange.value,
    });
  }

  /** The three commit filters off the form, raw so the disabled commit-scope control still reports its value. */
  private initCommitFilters(): Signal<OrgCommitFilters> {
    const read = (): OrgCommitFilters => {
      const { projectScope, commitScope, metric } = this.filterForm.getRawValue();
      return { projectScope, commitScope, metric };
    };
    return toSignal(this.filterForm.valueChanges.pipe(map(read)), { initialValue: read() });
  }

  /**
   * A new range or project scope can drop the picked foundation or project from the response, and filtering on it would
   * hide every row. The selection is cleared before the response renders.
   */
  private dropSelectionsAbsentFrom(res: OrgContributorsResponse): void {
    const { foundation, project } = this.filterForm.getRawValue();
    const patch: { foundation?: string; project?: string } = {};
    if (foundation && !res.foundationOptions.some((option) => option.foundationId === foundation)) patch.foundation = '';
    if (project && !res.projectOptions.some((option) => option.projectId === project)) patch.project = '';
    if (patch.foundation === undefined && patch.project === undefined) return;
    this.filterForm.patchValue(patch);
    this.selectionsPruned$.next();
  }

  private resetAllState(): void {
    // The commit filters are page-level URL state, not per-org, so an org switch keeps them.
    this.filterForm.patchValue({ search: '', foundation: '', project: '', timeRange: ORG_PEOPLE_DEFAULT_TIME_RANGE });
    this.sortColumn.set('role');
    this.sortDirection.set(1);
    this.limit.set(ORG_CONTRIBUTORS_INITIAL_LIMIT);
    this.expansion.set({});
  }
}

/** Collapse per-(person, project) rows; pre-sorted by the metric's count DESC → last_active DESC → name (Item 5 R5 — sub-table non-interactive). */
function collapseExpandedRows(rows: OrgContributorProjectRow[], metric: OrgCodeMetric): OrgContributorExpandedRowVm[] {
  const out: OrgContributorExpandedRowVm[] = rows.map((r) => ({
    projectId: r.projectId,
    projectName: r.projectName,
    foundationName: r.foundationName,
    role: r.role,
    count: metric === 'code' ? r.codeActivities : r.commits,
    lastActiveTs: r.lastActiveTs,
    lastActiveLabel: r.lastActiveTs ? formatLongDateUtc(r.lastActiveTs) : '—',
  }));

  return out.sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    const ta = a.lastActiveTs ?? '';
    const tb = b.lastActiveTs ?? '';
    if (ta !== tb) return ta > tb ? -1 : 1;
    return a.projectName.localeCompare(b.projectName);
  });
}
