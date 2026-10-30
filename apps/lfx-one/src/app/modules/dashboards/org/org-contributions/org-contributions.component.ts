// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, inject, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { CardComponent } from '@components/card/card.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MultiSelectComponent } from '@components/multi-select/multi-select.component';
import { OrgLensEmptyStateComponent } from '@components/org-lens-empty-state/org-lens-empty-state.component';
import { PageHeaderComponent } from '@components/page-header/page-header.component';
import { MoreFiltersToggleComponent } from '@components/more-filters-toggle/more-filters-toggle.component';
import { OrgScopeSelectComponent } from '@components/org-scope-select/org-scope-select.component';
import { PersonDetailDrawerComponent } from '@components/person-detail-drawer/person-detail-drawer.component';
import { SelectComponent } from '@components/select/select.component';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';
import { TableComponent } from '@components/table/table.component';
import {
  CONTRIBUTIONS_DEFAULT_PAGE_SIZE,
  CONTRIBUTIONS_MAX_FILTER_VALUES,
  CONTRIBUTIONS_METRIC_LABELS,
  CONTRIBUTIONS_PAGE_SIZE_OPTIONS,
  DEFAULT_ORG_CODE_MEASURE,
  DEFAULT_ORG_COMMIT_FILTERS,
  DEFAULT_ORG_SCOPE,
  DEFAULT_ORG_TEAM_MEMBERS,
  EMPTY_ORG_CONTRIBUTIONS_RESPONSE,
  ORG_ALL_FOUNDATIONS_LABEL,
  ORG_ANY_PROJECT_LABEL,
  ORG_CODE_MEASURE_DEFINITION,
  ORG_CODE_MEASURE_OPTIONS,
  ORG_CODE_METRIC_UNIT,
  ORG_LENS_DEFAULT_TIME_RANGE,
  ORG_LENS_TIME_RANGE_OPTIONS,
  ORG_PROJECT_SCOPE_LABEL,
  ORG_PROJECT_SCOPE_OPTIONS,
  ORG_SCOPE_QUERY_PARAM,
  ORG_TEAM_MEMBERS_LABEL,
  ORG_TEAM_MEMBERS_OPTIONS,
  ORG_TEAM_MEMBERS_QUERY_PARAM,
  ORG_TEAM_MEMBERS_TOOLTIP,
  ORG_TEAM_MEMBERS_UNAVAILABLE_NOTE,
} from '@lfx-one/shared/constants';
import type {
  ContributionsCommitSortColumn,
  ContributionsFilterOption,
  ContributionsMetricLabels,
  ContributionsSortColumn,
  ContributionsSortDirection,
  FilterPillOption,
  OrgCodeMeasure,
  OrgCodeMeasureOption,
  OrgContributionCommitRowVm,
  OrgContributionProjectOption,
  OrgContributionRepoRowVm,
  OrgContributionsQuery,
  OrgContributionsResponse,
  OrgCountUnit,
  OrgDropdownOption,
  OrgLensTimeRange,
  OrgLensTimeRangeOption,
  OrgProjectScope,
  OrgScopeFilter,
  OrgProjectScopeOption,
  OrgTeamMembersFilter,
  OrgTeamMembersOption,
  StatCardItem,
} from '@lfx-one/shared/interfaces';
import {
  orgCodeFilterValues,
  orgCommitFiltersFor,
  orgCommitFiltersUrlMatches,
  orgCommitFiltersUrlParams,
  orgLensTimeRangeUrlParam,
  orgScopeUrlParam,
  orgTeamMembersUrlParam,
  parseOrgLensTimeRange,
  parseOrgScopeFilter,
  parseOrgTeamMembersFilter,
  readOrgCommitFilters,
  sameOrgCommitFilters,
} from '@lfx-one/shared/utils';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensOrgScopeService } from '@services/org-lens-org-scope.service';
import { OrgLensEmptyStateService } from '@services/org-lens-empty-state.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { runWhenRouterIdle } from '@shared/utils/router-idle.util';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, filter, map, merge, of, skip, Subject, switchMap, tap } from 'rxjs';

import { ContributionsService } from './services/contributions.service';
import { decorateCommitFeedRow, decorateRepoRow, describeContributionsCaption, describeContributionsWindow } from './org-contributions.util';

