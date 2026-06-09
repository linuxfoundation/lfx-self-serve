// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CardComponent } from '@components/card/card.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MultiSelectComponent } from '@components/multi-select/multi-select.component';
import { SelectComponent } from '@components/select/select.component';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';
import { TableComponent } from '@components/table/table.component';
import {
  CONTRIBUTIONS_DATE_RANGE_OPTIONS,
  CONTRIBUTIONS_DEFAULT_DATE_RANGE,
  CONTRIBUTIONS_DEFAULT_PAGE_SIZE,
  CONTRIBUTIONS_PAGE_SIZE_OPTIONS,
  EMPTY_ORG_CONTRIBUTIONS_RESPONSE,
} from '@lfx-one/shared/constants';
import type {
  CommitterPanelTab,
  ContributionsCommitSortColumn,
  ContributionsDateRange,
  ContributionsDateRangeOption,
  ContributionsFilterOption,
  ContributionsSortColumn,
  ContributionsSortDirection,
  FilterPillOption,
  OrgCommitterDetailVm,
  OrgContributionCommitRowVm,
  OrgContributionRepoRowVm,
  OrgContributionsQuery,
  OrgContributionsResponse,
  StatCardItem,
} from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { DrawerModule } from 'primeng/drawer';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, map, of, skip, switchMap, tap } from 'rxjs';

import { ContributionsService } from './services/contributions.service';
import { buildCommitterExtras, decorateCommitFeedRow, decorateRepoRow } from './org-contributions.util';

