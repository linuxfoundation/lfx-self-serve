// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe, isPlatformBrowser } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, inject, PLATFORM_ID, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  catchError,
  combineLatest,
  distinctUntilChanged,
  EMPTY,
  finalize,
  map,
  merge,
  mergeMap,
  Observable,
  of,
  skip,
  Subject,
  switchMap,
  take,
  takeUntil,
  tap,
  throwError,
} from 'rxjs';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { AccountContextService } from '@services/account-context.service';
import { OrgPeopleDirectoryStateService } from '@services/org-people-directory-state.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';

import {
  DEFAULT_ORG_ALL_EMPLOYEE_EMPLOYMENT,
  DEFAULT_ORG_CODE_MEASURE,
  DEFAULT_ORG_COMMIT_FILTERS,
  EMPTY_ORG_ALL_EMPLOYEES_RESPONSE,
  ORG_ALL_EMPLOYEE_ACTIVITY_OPTIONS,
  ORG_ALL_EMPLOYEE_CODE_STAT_LABEL,
  ORG_ALL_EMPLOYEE_EMPLOYMENT_OPTIONS,
  ORG_ALL_EMPLOYEES_INITIAL_LIMIT,
  ORG_CODE_MEASURE_DEFINITION,
  ORG_CODE_METRIC_LABEL,
  ORG_CODE_MEASURE_OPTIONS,
  ORG_CODE_METRIC_UNIT,
  ORG_LENS_DEFAULT_TIME_RANGE,
  ORG_LENS_TIME_RANGE_OPTIONS,
  ORG_PEOPLE_UNKNOWN_MEMBER_NAME,
  ORG_PROJECT_SCOPE_OPTIONS,
} from '@lfx-one/shared/constants';
import type {
  OrgAccessBadgeState,
  OrgAllEmployeeActivityFilter,
  OrgAllEmployeeActivityOption,
  OrgAllEmployeeDetail,
  OrgAllEmployeeEmploymentFilter,
  OrgAllEmployeeEmploymentOption,
  OrgAllEmployeeRow,
  OrgAllEmployeeRowVm,
  OrgAllEmployeesResponse,
  OrgAllEmployeeSortColumn,
  OrgAllEmployeeSortDirection,
  OrgAllEmployeeStats,
  OrgCodeFilterValues,
  OrgCodeMeasure,
  OrgCodeMeasureOption,
  OrgCommitFilters,
  OrgCountUnit,
  OrgDropdownOption,
  OrgLensTimeRange,
  OrgLensTimeRangeOption,
  OrgProjectScope,
  OrgProjectScopeOption,
} from '@lfx-one/shared/interfaces';
import {
  computeOrgAllEmployeeStats,
  orgCodeFilterValues,
  orgCommitFiltersFor,
  orgCommitFiltersUrlMatches,
  orgCommitFiltersUrlParams,
  orgLensTimeRangeUrlParam,
  parseOrgLensTimeRange,
  readOrgCommitFilters,
  sameOrgCommitFilters,
} from '@lfx-one/shared/utils';

import { AllEmployeesService } from '../../services/all-employees.service';

import { AllEmployeesDetailComponent } from './all-employees-detail.component';

/** All Employees tab body — filter bar, 5 stat cards, sortable table with chevron-toggled detail rows. */
@Component({
  selector: 'lfx-org-people-all-employees',
  imports: [
    DecimalPipe,
    ReactiveFormsModule,
    SkeletonModule,
    TooltipModule,
    EmptyStateComponent,
    InputTextComponent,
    SelectComponent,
    AllEmployeesDetailComponent,
  ],
  templateUrl: './all-employees.component.html',
})
export class AllEmployeesComponent {
  private static readonly rowClassActivity =
    'cursor-pointer border-b border-gray-100 hover:bg-gray-50 focus:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

