// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  DEFAULT_ORG_COMMIT_FILTERS,
  DEFAULT_ORG_EMPLOYMENT,
  DEFAULT_ORG_SCOPE,
  DEFAULT_ORG_TEAM_MEMBERS,
  EMPTY_ORG_CONTRIBUTORS_RESPONSE,
  ORG_ALL_FOUNDATIONS_LABEL,
  ORG_ANY_PROJECT_LABEL,
  ORG_CODE_MEASURE_DEFINITION,
  ORG_CODE_METRIC_LABEL,
  ORG_CODE_MEASURE_OPTIONS,
  ORG_CONTRIBUTORS_INITIAL_LIMIT,
  ORG_EMPLOYMENT_LABEL,
  ORG_EMPLOYMENT_OPTIONS,
  ORG_LENS_DEFAULT_TIME_RANGE,
  ORG_LENS_TIME_RANGE_OPTIONS,
  ORG_LENS_TIME_RANGE_QUERY_PARAM,
  ORG_MAINTAINER_ROLES_DEFINITION,
  ORG_MAINTAINER_ROLES_LABEL,
  ORG_MAINTAINER_ROLES_UNAVAILABLE_HINT,
  ORG_PROJECT_SCOPE_LABEL,
  ORG_PROJECT_SCOPE_OPTIONS,
  ORG_TEAM_MEMBERS_EMPTY_HINT,
  ORG_TEAM_MEMBERS_LABEL,
  ORG_TEAM_MEMBERS_OPTIONS,
  ORG_SCOPE_QUERY_PARAM,
  ORG_TEAM_MEMBERS_QUERY_PARAM,
  ORG_TEAM_MEMBERS_TOOLTIP,
  ORG_TEAM_MEMBERS_UNAVAILABLE_NOTE,
} from '@lfx-one/shared/constants';
import type {
  OrgCodeMeasure,
  OrgCodeMeasureOption,
  OrgCodeMetric,
  OrgCommitFilters,
  OrgContributorExpandedRowVm,
  OrgContributorProjectRow,
  OrgContributorRow,
  OrgContributorRowVm,
  OrgContributorsResponse,
  OrgContributorSortColumn,
  OrgContributorSortDirection,
  OrgDropdownOption,
  OrgEmploymentFilter,
  OrgEmploymentOption,
  OrgLensTimeRange,
  OrgLensTimeRangeOption,
  OrgProjectScope,
  OrgProjectScopeOption,
  OrgScopeFilter,
  OrgTeamMembersFilter,
  OrgTeamMembersOption,
} from '@lfx-one/shared/interfaces';
import { TooltipModule } from 'primeng/tooltip';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, map, merge, of, skip, Subject, switchMap, tap } from 'rxjs';

import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { OrgScopeSelectComponent } from '@components/org-scope-select/org-scope-select.component';
import { SelectComponent } from '@components/select/select.component';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensOrgScopeService } from '@services/org-lens-org-scope.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import {
  avatarColorClass,
  orgCodeFilterValues,
  orgCommitFiltersFor,
  orgCommitFiltersUrlMatches,
  orgCommitFiltersUrlParams,
  orgLensTimeRangeUrlParam,
  parseOrgEmploymentFilter,
  readOrgCommitFilters,
  sameOrgCommitFilters,
} from '@lfx-one/shared/utils';
import { formatLongDateUtc } from '@shared/utils/date-format.util';
import { readOrgLensTimeRange, syncOrgLensTimeRangeWithUrl } from '@shared/utils/org-lens-time-range-url.util';
import { readOrgScope, syncOrgScopeWithUrl } from '@shared/utils/org-scope-url.util';
import { readOrgTeamMembers, syncOrgTeamMembersWithUrl } from '@shared/utils/org-team-members-url.util';
import { computePersonInitials } from '@shared/utils/person-avatar.util';

import { describeContributionsWindow, describeContributorsTooltip } from '../../../org-contributions/org-contributions.util';

import { ContributorsService } from '../../services/contributors.service';