/** Code Contributions list page (LFXV2-1894) — KPI strip, composing filter bar, server-paginated Repositories table, per-repo drill-in. */
@Component({
  selector: 'lfx-org-contributions',
  imports: [
    DecimalPipe,
    ReactiveFormsModule,
    CardComponent,
    CardTabsBarComponent,
    EmptyStateComponent,
    InputTextComponent,
    SelectComponent,
    MultiSelectComponent,
    StatCardGridComponent,
    TableComponent,
    DrawerModule,
  ],
  templateUrl: './org-contributions.component.html',
})
export class OrgContributionsComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly dataService = inject(ContributionsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly dateRangeOptions: ContributionsDateRangeOption[] = [...CONTRIBUTIONS_DATE_RANGE_OPTIONS];
  protected readonly pageSizeOptions: number[] = [...CONTRIBUTIONS_PAGE_SIZE_OPTIONS];
  protected readonly committerPanelTabs: readonly { id: CommitterPanelTab; label: string }[] = [
    { id: 'events', label: 'Events' },
    { id: 'training', label: 'Training' },
    { id: 'code', label: 'Code Contributions' },
    { id: 'governance', label: 'Governance' },
  ];

  private readonly initialParams = this.route.snapshot.queryParamMap;

  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>(this.initialParams.get('q') ?? '', { nonNullable: true }),
    dateRange: new FormControl<ContributionsDateRange>(this.parseInitialDateRange(), { nonNullable: true }),
    projects: new FormControl<string[]>(this.parseInitialCsv('projects'), { nonNullable: true }),
    employees: new FormControl<string[]>(this.parseInitialCsv('employees'), { nonNullable: true }),
  });

  protected readonly sort = signal<ContributionsSortColumn>(this.parseInitialSort());
  protected readonly dir = signal<ContributionsSortDirection>(this.initialParams.get('dir') === 'asc' ? 1 : -1);
  protected readonly page = signal<number>(this.parseInitialPage());
  protected readonly size = signal<number>(this.parseInitialSize());
  protected readonly retryTrigger = signal<number>(0);

  // Repositories / Commits live on separate tabs within one content card (LFX card-tabs pattern).
  protected readonly mainTab = signal<'repositories' | 'commits'>('repositories');

  // Org-wide Commits feed sort is client-side over the rows the BFF already returned.
  protected readonly commitSort = signal<ContributionsCommitSortColumn>('date');
  protected readonly commitDir = signal<ContributionsSortDirection>(-1);

  // Committer side panel — name of the committer whose detail drawer is open (null = closed).
  protected readonly selectedCommitter = signal<string | null>(null);
  protected readonly committerTab = signal<CommitterPanelTab>('code');

  private readonly loadingState = signal<boolean>(true);
  private readonly fetchErrorState = signal<boolean>(false);
  protected readonly isLoading = this.loadingState.asReadonly();
  protected readonly fetchError = this.fetchErrorState.asReadonly();

  protected readonly hasCompany = computed(() => !!this.accountContext.selectedAccount().uid);
  protected readonly companyName = computed(() => this.accountContext.selectedAccount().accountName);

  // Filter form mirrored into a signal; debounce so per-keystroke search doesn't thrash the request graph.
  private readonly filterValues = toSignal(this.filterForm.valueChanges.pipe(debounceTime(250)), {
    initialValue: this.filterForm.getRawValue(),
  });

  // Composed filter + pagination state — the single source of truth fed to both the URL and the BFF.
  protected readonly query: Signal<OrgContributionsQuery> = computed(() => this.initQuery());

  private readonly orgUid$ = toObservable(this.accountContext.selectedAccount).pipe(
    map((account) => account.uid),
    distinctUntilChanged()
  );

  protected readonly response: Signal<OrgContributionsResponse> = this.initResponse();

  protected readonly kpis = computed(() => this.response().kpis);
  protected readonly kpiCards: Signal<StatCardItem[]> = computed(() => this.initKpiCards());
  protected readonly repoRows: Signal<OrgContributionRepoRowVm[]> = computed(() => this.response().repositories.map(decorateRepoRow));
  protected readonly commitRows: Signal<OrgContributionCommitRowVm[]> = computed(() => this.initCommitRows());
  protected readonly commitSortIconMap: Signal<Record<ContributionsCommitSortColumn, string>> = computed(() => this.initCommitSortIconMap());
  protected readonly committerDetail: Signal<OrgCommitterDetailVm | null> = computed(() => this.initCommitterDetail());
  protected readonly totalRecords = computed(() => this.response().totalRecords);

  protected readonly projectOptions: Signal<ContributionsFilterOption[]> = computed(() => this.initProjectOptions());
  protected readonly employeeOptions: Signal<ContributionsFilterOption[]> = computed(() => this.initEmployeeOptions());

  protected readonly first = computed(() => (this.page() - 1) * this.size());
  protected readonly mainTabs: Signal<FilterPillOption[]> = computed(() => [
    { id: 'repositories', label: `Repositories (${this.totalRecords().toLocaleString()})` },
    { id: 'commits', label: `Commits (${this.commitRows().length.toLocaleString()})` },
  ]);

  protected readonly sortIconMap: Signal<Record<ContributionsSortColumn, string>> = computed(() => this.initSortIconMap());
  protected readonly ariaSortMap: Signal<Record<ContributionsSortColumn, 'ascending' | 'descending' | 'none'>> = computed(() => this.initAriaSortMap());

  public constructor() {
    // Persist the composed state to the URL on every change (replace, no history spam).
    toObservable(this.query)
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe((query) => this.syncUrl(query));

    // Any filter change (everything except the page index) resets pagination to page 1.
    this.filterForm.valueChanges.pipe(debounceTime(250), takeUntilDestroyed()).subscribe(() => this.page.set(1));
    combineLatest([toObservable(this.sort), toObservable(this.dir), toObservable(this.size)])
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => this.page.set(1));
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

  protected openCommitter(name: string): void {
    this.committerTab.set('code');
    this.selectedCommitter.set(name);
  }

  protected setCommitterTab(tab: CommitterPanelTab): void {
    this.committerTab.set(tab);
  }

  protected onCommitterPanelVisible(visible: boolean): void {
    if (!visible) {
      this.selectedCommitter.set(null);
    }
  }

  protected onMainTabChange(tabId: string): void {
    this.mainTab.set(tabId === 'commits' ? 'commits' : 'repositories');
  }

  protected onTablePage(event: { first?: number; rows?: number }): void {
    const rows = event.rows ?? this.size();
    const first = event.first ?? 0;
    this.size.set(rows);
    this.page.set(Math.floor(first / rows) + 1);
  }

  protected clearFilters(): void {
    this.filterForm.reset({ search: '', dateRange: CONTRIBUTIONS_DEFAULT_DATE_RANGE, projects: [], employees: [] });
  }

  protected retry(): void {
    this.retryTrigger.update((v) => v + 1);
  }

  private initQuery(): OrgContributionsQuery {
    const values = this.filterValues();
    return {
      dateRange: values.dateRange ?? CONTRIBUTIONS_DEFAULT_DATE_RANGE,
      search: (values.search ?? '').trim(),
      projects: values.projects ?? [],
      employees: values.employees ?? [],
      sort: this.sort(),
      dir: this.dir(),
      page: this.page(),
      size: this.size(),
    };
  }

  private initResponse(): Signal<OrgContributionsResponse> {
    return toSignal(
      combineLatest([
        this.orgUid$,
        toObservable(this.query).pipe(distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))),
        toObservable(this.retryTrigger),
      ]).pipe(
        tap(() => {
          this.loadingState.set(true);
          this.fetchErrorState.set(false);
        }),
        switchMap(([orgUid, query]) => {
          if (!orgUid) {
            this.loadingState.set(false);
            return of({ ...EMPTY_ORG_CONTRIBUTIONS_RESPONSE, dateRange: query.dateRange });
          }
          return this.dataService.getContributions(orgUid, query).pipe(
            tap(() => this.loadingState.set(false)),
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

  private initCommitRows(): OrgContributionCommitRowVm[] {
    const rows = this.response().commits.map(decorateCommitFeedRow);
    const col = this.commitSort();
    const dir = this.commitDir();
    return rows.sort((a, b) => {
      switch (col) {
        case 'project':
          return a.projectName.localeCompare(b.projectName) * dir;
        case 'committer':
          return a.committerName.localeCompare(b.committerName) * dir;
        case 'username':
          return (a.username ?? '').localeCompare(b.username ?? '') * dir;
        case 'date':
          return (new Date(a.committedTs).getTime() - new Date(b.committedTs).getTime()) * dir;
      }
    });
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
      { value: k.commits1yr.toLocaleString(), label: 'Commits (1yr)', icon: 'fa-light fa-code-commit', iconContainerClass: 'bg-emerald-100 text-emerald-600' },
    ];
  }

  private initCommitterDetail(): OrgCommitterDetailVm | null {
    const name = this.selectedCommitter();
    if (!name) {
      return null;
    }
    const rows = this.commitRows().filter((c) => c.committerName === name);
    if (rows.length === 0) {
      return null;
    }
    const first = rows[0];
    const projects = [...new Set(rows.map((c) => c.projectName))].sort((a, b) => a.localeCompare(b));
    const extras = buildCommitterExtras(first.committerName);
    return {
      name: first.committerName,
      title: first.committerTitle,
      username: first.username,
      source: first.source,
      sourceIconClass: first.sourceIconClass,
      profileUrl: first.profileUrl,
      initials: first.initials,
      avatarColorClass: first.avatarColorClass,
      totalCommits: rows.length,
      projects,
      commits: rows,
      events: extras.events,
      training: extras.training,
      governance: extras.governance,
    };
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

  private initProjectOptions(): ContributionsFilterOption[] {
    return this.response().projectOptions.map((p) => ({
      label: p.name,
      value: p.slug,
      sublabel: `${p.commits.toLocaleString()} commits`,
    }));
  }

  private initEmployeeOptions(): ContributionsFilterOption[] {
    return this.response().employeeOptions.map((e) => ({
      label: e.displayName,
      value: e.id,
      sublabel: `${e.commits.toLocaleString()} commits`,
    }));
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

  private syncUrl(query: OrgContributionsQuery): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        q: query.search || null,
        range: query.dateRange === CONTRIBUTIONS_DEFAULT_DATE_RANGE ? null : query.dateRange,
        projects: query.projects.length ? query.projects.join(',') : null,
        employees: query.employees.length ? query.employees.join(',') : null,
        sort: query.sort === 'commits' && query.dir === -1 ? null : query.sort,
        dir: query.dir === 1 ? 'asc' : null,
        page: query.page > 1 ? query.page : null,
        size: query.size === CONTRIBUTIONS_DEFAULT_PAGE_SIZE ? null : query.size,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private parseInitialDateRange(): ContributionsDateRange {
    const raw = this.initialParams.get('range');
    return CONTRIBUTIONS_DATE_RANGE_OPTIONS.some((o) => o.value === raw) ? (raw as ContributionsDateRange) : CONTRIBUTIONS_DEFAULT_DATE_RANGE;
  }

  private parseInitialSort(): ContributionsSortColumn {
    const raw = this.initialParams.get('sort');
    return raw === 'firstCommit' || raw === 'lastCommit' ? raw : 'commits';
  }

  private parseInitialCsv(param: string): string[] {
    const raw = this.initialParams.get(param);
    return raw
      ? raw
          .split(',')
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
      : [];
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