/** Code Contributions list page (LFXV2-1894) — KPI strip, composing filter bar, server-paginated Repositories table, per-repo drill-in. */
@Component({
  selector: 'lfx-org-contributions',
  imports: [
    PageHeaderComponent,
    DecimalPipe,
    SkeletonModule,
    TooltipModule,
    ReactiveFormsModule,
    CardComponent,
    CardTabsBarComponent,
    EmptyStateComponent,
    OrgLensEmptyStateComponent,
    InputTextComponent,
    SelectComponent,
    MultiSelectComponent,
    StatCardGridComponent,
    TableComponent,
    PersonDetailDrawerComponent,
    MoreFiltersToggleComponent,
    OrgScopeSelectComponent,
  ],
  templateUrl: './org-contributions.component.html',
})
export class OrgContributionsComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly orgScopeService = inject(OrgLensOrgScopeService);
  private readonly dataService = inject(ContributionsService);
  private readonly drawer = inject(PersonDetailDrawerService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly orgRoleGrantsService = inject(OrgRoleGrantsService);
  protected readonly emptyState = inject(OrgLensEmptyStateService);

  protected readonly dateRangeOptions: OrgLensTimeRangeOption[] = [...ORG_LENS_TIME_RANGE_OPTIONS];
  protected readonly pageSizeOptions: number[] = [...CONTRIBUTIONS_PAGE_SIZE_OPTIONS];
  protected readonly maxFilterValues = CONTRIBUTIONS_MAX_FILTER_VALUES;
  protected readonly projectScopeOptions: OrgProjectScopeOption[] = [...ORG_PROJECT_SCOPE_OPTIONS];
  protected readonly projectScopeLabel = ORG_PROJECT_SCOPE_LABEL;
  protected readonly anyProjectLabel = ORG_ANY_PROJECT_LABEL;
  protected readonly metricOptions: OrgCodeMeasureOption[] = [...ORG_CODE_MEASURE_OPTIONS];
  protected readonly teamMembersOptions: OrgTeamMembersOption[] = [...ORG_TEAM_MEMBERS_OPTIONS];
  protected readonly teamMembersLabel = ORG_TEAM_MEMBERS_LABEL;
  protected readonly teamMembersTooltip = ORG_TEAM_MEMBERS_TOOLTIP;
  protected readonly teamMembersUnavailableNote = ORG_TEAM_MEMBERS_UNAVAILABLE_NOTE;

  private readonly initialParams = this.route.snapshot.queryParamMap;
  private readonly initialCodeFilters = orgCodeFilterValues(readOrgCommitFilters((name) => this.initialParams.get(name)));

  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>(this.initialParams.get('q') ?? '', { nonNullable: true }),
    dateRange: new FormControl<OrgLensTimeRange>(parseOrgLensTimeRange(this.initialParams.get('range')), { nonNullable: true }),
    foundation: new FormControl<string>((this.initialParams.get('foundation') ?? '').trim(), { nonNullable: true }),
    projects: new FormControl<string[]>(this.parseInitialCsv('projects'), { nonNullable: true }),
    employees: new FormControl<string[]>(this.parseInitialCsv('employees'), { nonNullable: true }),
    projectScope: new FormControl<OrgProjectScope>(this.initialCodeFilters.projectScope, { nonNullable: true }),
    metric: new FormControl<OrgCodeMeasure>(this.initialCodeFilters.metric, { nonNullable: true }),
    teamMembers: new FormControl<OrgTeamMembersFilter>(
      parseOrgTeamMembersFilter(this.initialParams.get(ORG_TEAM_MEMBERS_QUERY_PARAM)) ?? DEFAULT_ORG_TEAM_MEMBERS,
      {
        nonNullable: true,
      }
    ),
    orgScope: new FormControl<OrgScopeFilter>(parseOrgScopeFilter(this.initialParams.get(ORG_SCOPE_QUERY_PARAM)) ?? DEFAULT_ORG_SCOPE, { nonNullable: true }),
  });

  protected readonly sort = signal<ContributionsSortColumn>(this.parseInitialSort());
  protected readonly dir = signal<ContributionsSortDirection>(this.initialParams.get('dir') === 'asc' ? 1 : -1);
  protected readonly commitSort = signal<ContributionsCommitSortColumn>(this.parseInitialCommitSort());
  protected readonly commitDir = signal<ContributionsSortDirection>(this.initialParams.get('commitDir') === 'asc' ? 1 : -1);
  protected readonly page = signal<number>(this.parseInitialPage());
  protected readonly size = signal<number>(this.parseInitialSize());
  protected readonly retryTrigger = signal<number>(0);

  // Repositories / Commits live on separate tabs within one content card (LFX card-tabs pattern).
  protected readonly mainTab = signal<'repositories' | 'commits'>(this.parseInitialView());

  private readonly loadingState = signal<boolean>(true);
  private readonly fetchErrorState = signal<boolean>(false);
  protected readonly isLoading = this.loadingState.asReadonly();
  protected readonly fetchError = this.fetchErrorState.asReadonly();
  // The last name each employee id was listed under, so a pick the foundation-narrowed options drop keeps its label.
  private readonly employeeLabels = new Map<string, string>();

  // Page-level state (e.g. `contractor-no-grant`, `could-not-load`) replacing the page, or null when it renders.
  protected readonly pageState = this.emptyState.pageState;
  protected readonly correlationId = this.orgRoleGrantsService.correlationId;

  protected readonly hasCompany = computed(() => !!this.accountContext.selectedAccount().uid);
  protected readonly companyName = computed(() => this.accountContext.selectedAccount().accountName);

  // The resolved org the Employees selection belongs to (null until the first org resolves); the org-change clear moves it.
  private readonly employeesOrgUid = signal<string | null>(null);
  // The org-change clear, which reaches the filter values at once instead of after the debounce.
  private readonly employeesCleared$ = new Subject<void>();

  // Filter form mirrored into a signal; debounce so per-keystroke search doesn't thrash the request graph.
  private readonly filterValues = toSignal(
    merge(this.filterForm.valueChanges.pipe(debounceTime(250)), this.employeesCleared$.pipe(map(() => this.filterForm.getRawValue()))),
    { initialValue: this.filterForm.getRawValue() }
  );

  // Composed filter + pagination state — the single source of truth fed to both the URL and the BFF.
  protected readonly query: Signal<OrgContributionsQuery> = computed(() => this.initQuery());
  // Shows the filter bar's "Clear filters" while any filter differs from its default.
  protected readonly isFiltering: Signal<boolean> = computed(() => this.initIsFiltering());
  // The secondary filters behind "More filters" (lfx-self-serve#4735): shown for this visit only, and counted while not
  // at their default so a pick from the URL stays visible on the collapsed link.
  protected readonly moreFiltersExpanded = signal(false);
  protected readonly hiddenFilterCount: Signal<number> = computed(() => {
    const query = this.query();
    return [
      orgCodeFilterValues(query).metric !== DEFAULT_ORG_CODE_MEASURE,
      query.teamMembers !== DEFAULT_ORG_TEAM_MEMBERS,
      query.orgScope !== DEFAULT_ORG_SCOPE,
    ].filter(Boolean).length;
  });

  private readonly orgUid$ = toObservable(this.accountContext.selectedAccount).pipe(
    map((account) => account.uid),
    distinctUntilChanged()
  );

  protected readonly response: Signal<OrgContributionsResponse> = this.initResponse();

  protected readonly kpis = computed(() => this.response().kpis);
  protected readonly kpiCards: Signal<StatCardItem[]> = computed(() => this.initKpiCards());
  /**
   * States the counting rule and exact window under the KPI strip, so displayed figures can be matched to source data,
   * and the organization scope served: an account without an Insights organization is served every related one.
   */
  protected readonly windowCaption: Signal<string> = computed(() => {
    const query = this.query();
    const orgScope = this.orgScopeService.current()?.hasInsightsOrg === false ? 'all' : query.orgScope;
    return describeContributionsCaption({ ...query, orgScope }, this.companyName(), describeContributionsWindow(query.dateRange));
  });
  protected readonly metricLabels: Signal<ContributionsMetricLabels> = computed(() => CONTRIBUTIONS_METRIC_LABELS[this.query().metric]);
  private readonly codeUnit: Signal<OrgCountUnit> = computed(() => ORG_CODE_METRIC_UNIT[this.query().metric]);
  protected readonly metricDefinition: Signal<string> = computed(() => ORG_CODE_MEASURE_DEFINITION[orgCodeFilterValues(this.query()).metric]);
  protected readonly repoRows: Signal<OrgContributionRepoRowVm[]> = computed(() => this.response().repositories.map(decorateRepoRow));
  protected readonly commitRows: Signal<OrgContributionCommitRowVm[]> = computed(() => this.response().commits.map(decorateCommitFeedRow));
  protected readonly commitSortIconMap: Signal<Record<ContributionsCommitSortColumn, string>> = computed(() => this.initCommitSortIconMap());
  protected readonly commitAriaSortMap: Signal<Record<ContributionsCommitSortColumn, 'ascending' | 'descending' | 'none'>> = computed(() =>
    this.initCommitAriaSortMap()
  );
  protected readonly totalRecords = computed(() => this.response().totalRecords);
  protected readonly commitsTotalRecords = computed(() => this.response().commitsTotalRecords);
  protected readonly activeTotalRecords = computed(() => (this.mainTab() === 'commits' ? this.commitsTotalRecords() : this.totalRecords()));

  protected readonly foundationOptions: Signal<OrgDropdownOption[]> = computed(() => this.initFoundationOptions());
  protected readonly projectOptions: Signal<ContributionsFilterOption[]> = computed(() => this.initProjectOptions());
  protected readonly employeeOptions: Signal<ContributionsFilterOption[]> = computed(() => this.initEmployeeOptions());

  protected readonly first = computed(() => (this.page() - 1) * this.size());
  // Shared search box scopes repos on the Repositories tab and commit message/project/committer/username on the Commits tab.
  protected readonly searchPlaceholder = computed(() => (this.mainTab() === 'commits' ? 'Search commits' : 'Search repositories'));
  protected readonly mainTabs: Signal<FilterPillOption[]> = computed(() => [
    { id: 'repositories', label: `Repositories (${this.totalRecords().toLocaleString()})` },
    { id: 'commits', label: `Commits (${this.commitsTotalRecords().toLocaleString()})` },
  ]);

  protected readonly sortIconMap: Signal<Record<ContributionsSortColumn, string>> = computed(() => this.initSortIconMap());
  protected readonly ariaSortMap: Signal<Record<ContributionsSortColumn, 'ascending' | 'descending' | 'none'>> = computed(() => this.initAriaSortMap());

  public constructor() {
    // Persist the composed state to the URL on every change (replace, no history spam).
    toObservable(this.query)
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe((query) => this.syncUrl(query));

    // PrimeNG's keyboard select-all / range-select bypass selectionLimit, so trim the controls themselves to the
    // server's per-filter cap — the visible selection, URL and request then always agree.
    this.capFilterSelection(this.filterForm.controls.projects);
    this.capFilterSelection(this.filterForm.controls.employees);

    // The Projects picker lists only the picked foundation's projects, so picking one drops the selected projects outside it.
    this.filterForm.controls.foundation.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((foundation) => this.dropProjectsOutside(foundation, this.response().projectOptions));

    // The URL sync skips the initial query, so canonicalize a deduped/trimmed deep link, or a default, unknown or legacy
    // (`12mo`) range, once the initial navigation has settled (browser-only; normal loads are untouched).
    const rawFoundation = this.initialParams.get('foundation');
    if (
      this.isCsvParamNormalized('projects') ||
      this.isCsvParamNormalized('employees') ||
      (rawFoundation !== null && rawFoundation !== this.filterForm.controls.foundation.value) ||
      this.isRangeParamNormalized() ||
      this.isCommitFilterParamNormalized() ||
      this.isTeamMembersParamNormalized()
    ) {
      afterNextRender(() => this.syncUrl(this.query()));
    }

    // Any filter change (everything except the page index) resets pagination to page 1.
    this.filterForm.valueChanges.pipe(debounceTime(250), takeUntilDestroyed()).subscribe(() => this.page.set(1));
    combineLatest([toObservable(this.sort), toObservable(this.dir), toObservable(this.size)])
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => this.page.set(1));
    combineLatest([toObservable(this.commitSort), toObservable(this.commitDir)])
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => this.page.set(1));

    // A query-only navigation (back/forward, a link from another Org Lens page) keeps this component, so the commit
    // filters follow `?projectScope=` / `?metric=`. The guard skips the echo of the page's own URL writes.
    this.route.queryParamMap
      .pipe(
        map((params) => readOrgCommitFilters((name) => params.get(name))),
        distinctUntilChanged(sameOrgCommitFilters),
        takeUntilDestroyed()
      )
      .subscribe((filters) => {
        const { projectScope, metric } = this.filterForm.getRawValue();
        if (!sameOrgCommitFilters(filters, orgCommitFiltersFor({ projectScope, metric }))) this.filterForm.patchValue(orgCodeFilterValues(filters));
      });

    // `?range=` is shared with the People tabs and carried by the nav links between them, so a query-only navigation
    // brings a new range too. The guard skips the echo of the page's own URL writes.
    this.route.queryParamMap
      .pipe(
        map((params) => parseOrgLensTimeRange(params.get('range'))),
        distinctUntilChanged(),
        takeUntilDestroyed()
      )
      .subscribe((dateRange) => {
        if (dateRange !== this.filterForm.controls.dateRange.value) this.filterForm.patchValue({ dateRange });
      });

    // `?foundation=` follows a query-only navigation (back/forward, an edited link), its removal included. The guard
    // skips the echo of the page's own URL writes.
    this.route.queryParamMap
      .pipe(
        map((params) => (params.get('foundation') ?? '').trim()),
        distinctUntilChanged(),
        takeUntilDestroyed()
      )
      .subscribe((foundation) => {
        if (foundation !== this.filterForm.controls.foundation.value) this.filterForm.patchValue({ foundation });
      });

    // `?teamMembers=` follows a query-only navigation too; the guard skips the echo of the page's own URL writes.
    this.route.queryParamMap
      .pipe(
        map((params) => parseOrgTeamMembersFilter(params.get(ORG_TEAM_MEMBERS_QUERY_PARAM)) ?? DEFAULT_ORG_TEAM_MEMBERS),
        distinctUntilChanged(),
        takeUntilDestroyed()
      )
      .subscribe((teamMembers) => {
        if (teamMembers !== this.filterForm.controls.teamMembers.value) this.filterForm.patchValue({ teamMembers });
      });

    // `?orgScope=` is shared with Overview, People and Project Detail (lfx-self-serve-ops#1219); same echo guard.
    this.route.queryParamMap
      .pipe(
        map((params) => parseOrgScopeFilter(params.get(ORG_SCOPE_QUERY_PARAM)) ?? DEFAULT_ORG_SCOPE),
        distinctUntilChanged(),
        takeUntilDestroyed()
      )
      .subscribe((orgScope) => {
        if (orgScope !== this.filterForm.controls.orgScope.value) this.filterForm.patchValue({ orgScope });
      });

    // The Employees selection came from the previous org's roster, so a change between two resolved orgs (a switch,
    // or Back/Forward across one) clears it; the switch navigation strips `?employees=` too. `initQuery` sends no
    // Employees from the moment the org changes until this runs; the clear then reaches the filter values at once, not
    // after the debounce, and restarting the debounce drops a pick still pending from the previous org.
    this.orgUid$
      .pipe(
        filter((uid): uid is string => !!uid),
        distinctUntilChanged(),
        takeUntilDestroyed()
      )
      .subscribe((uid) => {
        const previous = this.employeesOrgUid();
        this.employeesOrgUid.set(uid);
        if (previous === null) return;
        this.filterForm.controls.employees.setValue([]);
        this.employeesCleared$.next();
      });
  }

  protected openCommitterPanel(commit: OrgContributionCommitRowVm): void {
    if (!commit.personKey) {
      return;
    }
    const query = this.query();
    this.drawer.open({
      personKey: commit.personKey,
      name: commit.committerName,
      title: commit.committerTitle,
      avatarUrl: commit.committerAvatarUrl,
      initials: commit.initials,
      avatarColorClass: commit.avatarColorClass,
      username: commit.username,
      profileUrl: commit.profileUrl,
      sourceIconClass: commit.sourceIconClass,
      defaultTab: 'code',
      // The Code tab's Maintainer pills and counts follow the range, project type and code count the page shows.
      range: query.dateRange,
      codeFilters: { projectScope: query.projectScope, commitScope: query.commitScope, metric: query.metric },
      teamMembers: query.teamMembers,
      orgScope: query.orgScope,
    });
  }

  protected onSort(column: ContributionsSortColumn): void {
    if (this.sort() === column) {
      this.dir.update((d) => (d === 1 ? -1 : 1));
      return;
    }
    this.sort.set(column);
    // All sortable columns here (commits / dates) default to descending on first click.
    this.dir.set(-1);
  }

  protected onSortCommits(column: ContributionsCommitSortColumn): void {
    if (this.commitSort() === column) {
      this.commitDir.update((d) => (d === 1 ? -1 : 1));
      return;
    }
    this.commitSort.set(column);
    // Date defaults to most-recent-first; text columns ascending.
    this.commitDir.set(column === 'date' ? -1 : 1);
  }

  protected onMainTabChange(tabId: string): void {
    this.mainTab.set(tabId === 'commits' ? 'commits' : 'repositories');
    this.page.set(1);
  }

  protected onTablePage(event: { first?: number; rows?: number }): void {
    const rows = event.rows ?? this.size();
    const first = event.first ?? 0;
    this.size.set(rows);
    this.page.set(Math.floor(first / rows) + 1);
  }

  protected clearFilters(): void {
    this.filterForm.reset({
      search: '',
      dateRange: ORG_LENS_DEFAULT_TIME_RANGE,
      foundation: '',
      projects: [],
      employees: [],
      projectScope: DEFAULT_ORG_COMMIT_FILTERS.projectScope,
      metric: DEFAULT_ORG_CODE_MEASURE,
      teamMembers: DEFAULT_ORG_TEAM_MEMBERS,
      orgScope: DEFAULT_ORG_SCOPE,
    });
  }

  protected retry(): void {
    this.retryTrigger.update((v) => v + 1);
  }

  private initQuery(): OrgContributionsQuery {
    const values = this.filterValues();
    const selectionOrgUid = this.employeesOrgUid();
    // Between an org change and its clear, the selection still holds the previous org's people: send none.
    const staleEmployees = selectionOrgUid !== null && selectionOrgUid !== this.accountContext.selectedAccount().uid;
    return {
      ...orgCommitFiltersFor({
        projectScope: values.projectScope ?? DEFAULT_ORG_COMMIT_FILTERS.projectScope,
        metric: values.metric ?? DEFAULT_ORG_CODE_MEASURE,
      }),
      view: this.mainTab(),
      dateRange: values.dateRange ?? ORG_LENS_DEFAULT_TIME_RANGE,
      search: (values.search ?? '').trim(),
      foundation: values.foundation ?? '',
      // The controls are already trimmed in the constructor; clamp again so the request can never exceed the server's cap.
      projects: (values.projects ?? []).slice(0, CONTRIBUTIONS_MAX_FILTER_VALUES),
      employees: staleEmployees ? [] : (values.employees ?? []).slice(0, CONTRIBUTIONS_MAX_FILTER_VALUES),
      teamMembers: values.teamMembers ?? DEFAULT_ORG_TEAM_MEMBERS,
      orgScope: values.orgScope ?? DEFAULT_ORG_SCOPE,
      sort: this.sort(),
      dir: this.dir(),
      commitSort: this.commitSort(),
      commitDir: this.commitDir(),
      page: this.page(),
      size: this.size(),
    };
  }

  private initIsFiltering(): boolean {
    const query = this.query();
    return (
      query.search.length > 0 ||
      query.dateRange !== ORG_LENS_DEFAULT_TIME_RANGE ||
      query.foundation.length > 0 ||
      query.projects.length > 0 ||
      query.employees.length > 0 ||
      query.teamMembers !== DEFAULT_ORG_TEAM_MEMBERS ||
      query.orgScope !== DEFAULT_ORG_SCOPE ||
      !sameOrgCommitFilters(query, DEFAULT_ORG_COMMIT_FILTERS)
    );
  }

  private initResponse(): Signal<OrgContributionsResponse> {
    // The org and the query are read together, so an org change and the Employees it drops reach one request.
    const request = computed(() => ({ orgUid: this.accountContext.selectedAccount().uid, query: this.query() }));
    return toSignal(
      combineLatest([
        toObservable(request).pipe(distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))),
        toObservable(this.retryTrigger),
      ]).pipe(
        tap(() => {
          this.loadingState.set(true);
          this.fetchErrorState.set(false);
        }),
        switchMap(([{ orgUid, query }]) => {
          if (!orgUid) {
            this.loadingState.set(false);
            return of({ ...EMPTY_ORG_CONTRIBUTIONS_RESPONSE, dateRange: query.dateRange });
          }
          return this.dataService.getContributions(orgUid, query).pipe(
            tap((res) => {
              this.loadingState.set(false);
              for (const employee of res.employeeOptions) this.employeeLabels.set(employee.id, employee.displayName);
              this.reconcileSelections(res, query);
            }),
            catchError(() => {
              this.fetchErrorState.set(true);
              this.loadingState.set(false);
              return of({ ...EMPTY_ORG_CONTRIBUTIONS_RESPONSE, dateRange: query.dateRange });
            })
          );
        })
      ),
      { initialValue: EMPTY_ORG_CONTRIBUTIONS_RESPONSE }
    );
  }

  private initKpiCards(): StatCardItem[] {
    const k = this.kpis();
    return [
      {
        value: k.projectsWithActivity.toLocaleString(),
        label: 'Projects with Activity',
        icon: 'fa-light fa-diagram-project',
        iconContainerClass: 'bg-blue-100 text-blue-600',
      },
      { value: k.repositories.toLocaleString(), label: 'Repositories', icon: 'fa-light fa-folder', iconContainerClass: 'bg-violet-100 text-violet-600' },
      {
        value: k.commits.toLocaleString(),
        label: this.metricLabels().count,
        icon: 'fa-light fa-code-commit',
        iconContainerClass: 'bg-emerald-100 text-emerald-600',
      },
    ];
  }

  private initCommitSortIconMap(): Record<ContributionsCommitSortColumn, string> {
    const active = this.commitSort();
    const activeIcon = this.commitDir() === 1 ? 'fa-light fa-sort-up' : 'fa-light fa-sort-down';
    const iconFor = (col: ContributionsCommitSortColumn): string => (active === col ? activeIcon : 'fa-light fa-sort');
    return {
      project: iconFor('project'),
      committer: iconFor('committer'),
      username: iconFor('username'),
      date: iconFor('date'),
    };
  }

  private initCommitAriaSortMap(): Record<ContributionsCommitSortColumn, 'ascending' | 'descending' | 'none'> {
    const active = this.commitSort();
    const direction: 'ascending' | 'descending' = this.commitDir() === 1 ? 'ascending' : 'descending';
    const sortFor = (col: ContributionsCommitSortColumn): 'ascending' | 'descending' | 'none' => (active === col ? direction : 'none');
    return {
      project: sortFor('project'),
      committer: sortFor('committer'),
      username: sortFor('username'),
      date: sortFor('date'),
    };
  }

  private initFoundationOptions(): OrgDropdownOption[] {
    return [
      { label: ORG_ALL_FOUNDATIONS_LABEL, value: '' },
      ...this.response().foundationOptions.map((f) => ({ label: f.foundationName, value: f.foundationId })),
    ];
  }

  private initProjectOptions(): ContributionsFilterOption[] {
    const unit = this.codeUnit();
    const foundation = this.query().foundation;
    return this.response()
      .projectOptions.filter((p) => !foundation || p.foundationId === foundation)
      .map((p) => ({
        label: p.name,
        value: p.slug,
        sublabel: `${p.commits.toLocaleString()} ${p.commits === 1 ? unit.one : unit.other}`,
      }));
  }

  /**
   * Employee options narrow to the picked foundation, but a pick is never dropped for it (employee and foundation
   * intersect). A picked employee the options no longer list stays offered, under the last label seen for them, so
   * the picker can still show and remove them.
   */
  private initEmployeeOptions(): ContributionsFilterOption[] {
    const unit = this.codeUnit();
    const listed = this.response().employeeOptions;
    const options = listed.map((e) => ({
      label: e.displayName,
      value: e.id,
      sublabel: `${e.commits.toLocaleString()} ${e.commits === 1 ? unit.one : unit.other}`,
    }));
    for (const id of this.query().employees) {
      if (!listed.some((e) => e.id === id)) options.push({ label: this.employeeLabels.get(id) ?? id, value: id, sublabel: `0 ${unit.other}` });
    }
    return options;
  }

  /**
   * A new range or project type can drop the picked foundation from the options, and filtering on it would empty the
   * page, so it is cleared (as on People → Contributors). Options also arrive with each project's foundation, so a
   * deep-linked project pick outside the foundation is dropped. Only a response for the range, project type and
   * foundation the form still holds may do either: one that lands during the debounce of a newer pick belongs to
   * filters the user has already left.
   */
  private reconcileSelections(res: OrgContributionsResponse, query: OrgContributionsQuery): void {
    const { dateRange, projectScope, foundation, teamMembers, orgScope } = this.filterForm.getRawValue();
    if (
      dateRange !== query.dateRange ||
      projectScope !== query.projectScope ||
      foundation !== query.foundation ||
      teamMembers !== query.teamMembers ||
      orgScope !== query.orgScope
    ) {
      return;
    }
    const control = this.filterForm.controls.foundation;
    if (control.value && !res.foundationOptions.some((option) => option.foundationId === control.value)) control.setValue('');
    this.dropProjectsOutside(control.value, res.projectOptions);
  }

  private initSortIconMap(): Record<ContributionsSortColumn, string> {
    const active = this.sort();
    const activeIcon = this.dir() === 1 ? 'fa-light fa-sort-up' : 'fa-light fa-sort-down';
    const iconFor = (col: ContributionsSortColumn): string => (active === col ? activeIcon : 'fa-light fa-sort');
    return {
      commits: iconFor('commits'),
      firstCommit: iconFor('firstCommit'),
      lastCommit: iconFor('lastCommit'),
    };
  }

  private initAriaSortMap(): Record<ContributionsSortColumn, 'ascending' | 'descending' | 'none'> {
    const active = this.sort();
    const direction: 'ascending' | 'descending' = this.dir() === 1 ? 'ascending' : 'descending';
    return {
      commits: active === 'commits' ? direction : 'none',
      firstCommit: active === 'firstCommit' ? direction : 'none',
      lastCommit: active === 'lastCommit' ? direction : 'none',
    };
  }

  // Deferred while another navigation (an org switch swapping the path) is in flight, so it cannot supersede it.
  private syncUrl(query: OrgContributionsQuery): void {
    runWhenRouterIdle(this.router, this.destroyRef, () => this.navigateToQuery(query));
  }

  private navigateToQuery(query: OrgContributionsQuery): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        view: query.view === 'repositories' ? null : query.view,
        q: query.search || null,
        range: orgLensTimeRangeUrlParam(query.dateRange),
        ...orgCommitFiltersUrlParams(query),
        foundation: query.foundation || null,
        projects: query.projects.length ? query.projects.join(',') : null,
        employees: query.employees.length ? query.employees.join(',') : null,
        [ORG_TEAM_MEMBERS_QUERY_PARAM]: orgTeamMembersUrlParam(query.teamMembers),
        [ORG_SCOPE_QUERY_PARAM]: orgScopeUrlParam(query.orgScope),
        sort: query.sort === 'commits' && query.dir === -1 ? null : query.sort,
        dir: query.dir === 1 ? 'asc' : null,
        commitSort: query.commitSort === 'date' && query.commitDir === -1 ? null : query.commitSort,
        commitDir: query.commitDir === 1 ? 'asc' : null,
        page: query.page > 1 ? query.page : null,
        size: query.size === CONTRIBUTIONS_DEFAULT_PAGE_SIZE ? null : query.size,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private parseInitialSort(): ContributionsSortColumn {
    const raw = this.initialParams.get('sort');
    return raw === 'firstCommit' || raw === 'lastCommit' ? raw : 'commits';
  }

  private parseInitialCommitSort(): ContributionsCommitSortColumn {
    const raw = this.initialParams.get('commitSort');
    return raw === 'project' || raw === 'committer' || raw === 'username' ? raw : 'date';
  }

  private parseInitialView(): 'repositories' | 'commits' {
    return this.initialParams.get('view') === 'commits' ? 'commits' : 'repositories';
  }

  // Deduped and trimmed to the server's per-filter cap so an oversized deep link still loads instead of 400ing.
  private parseInitialCsv(param: string): string[] {
    const raw = this.initialParams.get(param);
    return raw
      ? [
          ...new Set(
            raw
              .split(',')
              .map((v) => v.trim())
              .filter((v) => v.length > 0)
          ),
        ].slice(0, CONTRIBUTIONS_MAX_FILTER_VALUES)
      : [];
  }

  private capFilterSelection(control: FormControl<string[]>): void {
    control.valueChanges.pipe(takeUntilDestroyed()).subscribe((values) => {
      if (values.length > CONTRIBUTIONS_MAX_FILTER_VALUES) {
        control.setValue(values.slice(0, CONTRIBUTIONS_MAX_FILTER_VALUES));
      }
    });
  }

  /**
   * Drops the selected projects the options place under a foundation other than `foundation`. Projects the options do
   * not list (no activity in the range for this project type, or options not loaded yet) are kept; any foundation keeps
   * them all. Leaves the control untouched, and so fetches nothing, when nothing is dropped.
   */
  private dropProjectsOutside(foundation: string, options: readonly OrgContributionProjectOption[]): void {
    const projects = this.filterForm.controls.projects;
    if (!foundation || !projects.value.length) {
      return;
    }
    const kept = projects.value.filter((value) => {
      const option = options.find((o) => o.slug === value || o.projectId === value);
      return !option || option.foundationId === foundation;
    });
    if (kept.length !== projects.value.length) {
      projects.setValue(kept);
    }
  }

  private isCsvParamNormalized(param: 'projects' | 'employees'): boolean {
    const raw = this.initialParams.get(param);
    return raw !== null && raw !== this.filterForm.controls[param].value.join(',');
  }

  // `?range=` as the page writes it: absent for the default, so a default, unknown or legacy (`12mo`) value is rewritten.
  private isRangeParamNormalized(): boolean {
    const raw = this.initialParams.get('range');
    return raw !== null && raw !== orgLensTimeRangeUrlParam(this.filterForm.controls.dateRange.value);
  }

  // A default, unknown or legacy (`commitScope=merged`) commit-filter value in the URL is rewritten to its canonical form.
  private isCommitFilterParamNormalized(): boolean {
    return !orgCommitFiltersUrlMatches(orgCommitFiltersFor(this.initialCodeFilters), (name) => this.initialParams.get(name));
  }

  private isTeamMembersParamNormalized(): boolean {
    const raw = this.initialParams.get(ORG_TEAM_MEMBERS_QUERY_PARAM);
    return raw !== null && raw !== orgTeamMembersUrlParam(this.filterForm.controls.teamMembers.value);
  }

  private parseInitialPage(): number {
    const parsed = Number.parseInt(this.initialParams.get('page') ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }

  private parseInitialSize(): number {
    const parsed = Number.parseInt(this.initialParams.get('size') ?? '', 10);
    return CONTRIBUTIONS_PAGE_SIZE_OPTIONS.includes(parsed) ? parsed : CONTRIBUTIONS_DEFAULT_PAGE_SIZE;
  }
}