/** Contributors tab body — search + foundation + project + time-range + commit-filter bar, four stat cards (Maintainer roles / Contributors / Projects / Foundations), sortable table with chevron-toggled per-project Projects Involved sub-table. */
@Component({
  selector: 'lfx-org-people-contributors',
  imports: [DecimalPipe, ReactiveFormsModule, EmptyStateComponent, InputTextComponent, OrgScopeSelectComponent, SelectComponent, SkeletonModule, TooltipModule],
  templateUrl: './contributors.component.html',
})
export class ContributorsComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly orgScopeService = inject(OrgLensOrgScopeService);
  private readonly dataService = inject(ContributorsService);
  private readonly drawer = inject(PersonDetailDrawerService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly initialLimit = ORG_CONTRIBUTORS_INITIAL_LIMIT;
  protected readonly timeRangeOptions: OrgLensTimeRangeOption[] = [...ORG_LENS_TIME_RANGE_OPTIONS];
  protected readonly projectScopeOptions: OrgProjectScopeOption[] = [...ORG_PROJECT_SCOPE_OPTIONS];
  protected readonly projectScopeLabel = ORG_PROJECT_SCOPE_LABEL;
  protected readonly metricOptions: OrgCodeMeasureOption[] = [...ORG_CODE_MEASURE_OPTIONS];
  protected readonly employmentOptions: OrgEmploymentOption[] = [...ORG_EMPLOYMENT_OPTIONS];
  protected readonly employmentLabel = ORG_EMPLOYMENT_LABEL;
  protected readonly teamMembersOptions: OrgTeamMembersOption[] = [...ORG_TEAM_MEMBERS_OPTIONS];
  protected readonly teamMembersLabel = ORG_TEAM_MEMBERS_LABEL;
  protected readonly teamMembersTooltip = ORG_TEAM_MEMBERS_TOOLTIP;
  protected readonly teamMembersUnavailableNote = ORG_TEAM_MEMBERS_UNAVAILABLE_NOTE;
  protected readonly teamMembersEmptyHint = ORG_TEAM_MEMBERS_EMPTY_HINT;
  protected readonly tableSkeletonRows: readonly number[] = [0, 1, 2, 3, 4, 5];
  protected readonly maintainerRolesLabel = ORG_MAINTAINER_ROLES_LABEL;
  protected readonly maintainerRolesTooltip = ORG_MAINTAINER_ROLES_DEFINITION;
  protected readonly maintainerRolesUnavailableHint = ORG_MAINTAINER_ROLES_UNAVAILABLE_HINT;
  protected readonly statSkeletonLabels: readonly string[] = [ORG_MAINTAINER_ROLES_LABEL, 'Contributors', 'Projects', 'Foundations'];

  // The commit filters follow `?projectScope=` / `?metric=` (shared with All Employees), the range follows `?range=`
  // (shared with every People tab and Code Contributions), the employment filter follows `?employment=` (lfx-self-serve#4627)
  // and the team members filter `?teamMembers=` (lfx-self-serve#4685); all are written back on change.
  private readonly initialFilters = orgCodeFilterValues(readOrgCommitFilters((name) => this.route.snapshot.queryParamMap.get(name)));

  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
    foundation: new FormControl<string>('', { nonNullable: true }),
    project: new FormControl<string>('', { nonNullable: true }),
    timeRange: new FormControl<OrgLensTimeRange>(readOrgLensTimeRange(this.route), { nonNullable: true }),
    projectScope: new FormControl<OrgProjectScope>(this.initialFilters.projectScope, { nonNullable: true }),
    metric: new FormControl<OrgCodeMeasure>(this.initialFilters.metric, { nonNullable: true }),
    employment: new FormControl<OrgEmploymentFilter>(readEmployment(this.route.snapshot.queryParamMap.get('employment')), { nonNullable: true }),
    teamMembers: new FormControl<OrgTeamMembersFilter>(readOrgTeamMembers(this.route), { nonNullable: true }),
    orgScope: new FormControl<OrgScopeFilter>(readOrgScope(this.route), { nonNullable: true }),
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

  // The range, undebounced: it drives the BFF read (A1 architecture: one slice per timeRange), the filtering state and the tooltip.
  private readonly timeRange: Signal<OrgLensTimeRange> = this.timeRangeControl();
  // The active range's label, for the empty state that names the window ("past 2 years").
  protected readonly timeRangeLabel: Signal<string> = computed(
    () => this.timeRangeOptions.find((option) => option.value === this.timeRange())?.label.toLowerCase() ?? ''
  );

  // The commit filters also refetch (they change the read and the most-active project), undebounced like the time range.
  protected readonly commitFilters: Signal<OrgCommitFilters> = this.initCommitFilters();
  private readonly commitFilters$ = toObservable(this.commitFilters).pipe(distinctUntilChanged(sameOrgCommitFilters));
  // The employment filter refetches too (the BFF keeps current or former employees), undebounced like the range.
  private readonly employment: Signal<OrgEmploymentFilter> = toSignal(this.filterForm.controls.employment.valueChanges, {
    initialValue: this.filterForm.controls.employment.value,
  });
  // The team members filter refetches too (the BFF drops CDP team members), undebounced like the range.
  private readonly teamMembers: Signal<OrgTeamMembersFilter> = toSignal(this.filterForm.controls.teamMembers.valueChanges, {
    initialValue: this.filterForm.controls.teamMembers.value,
  });
  // The organization scope refetches too (the BFF reads the Insights organization's code or every related organization's).
  private readonly orgScope: Signal<OrgScopeFilter> = toSignal(this.filterForm.controls.orgScope.valueChanges, {
    initialValue: this.filterForm.controls.orgScope.value,
  });
  // Range, commit filters, employment, team members and organization scope as one value, so a change to several (Clear filters, a URL step) starts a single read.
  private readonly contributorsQuery = computed(() => ({
    range: this.timeRange(),
    filters: this.commitFilters(),
    employment: this.employment(),
    teamMembers: this.teamMembers(),
    orgScope: this.orgScope(),
  }));
  private readonly contributorsQuery$ = toObservable(this.contributorsQuery).pipe(
    distinctUntilChanged(
      (a, b) =>
        a.range === b.range &&
        sameOrgCommitFilters(a.filters, b.filters) &&
        a.employment === b.employment &&
        a.teamMembers === b.teamMembers &&
        a.orgScope === b.orgScope
    )
  );
  protected readonly countLabel = computed(() => ORG_CODE_METRIC_LABEL[this.commitFilters().metric]);
  protected readonly countTooltip = computed(() => ORG_CODE_MEASURE_DEFINITION[orgCodeFilterValues(this.commitFilters()).metric]);
  protected readonly contributorsTooltip = computed(() =>
    describeContributorsTooltip(
      this.commitFilters().projectScope,
      this.accountContext.selectedAccount().accountName,
      describeContributionsWindow(this.timeRange()),
      this.employment(),
      // The scope served: an account without an Insights organization is served every related one.
      this.orgScopeService.current()?.hasInsightsOrg === false ? 'all' : this.orgScope()
    )
  );

  protected readonly response: Signal<OrgContributorsResponse> = this.initResponse();
  /** Roles table missing: every row's role reads 'Contributor', which is "unknown" here, so no role badge is shown. */
  protected readonly maintainerRolesUnavailable = computed(() => this.response().stats.maintainerRoles === null);

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
  // The filter bar's "Clear filters" also covers the code-count option, which changes the count but not who is listed.
  protected readonly canClearFilters: Signal<boolean> = computed(
    () => this.isFiltering() || !sameOrgCommitFilters(this.commitFilters(), DEFAULT_ORG_COMMIT_FILTERS)
  );

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

    // Written back only when the URL does not already spell them, so following a URL change does not navigate again;
    // a default, unknown or legacy (`commitScope=merged`) value in the URL is rewritten.
    this.commitFilters$.pipe(takeUntilDestroyed()).subscribe((filters) => {
      if (orgCommitFiltersUrlMatches(filters, (name) => this.route.snapshot.queryParamMap.get(name))) return;
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
        if (!sameOrgCommitFilters(filters, this.commitFilters())) this.filterForm.patchValue(orgCodeFilterValues(filters));
      });

    syncOrgLensTimeRangeWithUrl(this.filterForm.controls.timeRange, this.route, this.router);
    syncOrgTeamMembersWithUrl(this.filterForm.controls.teamMembers, this.route, this.router);
    syncOrgScopeWithUrl(this.filterForm.controls.orgScope, this.route, this.router);

    // A pick is written to `?employment=` (dropped at the default) unless the URL already selects it, so following a URL
    // change does not navigate again; a query-only navigation sets the picker.
    this.filterForm.controls.employment.valueChanges.pipe(distinctUntilChanged(), takeUntilDestroyed()).subscribe((employment) => {
      if (employment === readEmployment(this.route.snapshot.queryParamMap.get('employment'))) return;
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { employment: employment === DEFAULT_ORG_EMPLOYMENT ? null : employment },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });

    this.route.queryParamMap
      .pipe(
        map((params) => readEmployment(params.get('employment'))),
        distinctUntilChanged(),
        takeUntilDestroyed()
      )
      .subscribe((employment) => {
        if (employment !== this.filterForm.controls.employment.value) this.filterForm.controls.employment.setValue(employment);
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

  /**
   * Every filter back to its default. The range, commit filters, employment and team members are URL state, so one URL
   * write resets them and the URL sync sets their pickers; `tab` and other params are kept.
   */
  protected clearFilters(): void {
    this.filterForm.patchValue({ search: '', foundation: '', project: '' });
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        [ORG_LENS_TIME_RANGE_QUERY_PARAM]: orgLensTimeRangeUrlParam(ORG_LENS_DEFAULT_TIME_RANGE),
        ...orgCommitFiltersUrlParams(DEFAULT_ORG_COMMIT_FILTERS),
        employment: null,
        [ORG_TEAM_MEMBERS_QUERY_PARAM]: null,
        [ORG_SCOPE_QUERY_PARAM]: null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
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
      // The Code tab's Maintainer pills and counts follow the range, project type and code count this tab lists the person with.
      range: this.timeRange(),
      codeFilters: this.commitFilters(),
      teamMembers: this.teamMembers(),
      orgScope: this.orgScope(),
    });
  }

  protected showAll(): void {
    this.limit.set(this.totalFiltered());
  }

  protected retry(): void {
    this.retryTrigger.update((v) => v + 1);
  }

  private initFoundationOptions(): OrgDropdownOption[] {
    return [
      { label: ORG_ALL_FOUNDATIONS_LABEL, value: '' },
      ...this.response().foundationOptions.map((f) => ({ label: f.foundationName, value: f.foundationId })),
    ];
  }

  private initProjectOptions(): OrgDropdownOption[] {
    return [{ label: ORG_ANY_PROJECT_LABEL, value: '' }, ...this.response().projectOptions.map((p) => ({ label: p.projectName, value: p.projectId }))];
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
    const hasTimeFilter = this.timeRange() !== ORG_LENS_DEFAULT_TIME_RANGE;
    // A project scope, employment or team members pick other than the default changes who the BFF returns, so an empty result under it is a filtered result, not an empty org.
    const hasProjectScope = this.commitFilters().projectScope !== DEFAULT_ORG_COMMIT_FILTERS.projectScope;
    const hasEmployment = this.employment() !== DEFAULT_ORG_EMPLOYMENT;
    const hasTeamMembers = this.teamMembers() !== DEFAULT_ORG_TEAM_MEMBERS;
    const hasOrgScope = this.orgScope() !== DEFAULT_ORG_SCOPE;
    return hasSearch || hasFoundation || hasProject || hasTimeFilter || hasProjectScope || hasEmployment || hasTeamMembers || hasOrgScope;
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
      combineLatest([this.orgUid$, this.contributorsQuery$, toObservable(this.retryTrigger)]).pipe(
        tap(() => {
          this.loadingState.set(true);
          this.fetchErrorState.set(false);
        }),
        switchMap(([orgUid, { range: timeRange, filters, employment, teamMembers, orgScope }]) => {
          if (!orgUid) {
            this.loadingState.set(false);
            return of({ ...EMPTY_ORG_CONTRIBUTORS_RESPONSE, timeRange });
          }
          return this.dataService.getContributors(orgUid, timeRange, filters, employment, teamMembers, orgScope).pipe(
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
  private timeRangeControl(): Signal<OrgLensTimeRange> {
    return toSignal(this.filterForm.controls.timeRange.valueChanges, {
      initialValue: this.filterForm.controls.timeRange.value,
    });
  }

  /** The BFF commit filters for the project scope and code-count option on the form. */
  private initCommitFilters(): Signal<OrgCommitFilters> {
    const read = (): OrgCommitFilters => {
      const { projectScope, metric } = this.filterForm.getRawValue();
      return orgCommitFiltersFor({ projectScope, metric });
    };
    return toSignal(this.filterForm.valueChanges.pipe(map(read)), { initialValue: read() });
  }

  /**
   * A new range, project scope or employment can drop the picked foundation or project from the response, and filtering
   * on it would hide every row. The selection is cleared before the response renders.
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
    // The commit filters, range and employment are page-level URL state, not per-org, so an org switch keeps them.
    this.filterForm.patchValue({ search: '', foundation: '', project: '' });
    this.sortColumn.set('role');
    this.sortDirection.set(1);
    this.limit.set(ORG_CONTRIBUTORS_INITIAL_LIMIT);
    this.expansion.set({});
  }
}

/** `?employment=` value → employment filter; anything unknown (or absent) is everyone, like the Overview's Active Contributors. */
function readEmployment(value: string | null): OrgEmploymentFilter {
  return parseOrgEmploymentFilter(value) ?? DEFAULT_ORG_EMPLOYMENT;
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