  private readonly accountContext = inject(AccountContextService);
  private readonly dataService = inject(AllEmployeesService);
  private readonly directory = inject(OrgPeopleDirectoryStateService);
  private readonly drawer = inject(PersonDetailDrawerService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly initialLimit = ORG_ALL_EMPLOYEES_INITIAL_LIMIT;

  // Spread to a mutable array so PrimeNG's mutable [options] input type accepts it without an unsafe cast.
  protected readonly employmentOptions: OrgAllEmployeeEmploymentOption[] = [...ORG_ALL_EMPLOYEE_EMPLOYMENT_OPTIONS];
  protected readonly rangeOptions: OrgLensTimeRangeOption[] = [...ORG_LENS_TIME_RANGE_OPTIONS];
  protected readonly projectScopeOptions: OrgProjectScopeOption[] = [...ORG_PROJECT_SCOPE_OPTIONS];
  protected readonly metricOptions: OrgCodeMeasureOption[] = [...ORG_CODE_MEASURE_OPTIONS];

  protected readonly tableSkeletonRows: readonly number[] = [0, 1, 2, 3, 4, 5];

  // The URL-backed filters as the page opened: `?employment=`, `?range=` (shared with the other People tabs and Code
  // Contributions) and `?projectScope=` / `?metric=` (shared with the Contributors tab). They seed the form and the signals below.
  private readonly initialEmployment = AllEmployeesComponent.parseEmployment(this.route.snapshot.queryParamMap.get('employment'));
  private readonly initialRange = parseOrgLensTimeRange(this.route.snapshot.queryParamMap.get('range'));
  private readonly initialFilters = readOrgCommitFilters((name) => this.route.snapshot.queryParamMap.get(name));
  private readonly initialCodeFilters = orgCodeFilterValues(this.initialFilters);

  // The filter bar. The signals below stay the source of truth (the URL, Clear filters, an account switch and the
  // foundation clean-up write them); a control change is handed to them and they are mirrored back into the form.
  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
    foundation: new FormControl<string>('', { nonNullable: true }),
    activity: new FormControl<OrgAllEmployeeActivityFilter>('all', { nonNullable: true }),
    employment: new FormControl<OrgAllEmployeeEmploymentFilter>(this.initialEmployment, { nonNullable: true }),
    range: new FormControl<OrgLensTimeRange>(this.initialRange, { nonNullable: true }),
    projectScope: new FormControl<OrgProjectScope>(this.initialCodeFilters.projectScope, { nonNullable: true }),
    metric: new FormControl<OrgCodeMeasure>(this.initialCodeFilters.metric, { nonNullable: true }),
  });

  protected readonly searchTerm = signal<string>('');
  protected readonly selectedFoundationId = signal<string>('');
  protected readonly selectedActivity = signal<OrgAllEmployeeActivityFilter>('all');
  // Follows `?employment=` so a shared link or a back/forward step opens the same view; written back on change (default dropped from the URL).
  protected readonly selectedEmployment = signal<OrgAllEmployeeEmploymentFilter>(this.initialEmployment);
  // Follows `?range=` the same way; the roster, its tiles and the former employees are all read for this range.
  protected readonly selectedRange = signal<OrgLensTimeRange>(this.initialRange);
  // Follows `?projectScope=` / `?metric=`: the project scope picks who is listed, the code-count option (commits, merged
  // commits or all code contributions) picks the code count. Read by the BFF with the range.
  protected readonly selectedFilters = signal<OrgCommitFilters>(this.initialFilters);

  // Default sort: the code count (commits or code contributions, per the metric) descending.
  protected readonly sortColumn = signal<OrgAllEmployeeSortColumn>('commits');
  protected readonly sortDirection = signal<OrgAllEmployeeSortDirection>(-1);
  protected readonly limit = signal<number>(ORG_ALL_EMPLOYEES_INITIAL_LIMIT);

  // Expansion is per-(account, personKey) reset on account change → personKey is unique within an account, so keying by personKey alone is safe.
  protected readonly expansion = signal<Record<string, boolean>>({});

  // Composite `personKey::avatarUrl` tokens whose avatar image failed to load — render initials instead of a broken
  // image, declaratively (no imperative DOM access in this zoneless component). Keyed by URL (not personKey alone) so a
  // later refetch with a new/now-valid URL can render again. A plain object enables template property access (no method
  // call in the @if gate). Reset on account switch via resetAllState.
  protected readonly failedAvatarKeys = signal<Record<string, true>>({});

  // detail caches are keyed by `${accountId}:${personKey}` so an in-flight response from account A can't pollute account B's view even if the same personKey exists in both. Value types include `| undefined` so indexed access is honest in template @let bindings (tsconfig has noUncheckedIndexedAccess off).
  protected readonly detailMap = signal<Record<string, OrgAllEmployeeDetail | undefined>>({});
  protected readonly detailLoading = signal<Record<string, boolean | undefined>>({});
  protected readonly detailErrorMap = signal<Record<string, boolean | undefined>>({});

  // Retry tick — incremented to re-trigger the list fetch without changing accountId.
  protected readonly retryTrigger = signal<number>(0);

  // Cancels any in-flight detail subscription when the selected account changes; prevents stale writes and frees server work.
  private readonly detailCancel$ = new Subject<void>();

  // Seeded true: toSignal seeds EMPTY_ORG_ALL_EMPLOYEES_RESPONSE and a real fetch fires synchronously on mount.
  private readonly loadingState = signal<boolean>(true);
  private readonly fetchErrorState = signal<boolean>(false);
  // The former roster is read in every view (lfx-self-serve#4311): it is listed under "Former" and "All", and under
  // "Current" it supplies the stored activity of someone who is current again. Seeded true like `loadingState`.
  private readonly formerLoadingState = signal<boolean>(true);
  private readonly formerErrorState = signal<boolean>(false);

  private readonly showCurrent = computed(() => this.selectedEmployment() !== 'former');
  private readonly showFormer = computed(() => this.selectedEmployment() !== 'current');
  protected readonly selectedCodeFilters: Signal<OrgCodeFilterValues> = computed(() => orgCodeFilterValues(this.selectedFilters()));
  // Range and commit filters as one value, so a change to both (Clear filters, a URL step) starts a single read.
  private readonly rosterQuery = computed(() => ({ range: this.selectedRange(), filters: this.selectedFilters() }));
  private readonly rosterQuery$ = toObservable(this.rosterQuery).pipe(
    distinctUntilChanged((a, b) => a.range === b.range && sameOrgCommitFilters(a.filters, b.filters))
  );
  private readonly filterFormValue = computed(() => ({
    search: this.searchTerm(),
    foundation: this.selectedFoundationId(),
    activity: this.selectedActivity(),
    employment: this.selectedEmployment(),
    range: this.selectedRange(),
    projectScope: this.selectedCodeFilters().projectScope,
    metric: this.selectedCodeFilters().metric,
  }));
  protected readonly codeColumnLabel = computed(() => ORG_CODE_METRIC_LABEL[this.selectedFilters().metric]);
  protected readonly codeColumnTooltip = computed(() => ORG_CODE_MEASURE_DEFINITION[this.selectedCodeFilters().metric]);
  protected readonly codeUnit: Signal<OrgCountUnit> = computed(() => ORG_CODE_METRIC_UNIT[this.selectedFilters().metric]);
  protected readonly codeStatLabel = computed(() => ORG_ALL_EMPLOYEE_CODE_STAT_LABEL[this.selectedFilters().metric]);
  // The code activity option is named after the metric it filters on.
  protected readonly activityOptions: Signal<OrgAllEmployeeActivityOption[]> = computed(() =>
    ORG_ALL_EMPLOYEE_ACTIVITY_OPTIONS.map((option) => (option.value === 'code' ? { ...option, label: this.codeColumnLabel() } : option))
  );
  protected readonly statSkeletonLabels: Signal<string[]> = computed(() => [
    'Employees Active in Open Source',
    'In Governance',
    this.codeStatLabel(),
    'Event Attendees',
    'Trainees',
  ]);

  // Every view's rows are reconciled across both rosters, so the table waits for both.
  protected readonly isLoading = computed(() => this.loadingState() || this.formerLoadingState());
  // A failed former read is a full error only in the Former view. Under "All" and "Current" the current employees stay, with
  // a warning: "All" lists no former employees, and "Current" cannot fold the stored activity of someone who is current again.
  protected readonly fetchError = computed(
    () => (this.showCurrent() && this.fetchErrorState()) || (this.selectedEmployment() === 'former' && this.formerErrorState())
  );
  protected readonly formerUnavailable = computed(() => this.showCurrent() && this.formerErrorState());

  private readonly orgUid$ = toObservable(this.accountContext.selectedAccount).pipe(
    map((account) => account.uid),
    distinctUntilChanged()
  );

  protected readonly response: Signal<OrgAllEmployeesResponse> = this.initResponse();

  // Former employees are a separate read so they never enter the shared people directory the reassign pickers use.
  protected readonly formerResponse: Signal<OrgAllEmployeesResponse> = this.initFormerResponse();

  private readonly rosterRows: Signal<OrgAllEmployeeRow[]> = computed(() => this.initRosterRows());

  protected readonly stats: Signal<OrgAllEmployeeStats> = computed(() => this.initStats());

  protected readonly foundationOptions: Signal<OrgDropdownOption[]> = computed(() => this.initFoundationOptions());

  // Bake per-row derivatives (initials, avatar color) once per response; downstream filter/sort layers carry them through for free.
  protected readonly viewRows: Signal<OrgAllEmployeeRowVm[]> = computed(() => this.initViewRows());

  protected readonly filteredRows: Signal<OrgAllEmployeeRowVm[]> = computed(() => this.initFilteredRows());

  protected readonly sortedRows: Signal<OrgAllEmployeeRowVm[]> = computed(() => this.initSortedRows());

  protected readonly totalFiltered = computed(() => this.sortedRows().length);

  protected readonly visibleRows = computed(() => this.sortedRows().slice(0, this.limit()));

  protected readonly canShowMore = computed(() => this.limit() < this.totalFiltered());

  protected readonly footerCountLabel: Signal<string> = computed(() => this.initFooterCountLabel());

  protected readonly isFiltering: Signal<boolean> = computed(() => this.initIsFiltering());
  // The filter bar's "Clear filters" also covers the code-count option, which changes the count but not who is listed.
  protected readonly canClearFilters: Signal<boolean> = computed(() => this.isFiltering() || this.selectedCodeFilters().metric !== DEFAULT_ORG_CODE_MEASURE);

  // Precomputed aria-sort per column — keeps the template free of method calls in [attr.aria-sort] bindings.
  protected readonly ariaSortMap: Signal<Record<OrgAllEmployeeSortColumn, 'ascending' | 'descending' | 'none'>> = computed(() => this.initAriaSortMap());

  // Precomputed sort-icon class per column — keeps the template free of method calls in [class] bindings on sort indicators.
  protected readonly sortIconMap: Signal<Record<OrgAllEmployeeSortColumn, string>> = computed(() => this.initSortIconMap());

  // Exposed to the template so per-row @let blocks can build the composite (account, person) detail-cache key without reaching into private services.
  protected readonly currentAccountId = computed(() => this.accountContext.selectedAccount().uid);

  public constructor() {
    // Reset all state and cancel in-flight detail fetches only when the actual org uid changes; subscribing to selectedAccount directly would also fire on object-ref refreshes (e.g. Snowflake enrichment re-setting the same account) and wipe user search/filter state.
    this.orgUid$.pipe(skip(1), takeUntilDestroyed()).subscribe(() => {
      this.detailCancel$.next();
      this.resetAllState();
    });

    // Reset pagination to the initial cap when any filter/sort input changes; skip(1) drops the synchronous initial combineLatest emission.
    combineLatest([
      toObservable(this.searchTerm),
      toObservable(this.selectedFoundationId),
      toObservable(this.selectedActivity),
      toObservable(this.selectedEmployment),
      this.rosterQuery$,
      toObservable(this.sortColumn),
      toObservable(this.sortDirection),
    ])
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => this.limit.set(ORG_ALL_EMPLOYEES_INITIAL_LIMIT));

    this.route.queryParamMap
      .pipe(
        map((params) => AllEmployeesComponent.parseEmployment(params.get('employment'))),
        distinctUntilChanged(),
        takeUntilDestroyed()
      )
      .subscribe((employment) => this.selectedEmployment.set(employment));

    this.route.queryParamMap
      .pipe(
        map((params) => parseOrgLensTimeRange(params.get('range'))),
        distinctUntilChanged(),
        takeUntilDestroyed()
      )
      .subscribe((range) => this.selectedRange.set(range));

    this.route.queryParamMap
      .pipe(
        map((params) => readOrgCommitFilters((name) => params.get(name))),
        distinctUntilChanged(sameOrgCommitFilters),
        takeUntilDestroyed()
      )
      .subscribe((filters) => this.selectedFilters.set(filters));

    const controls = this.filterForm.controls;
    controls.search.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => this.searchTerm.set(value));
    controls.foundation.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => this.selectedFoundationId.set(value));
    controls.activity.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => this.selectedActivity.set(value));
    controls.employment.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => this.onEmploymentChange(value));
    controls.range.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => this.onRangeChange(value));
    controls.projectScope.valueChanges.pipe(takeUntilDestroyed()).subscribe((projectScope) => this.onFiltersChange({ projectScope }));
    controls.metric.valueChanges.pipe(takeUntilDestroyed()).subscribe((metric) => this.onFiltersChange({ metric }));
    // URL changes, Clear filters, an account switch and the handlers write the signals; mirror them back without re-firing the handlers.
    toObservable(this.filterFormValue)
      .pipe(takeUntilDestroyed())
      .subscribe((value) => {
        const current = this.filterForm.getRawValue();
        if ((Object.keys(value) as (keyof typeof value)[]).some((key) => current[key] !== value[key])) {
          this.filterForm.setValue(value, { emitEvent: false });
        }
      });

    // A default, unknown or legacy (`commitScope=merged`) commit-filter value in the URL is rewritten once the page has rendered.
    if (!orgCommitFiltersUrlMatches(this.selectedFilters(), (name) => this.route.snapshot.queryParamMap.get(name))) {
      afterNextRender(() => this.writeFiltersToUrl(this.selectedFilters()));
    }

    // The foundation list is rebuilt per view, so a foundation picked in one view may not exist in the next.
    toObservable(this.selectedEmployment)
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => this.selectedFoundationId.set(''));

    // A range change rebuilds the foundation list too; once the new range has loaded, drop a picked foundation it no longer lists.
    combineLatest([toObservable(this.foundationOptions), toObservable(this.isLoading)])
      .pipe(takeUntilDestroyed())
      .subscribe(([options, loading]) => {
        const selected = this.selectedFoundationId();
        if (!loading && selected && !options.some((option) => option.value === selected)) {
          this.selectedFoundationId.set('');
        }
      });
  }

  protected onSort(column: OrgAllEmployeeSortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.update((d) => (d === 1 ? -1 : 1));
      return;
    }
    this.sortColumn.set(column);
    // First click on the name column → ascending; first click on a numeric column → descending.
    this.sortDirection.set(column === 'name' ? 1 : -1);
  }

  protected onRowKeydown(event: KeyboardEvent, row: OrgAllEmployeeRowVm): void {
    // Synthetic UNION rows have no backing detail to fetch; the chevron is hidden and tabindex is dropped, but
    // guard here too in case a programmatic dispatch ever lands a keypress on the row.
    if (row.isSynthetic) return;
    // Ignore events bubbled from interactive descendants (e.g. the inner name <button>) so a keypress on the button doesn't also toggle the row.
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.toggleRow(row);
  }

  protected toggleRow(row: OrgAllEmployeeRowVm): void {
    if (row.isSynthetic) return;
    const open = !!this.expansion()[row.personKey];
    if (open) {
      this.expansion.update((state) => {
        const next = { ...state };
        delete next[row.personKey];
        return next;
      });
      return;
    }
    this.loadDetailIfNeeded(row);
    this.expansion.update((state) => ({ ...state, [row.personKey]: true }));
  }

  protected showAll(): void {
    this.limit.set(this.totalFiltered());
  }

  protected onPersonClick(row: OrgAllEmployeeRowVm): void {
    this.drawer.open({
      personKey: row.personKey,
      name: row.name,
      title: row.title,
      avatarUrl: row.avatarUrl,
      initials: row.initials,
      avatarColorClass: row.avatarColorClass,
      // Live-only rows come from this range and project scope's live directory; the address lookup reads that one first.
      directoryView: { range: this.selectedRange(), projectScope: this.selectedFilters().projectScope },
      isFormer: row.isFormer === true,
    });
  }

  protected onEmploymentChange(value: OrgAllEmployeeEmploymentFilter): void {
    this.selectedEmployment.set(value);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { employment: value === DEFAULT_ORG_ALL_EMPLOYEE_EMPLOYMENT ? null : value },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected onRangeChange(value: OrgLensTimeRange): void {
    this.selectedRange.set(value);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { range: orgLensTimeRangeUrlParam(value) },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected onFiltersChange(change: Partial<OrgCodeFilterValues>): void {
    const filters = orgCommitFiltersFor({ ...this.selectedCodeFilters(), ...change });
    this.selectedFilters.set(filters);
    this.writeFiltersToUrl(filters);
  }

  /** Every filter back to its default in one URL write (`tab` and other params kept). */
  protected clearFilters(): void {
    this.searchTerm.set('');
    this.selectedFoundationId.set('');
    this.selectedActivity.set('all');
    this.selectedEmployment.set(DEFAULT_ORG_ALL_EMPLOYEE_EMPLOYMENT);
    this.selectedRange.set(ORG_LENS_DEFAULT_TIME_RANGE);
    this.selectedFilters.set(DEFAULT_ORG_COMMIT_FILTERS);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { employment: null, range: orgLensTimeRangeUrlParam(ORG_LENS_DEFAULT_TIME_RANGE), ...orgCommitFiltersUrlParams(DEFAULT_ORG_COMMIT_FILTERS) },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** Record a broken avatar (by composite `personKey::avatarUrl`) so the template stops rendering the image and the initials behind it show through. */
  protected onAvatarError(avatarKey: string): void {
    this.failedAvatarKeys.update((keys) => {
      if (keys[avatarKey]) return keys;
      return { ...keys, [avatarKey]: true };
    });
  }

  protected retry(): void {
    // Drop the shared cache so the next fetch re-hits the merged live endpoint instead of replaying the failure.
    const uid = this.accountContext.selectedAccount().uid;
    if (uid) {
      this.directory.invalidate(uid);
    }
    this.retryTrigger.update((v) => v + 1);
  }

  protected retryDetail(row: OrgAllEmployeeRow): void {
    const key = this.detailKey(row.personKey);
    this.detailMap.update((s) => {
      const next = { ...s };
      delete next[key];
      return next;
    });
    this.loadDetailIfNeeded(row);
  }

  private writeFiltersToUrl(filters: OrgCommitFilters): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: orgCommitFiltersUrlParams(filters),
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /**
   * Foundations someone listed in the selected view engaged with in the selected range and project scope. The responses'
   * foundation lists name every foundation the account ever engaged with, so they only supply the labels; offering one
   * no listed row engaged with would empty the table.
   */
  private initFoundationOptions(): OrgDropdownOption[] {
    const engaged = new Set(this.rosterRows().flatMap((row) => row.engagedFoundationIds));
    const foundations = new Map<string, string>();
    for (const f of [...this.response().foundations, ...this.formerResponse().foundations]) {
      if (engaged.has(f.foundationId)) foundations.set(f.foundationId, f.foundationName);
    }
    const options = [...foundations].map(([value, label]) => ({ label, value })).sort((a, b) => a.label.localeCompare(b.label));
    return [{ label: 'All Foundations', value: '' }, ...options];
  }

  /** Tiles count the reconciled rows of the selected view, so someone who is current again carries their stored activity into them. */
  private initStats(): OrgAllEmployeeStats {
    return computeOrgAllEmployeeStats(this.rosterRows());
  }

  /**
   * Current and former rows for the selected view, reconciled by LF username in every view. Someone in the former roster can
   * also arrive from the live roster before the next warehouse build. A live row's username is only verified when
   * the row was created by a seat or an Org Lens access principal. The server merges seats, then key contacts,
   * then access, so the first source is the creating one. A row created by a key contact carries member-service's
   * resolution of the contact's address, which the server never joins on, even after a pending invite for that
   * address folds into it. Such rows are left alone here too. A key contact absorbed into a verified row is
   * joined through that row.
   * - With a live seat or key-contact role, they are current again: one row with the former row's warehouse
   *   activity plus the live sources, seats and access badge, untagged. A former name the warehouse could not
   *   supply (blank or the placeholder) and a missing title or photo are taken from the live row; an address never is.
   * - With only Org Lens access, they are still former: the former row, carrying the access badge. The server tags
   *   such a live row `isFormer`, so it is never listed as current, whichever view is selected.
   * The two warehouse rosters are disjoint within a build but cached separately, so right after a build one can
   * be stale. Someone on both is treated as current (matched on person key or the stored username): under "All"
   * they are shown once, as the stored current row, and the Former view leaves them out.
   * Rows are only reconciled once both reads belong to the selected account, so a previous account's live roster
   * never joins the next account's former employees.
   */
  private initRosterRows(): OrgAllEmployeeRow[] {
    const accountId = this.currentAccountId();
    const current = this.response();
    const formerRows = this.formerResponse().accountId === accountId ? this.formerResponse().rows : [];
    const liveRows = current.accountId === accountId ? current.rows : [];
    // Usernames are matched case-insensitively, as the server merge does.
    const formerUsernames = new Set(formerRows.map((row) => AllEmployeesComponent.usernameKey(row.lfUsername)).filter((username) => !!username));
    const storedKeys = new Set<string>();
    const liveRoles = new Map<string, OrgAllEmployeeRow>();
    const liveAccess = new Map<string, OrgAllEmployeeRow['accessBadge']>();
    const folded = new Set<OrgAllEmployeeRow>();
    for (const row of liveRows) {
      const [createdBy] = row.sources;
      if (createdBy === 'snowflake') {
        storedKeys.add(`key:${row.personKey}`);
        if (row.lfUsername) storedKeys.add(`username:${AllEmployeesComponent.usernameKey(row.lfUsername)}`);
        continue;
      }
      const liveUsername = AllEmployeesComponent.usernameKey(row.lfUsername);
      if (!liveUsername || !formerUsernames.has(liveUsername)) continue;
      if (createdBy !== 'board' && createdBy !== 'committee' && createdBy !== 'access') continue;
      if (row.sources.some((source) => source === 'board' || source === 'committee' || source === 'keyContact')) {
        liveRoles.set(liveUsername, row);
      } else {
        liveAccess.set(liveUsername, row.accessBadge);
      }
      folded.add(row);
    }
    const shownFormerRows: OrgAllEmployeeRow[] = [];
    const rejoinedRows: OrgAllEmployeeRow[] = [];
    for (const row of formerRows) {
      const formerUsername = AllEmployeesComponent.usernameKey(row.lfUsername);
      if (storedKeys.has(`key:${row.personKey}`) || (formerUsername && storedKeys.has(`username:${formerUsername}`))) continue;
      const role = formerUsername ? liveRoles.get(formerUsername) : undefined;
      const accessBadge = (formerUsername ? liveAccess.get(formerUsername) : undefined) ?? row.accessBadge;
      if (!role) {
        shownFormerRows.push({ ...row, accessBadge });
        continue;
      }
      rejoinedRows.push({
        ...row,
        ...AllEmployeesComponent.liveDisplayFields(row, role),
        isFormer: false,
        sources: [...new Set([...row.sources, ...role.sources])],
        seatsCount: role.seatsCount,
        boardSeatsCount: role.boardSeatsCount,
        committeeSeatsCount: role.committeeSeatsCount,
        accessBadge: role.accessBadge ?? accessBadge,
      });
    }
    // `liveRows` is the account-checked current list: after an org switch the previous org's rows must not show (or feed the foundation dropdown) until the new fetch lands.
    const currentRows = this.showCurrent() ? [...liveRows.filter((row) => !row.isFormer && !folded.has(row)), ...rejoinedRows] : [];
    return this.showFormer() ? [...currentRows, ...shownFormerRows] : currentRows;
  }

  private initViewRows(): OrgAllEmployeeRowVm[] {
    // The live directory endpoint merges access principals into `rows` server-side and stamps the badge
    // on each one, so there is neither a client-side synthetic UNION nor an address join here.
    const rows = this.rosterRows();
    return rows.map<OrgAllEmployeeRowVm>((row) => ({
      ...row,
      initials: AllEmployeesComponent.computeInitials(row.name),
      avatarColorClass: AllEmployeesComponent.computeAvatarColorClass(row.personKey),
      avatarKey: row.avatarUrl ? `${row.personKey}::${row.avatarUrl}` : '',
      access: AllEmployeesComponent.resolveAccessBadge(row),
      // Live-only people (no `snowflake` source) carry a synthetic `live-` personKey with no stored Snowflake
      // detail, so they must not be chevron-expandable or trigger a detail fetch — mark them synthetic
      // regardless of which live source (access / board / committee / keyContact) added them.
      isSynthetic: !row.sources.includes('snowflake'),
      rowClass: AllEmployeesComponent.rowClassActivity,
    }));
  }

  private initFilteredRows(): OrgAllEmployeeRowVm[] {
    const rows = this.viewRows();
    const q = this.searchTerm().trim().toLowerCase();
    const foundationId = this.selectedFoundationId();
    const activity = this.selectedActivity();

    return rows.filter((row) => {
      if (q) {
        const inName = row.name.toLowerCase().includes(q);
        const inTitle = (row.title ?? '').toLowerCase().includes(q);
        const inEmail = (row.email ?? '').toLowerCase().includes(q);
        if (!inName && !inTitle && !inEmail) return false;
      }
      if (foundationId && !row.engagedFoundationIds.includes(foundationId)) return false;
      if (activity !== 'all') {
        const matches =
          (activity === 'governance' && row.seatsCount > 0) ||
          (activity === 'code' && row.commitsCount > 0) ||
          (activity === 'events' && row.eventsCount > 0) ||
          (activity === 'training' && row.coursesCount > 0);
        if (!matches) return false;
      }
      return true;
    });
  }

  private initSortedRows(): OrgAllEmployeeRowVm[] {
    const filtered = this.filteredRows();
    const col = this.sortColumn();
    const dir = this.sortDirection();
    const copy = [...filtered];
    copy.sort((a, b) => {
      if (col === 'name') {
        return a.name.localeCompare(b.name) * dir;
      }
      const va = AllEmployeesComponent.numericSortValue(a, col);
      const vb = AllEmployeesComponent.numericSortValue(b, col);
      if (va !== vb) return (va - vb) * dir;
      return a.name.localeCompare(b.name);
    });
    return copy;
  }

  private initFooterCountLabel(): string {
    const visible = Math.min(this.limit(), this.totalFiltered());
    return `Showing ${visible.toLocaleString()} of ${this.totalFiltered().toLocaleString()}`;
  }

  private initIsFiltering(): boolean {
    return (
      this.searchTerm().trim().length > 0 ||
      !!this.selectedFoundationId() ||
      this.selectedActivity() !== 'all' ||
      this.selectedEmployment() !== DEFAULT_ORG_ALL_EMPLOYEE_EMPLOYMENT ||
      this.selectedRange() !== ORG_LENS_DEFAULT_TIME_RANGE ||
      this.selectedFilters().projectScope !== DEFAULT_ORG_COMMIT_FILTERS.projectScope
    );
  }

  private initAriaSortMap(): Record<OrgAllEmployeeSortColumn, 'ascending' | 'descending' | 'none'> {
    const active = this.sortColumn();
    const direction: 'ascending' | 'descending' = this.sortDirection() === 1 ? 'ascending' : 'descending';
    return {
      name: active === 'name' ? direction : 'none',
      seats: active === 'seats' ? direction : 'none',
      commits: active === 'commits' ? direction : 'none',
      events: active === 'events' ? direction : 'none',
      courses: active === 'courses' ? direction : 'none',
      access: active === 'access' ? direction : 'none',
    };
  }

  private initSortIconMap(): Record<OrgAllEmployeeSortColumn, string> {
    const active = this.sortColumn();
    const activeIcon = this.sortDirection() === 1 ? 'fa-light fa-sort-up' : 'fa-light fa-sort-down';
    const iconFor = (col: OrgAllEmployeeSortColumn): string => (active === col ? activeIcon : 'fa-light fa-sort');
    return {
      name: iconFor('name'),
      seats: iconFor('seats'),
      commits: iconFor('commits'),
      events: iconFor('events'),
      courses: iconFor('courses'),
      access: iconFor('access'),
    };
  }

  private initResponse(): Signal<OrgAllEmployeesResponse> {
    return toSignal(
      combineLatest([this.orgUid$, this.rosterQuery$, toObservable(this.retryTrigger)]).pipe(
        tap(() => {
          this.loadingState.set(true);
          this.fetchErrorState.set(false);
        }),
        switchMap(([orgUid, { range, filters }]) => {
          if (!orgUid) {
            this.loadingState.set(false);
            return of(EMPTY_ORG_ALL_EMPLOYEES_RESPONSE);
          }
          return this.loadRoster(orgUid, range, filters);
        })
      ),
      { initialValue: EMPTY_ORG_ALL_EMPLOYEES_RESPONSE }
    );
  }

  /** The former roster for the selected range and filters, read in every view; on the server it fetches nothing and keeps the skeleton, like `loadRoster`. */
  private initFormerResponse(): Signal<OrgAllEmployeesResponse> {
    return toSignal(
      combineLatest([this.orgUid$, this.rosterQuery$, toObservable(this.retryTrigger)]).pipe(
        switchMap(([orgUid, { range, filters }]) => {
          if (!orgUid) {
            this.formerLoadingState.set(false);
            return of(EMPTY_ORG_ALL_EMPLOYEES_RESPONSE);
          }
          if (!isPlatformBrowser(this.platformId)) {
            return EMPTY;
          }
          this.formerLoadingState.set(true);
          this.formerErrorState.set(false);
          return this.dataService.getFormerEmployees(orgUid, range, filters).pipe(
            take(1),
            catchError((error: unknown) => {
              console.error('Failed to load former employees:', error);
              this.formerErrorState.set(true);
              return of(EMPTY_ORG_ALL_EMPLOYEES_RESPONSE);
            }),
            finalize(() => this.formerLoadingState.set(false))
          );
        })
      ),
      { initialValue: EMPTY_ORG_ALL_EMPLOYEES_RESPONSE }
    );
  }

  /**
   * Two-phase roster load. The Snowflake roster answers in well under a second, while the live merge
   * (access principals + committee-service seats) can take far longer on a large org, so both are
   * requested at once: rows and stats paint from Snowflake as soon as it answers, and the live merge
   * replaces them wholesale when it lands — one response at a time, never both, so rows are never
   * duplicated. A Snowflake answer arriving after live has landed is dropped, never shown over it.
   *
   * A live failure after Snowflake rendered keeps the Snowflake rows (no error state); a Snowflake
   * failure waits for live; only both failing shows the error state.
   *
   * When the server's own stored-roster read fails, the live merge answers with live sources only.
   * Such a response (no row sourced from `snowflake`) never replaces the stored roster on its own
   * authority: it is held until the Snowflake phase settles, then dropped as a live failure if
   * Snowflake rendered rows, or shown if Snowflake was empty or failed. Holding matters because the
   * directory service replays a cached response synchronously, ahead of Snowflake. Follow-up: the
   * server should flag the response as degraded and not cache it, instead of the client inferring it
   * from row provenance.
   *
   * On the server this fetches nothing and leaves the skeleton; the browser starts both requests
   * after hydration. These reads have not been observed holding SSR in prod, but the cause is not
   * established, so this is guarded like org-groups (#2063).
   */
  private loadRoster(orgUid: string, range: OrgLensTimeRange, filters: OrgCommitFilters): Observable<OrgAllEmployeesResponse> {
    if (!isPlatformBrowser(this.platformId)) {
      return EMPTY;
    }

    const state = {
      snowflake: 'pending' as 'pending' | 'rows' | 'empty' | 'failed',
      heldLive: null as OrgAllEmployeesResponse | null,
      liveLanded: false,
      liveFailed: false,
    };
    const bothFailed = (): Observable<OrgAllEmployeesResponse> => {
      this.fetchErrorState.set(true);
      this.loadingState.set(false);
      return of(EMPTY_ORG_ALL_EMPLOYEES_RESPONSE);
    };
    const renderLive = (res: OrgAllEmployeesResponse): Observable<OrgAllEmployeesResponse> => {
      state.heldLive = null;
      state.liveLanded = true;
      this.loadingState.set(false);
      return of(res);
    };
    const missingStoredRoster = (): Error => new Error('Live directory is missing the stored roster');

    const snowflake$ = this.dataService.getAllEmployees(orgUid, range, filters).pipe(
      take(1),
      mergeMap((res) => {
        if (state.liveLanded) return EMPTY;
        state.snowflake = res.rows.length > 0 ? 'rows' : 'empty';
        if (state.heldLive) {
          if (state.snowflake === 'empty') return renderLive(state.heldLive);
          state.heldLive = null;
          state.liveFailed = true;
          console.error('Failed to load org people directory (live):', missingStoredRoster());
        }
        this.loadingState.set(false);
        return of(res);
      }),
      catchError((error: unknown) => {
        console.error('Failed to load org people roster (Snowflake):', error);
        state.snowflake = 'failed';
        if (state.heldLive) return renderLive(state.heldLive);
        return state.liveFailed ? bothFailed() : EMPTY;
      })
    );
    const live$ = this.directory.getDirectory(orgUid, range, filters).pipe(
      take(1),
      mergeMap((res) => {
        if (!res.rows.some((row) => row.sources.includes('snowflake'))) {
          if (state.snowflake === 'pending') {
            state.heldLive = res;
            return EMPTY;
          }
          if (state.snowflake === 'rows') return throwError(missingStoredRoster);
        }
        return renderLive(res);
      }),
      catchError((error: unknown) => {
        console.error('Failed to load org people directory (live):', error);
        state.liveFailed = true;
        return state.snowflake === 'failed' ? bothFailed() : EMPTY;
      })
    );
    return merge(snowflake$, live$);
  }

  private loadDetailIfNeeded(row: OrgAllEmployeeRow): void {
    const orgUid = this.accountContext.selectedAccount().uid;
    if (!orgUid) return;
    const key = this.detailKey(row.personKey);
    if (this.detailMap()[key]) return;
    if (this.detailLoading()[key]) return;

    // Clear any stale error from a prior failed fetch so collapse+re-expand (which bypasses retryDetail) also recovers cleanly.
    this.clearDetailError(key);
    this.detailLoading.update((state) => ({ ...state, [key]: true }));
    this.dataService
      .getEmployeeDetail(orgUid, row.personKey)
      .pipe(
        take(1),
        takeUntil(this.detailCancel$),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.clearDetailLoading(key))
      )
      .subscribe({
        next: (detail) => this.detailMap.update((state) => ({ ...state, [key]: detail })),
        error: () => this.detailErrorMap.update((state) => ({ ...state, [key]: true })),
      });
  }

  /** Composite (org, person) key — keeps per-org detail caches isolated even across rapid account switches. */
  private detailKey(personKey: string): string {
    return `${this.accountContext.selectedAccount().uid}:${personKey}`;
  }

  private clearDetailLoading(key: string): void {
    this.detailLoading.update((state) => {
      const next = { ...state };
      delete next[key];
      return next;
    });
  }

  private clearDetailError(key: string): void {
    this.detailErrorMap.update((state) => {
      if (!state[key]) return state;
      const next = { ...state };
      delete next[key];
      return next;
    });
  }

  private resetAllState(): void {
    this.searchTerm.set('');
    this.selectedFoundationId.set('');
    this.selectedActivity.set('all');
    this.sortColumn.set('commits');
    this.sortDirection.set(-1);
    this.limit.set(ORG_ALL_EMPLOYEES_INITIAL_LIMIT);
    this.expansion.set({});
    this.failedAvatarKeys.set({});
    this.detailMap.set({});
    this.detailLoading.set({});
    this.detailErrorMap.set({});
  }

  private static numericSortValue(row: OrgAllEmployeeRowVm, column: Exclude<OrgAllEmployeeSortColumn, 'name'>): number {
    switch (column) {
      case 'seats':
        return row.seatsCount;
      case 'commits':
        return row.commitsCount;
      case 'events':
        return row.eventsCount;
      case 'courses':
        return row.coursesCount;
      case 'access':
        return AllEmployeesComponent.accessRank(row.access);
    }
  }

  /** Sort rank for the Org Lens Access badge: Admin > Viewer > Invited > no access. */
  private static accessRank(access: OrgAllEmployeeRowVm['access']): number {
    switch (access) {
      case 'admin':
        return 3;
      case 'viewer':
        return 2;
      case 'invited':
        return 1;
      default:
        return 0;
    }
  }

  /**
   * The access badge comes solely from the server, which knows which principal it merged into each
   * person. There is deliberately no address-based fallback: two people can share an address while
   * the merge keeps them as separate rows, so a lookup by address would give one person's role to
   * the other. Every principal is attributed to exactly one row (an unmatched one becomes its own),
   * so a fallback could never add a badge the server omitted — only a wrong one.
   */
  private static resolveAccessBadge(row: OrgAllEmployeeRow): OrgAccessBadgeState | null {
    return row.accessBadge ?? null;
  }

  /**
   * Display fields for a rejoined person: the former row's own values, filled from the live row where the warehouse had
   * none. The live row's name falls back to an address when the person has no name, so only a name built from its name
   * parts, or one that is not an address, replaces the former placeholder.
   */
  private static liveDisplayFields(
    former: OrgAllEmployeeRow,
    live: OrgAllEmployeeRow
  ): Pick<OrgAllEmployeeRow, 'name' | 'firstName' | 'lastName' | 'title' | 'avatarUrl'> {
    const formerName = former.name.trim();
    const liveName = [live.firstName, live.lastName].filter(Boolean).join(' ').trim() || (live.name.includes('@') ? '' : live.name.trim());
    const takeLiveName = (!formerName || formerName === ORG_PEOPLE_UNKNOWN_MEMBER_NAME) && !!liveName;
    return {
      name: takeLiveName ? liveName : former.name,
      firstName: takeLiveName ? live.firstName : former.firstName,
      lastName: takeLiveName ? live.lastName : former.lastName,
      title: former.title || live.title,
      avatarUrl: former.avatarUrl || live.avatarUrl,
    };
  }

  /** `?employment=` value → filter; anything unknown (or absent) is the default view. */
  private static parseEmployment(value: string | null): OrgAllEmployeeEmploymentFilter {
    return ORG_ALL_EMPLOYEE_EMPLOYMENT_OPTIONS.find((option) => option.value === value)?.value ?? DEFAULT_ORG_ALL_EMPLOYEE_EMPLOYMENT;
  }

  /** Username identity key, trimmed and lowercased like the server merge's; empty when there is none. */
  private static usernameKey(username: string | null | undefined): string {
    return (username ?? '').trim().toLowerCase();
  }

  private static computeInitials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  }

  private static computeAvatarColorClass(personKey: string): string {
    const palette = ['bg-blue-600', 'bg-violet-600', 'bg-emerald-600', 'bg-amber-600', 'bg-red-600', 'bg-gray-600'];
    const idx = AllEmployeesComponent.hashChar(personKey) % palette.length;
    return palette[idx];
  }

  private static hashChar(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    return hash;
  }
}
