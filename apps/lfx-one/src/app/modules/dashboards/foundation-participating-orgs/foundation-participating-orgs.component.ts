// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, linkedSignal, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { MenuComponent } from '@components/menu/menu.component';
import { CardComponent } from '@components/card/card.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { PageHeaderComponent } from '@components/page-header/page-header.component';
import { SelectComponent } from '@components/select/select.component';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';
import { TableComponent } from '@components/table/table.component';
import {
  EMPTY_FOUNDATION_PARTICIPATING_ORGS_PAGE,
  FOUNDATION_PARTICIPATING_ORGS_BREAKDOWN_TOP_N,
  FOUNDATION_PARTICIPATING_ORGS_COMMIT_SHARE_TOOLTIP,
  FOUNDATION_PARTICIPATING_ORGS_DEFAULT_RANGE,
  FOUNDATION_PARTICIPATING_ORGS_MAX_SEARCH_LENGTH,
  FOUNDATION_PARTICIPATING_ORGS_PAGE_SIZE,
  FOUNDATION_PARTICIPATING_ORGS_RANGE_LABELS,
  FOUNDATION_PARTICIPATING_ORGS_RANGE_OPTIONS,
  FOUNDATION_PARTICIPATING_ORGS_SEARCH_DEBOUNCE_MS,
  FOUNDATION_PARTICIPATING_ORGS_UNAVAILABLE_MESSAGE,
  PROJECT_PARTICIPATING_ORGS_DEFAULT_SORT,
  PROJECT_PARTICIPATING_ORGS_DEFAULT_SORT_DIR,
  PROJECT_PARTICIPATING_ORGS_SEGMENTS,
  PROJECT_PARTICIPATING_ORGS_SORT_FIELDS,
} from '@lfx-one/shared/constants';
import type {
  FilterPillOption,
  FoundationParticipatingOrgBreakdownState,
  FoundationParticipatingOrgBreakdownView,
  FoundationParticipatingOrgRowVm,
  FoundationParticipatingOrgsExportFilters,
  FoundationParticipatingOrgsFilterChip,
  FoundationParticipatingOrgsFilterChipId,
  FoundationParticipatingOrgsExportKind,
  FoundationParticipatingOrgsPage,
  FoundationParticipatingOrgsProject,
  FoundationParticipatingOrgsQuery,
  FoundationParticipatingOrgsRange,
  FoundationParticipatingOrgsSegment,
  FoundationParticipatingOrgsSortDirection,
  FoundationParticipatingOrgsSortField,
  FoundationParticipatingOrgsSummary,
  FoundationParticipatingOrgsViewState,
  MembershipTierClass,
  StatCardItem,
} from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@services/project-context.service';
import { MenuItem } from 'primeng/api';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, filter, finalize, map, of, pairwise, switchMap, take, tap } from 'rxjs';

import { decorateFoundationOrgRow, decorateProjectLine, groupProjectOptions, splitBreakdown } from './foundation-participating-orgs.util';
import { FoundationParticipatingOrgsService } from './services/foundation-participating-orgs.service';

/**
 * Foundation Lens → Participating Companies (#5697): every company contributing to any project of the foundation,
 * with foundation totals summed from project activity and a per-project breakdown on demand. Server-paged, -sorted
 * and -filtered; access is enforced by the BFF (executive director of the foundation, or LF staff).
 */
@Component({
  selector: 'lfx-foundation-participating-orgs',
  imports: [
    DecimalPipe,
    NgTemplateOutlet,
    ReactiveFormsModule,
    MenuComponent,
    SkeletonModule,
    TooltipModule,
    ButtonComponent,
    CardComponent,
    CardTabsBarComponent,
    EmptyStateComponent,
    InputTextComponent,
    PageHeaderComponent,
    SelectComponent,
    StatCardGridComponent,
    TableComponent,
  ],
  templateUrl: './foundation-participating-orgs.component.html',
})
export class FoundationParticipatingOrgsComponent {
  private readonly projectContextService = inject(ProjectContextService);
  private readonly dataService = inject(FoundationParticipatingOrgsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly rangeOptions = [...FOUNDATION_PARTICIPATING_ORGS_RANGE_OPTIONS];
  protected readonly maxSearchLength = FOUNDATION_PARTICIPATING_ORGS_MAX_SEARCH_LENGTH;
  protected readonly commitShareTooltip = FOUNDATION_PARTICIPATING_ORGS_COMMIT_SHARE_TOOLTIP;

  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
    project: new FormControl<string | null>(null),
    tier: new FormControl<MembershipTierClass | null>(null),
    range: new FormControl<FoundationParticipatingOrgsRange>(FOUNDATION_PARTICIPATING_ORGS_DEFAULT_RANGE, { nonNullable: true }),
  });

  /** One filter control per expanded company, added when its row opens and kept while the scope holds. */
  protected readonly breakdownFilterForm = new FormGroup<Record<string, FormControl<string>>>({});

  protected readonly segment = signal<FoundationParticipatingOrgsSegment>('all');
  protected readonly sort = signal<FoundationParticipatingOrgsSortField>(PROJECT_PARTICIPATING_ORGS_DEFAULT_SORT);
  protected readonly dir = signal<FoundationParticipatingOrgsSortDirection>(PROJECT_PARTICIPATING_ORGS_DEFAULT_SORT_DIR);
  protected readonly pageSize = signal<number>(FOUNDATION_PARTICIPATING_ORGS_PAGE_SIZE);
  protected readonly exporting = signal(false);
  protected readonly expanded = signal<ReadonlySet<string>>(new Set());
  protected readonly breakdowns = signal<Record<string, FoundationParticipatingOrgBreakdownState>>({});
  protected readonly projectsFailed = signal(false);
  private readonly retryTrigger = signal(0);
  private readonly projectsRetryTrigger = signal(0);
  private breakdownScope = '';

  private readonly summaryLoadingState = signal(true);
  private readonly summaryErrorStatus = signal<number | null>(null);
  private readonly pageLoadingState = signal(true);
  private readonly pageErrorStatus = signal<number | null>(null);
  protected readonly summaryLoading = this.summaryLoadingState.asReadonly();
  protected readonly pageLoading = this.pageLoadingState.asReadonly();

  private readonly foundation = computed(() => this.projectContextService.selectedFoundation());
  protected readonly slug = computed(() => this.foundation()?.slug ?? '');
  protected readonly range: Signal<FoundationParticipatingOrgsRange> = toSignal(this.filterForm.controls.range.valueChanges, {
    initialValue: this.filterForm.controls.range.value,
  });
  private readonly search: Signal<string> = this.initSearch();
  protected readonly projectSlug: Signal<string | null> = toSignal(this.filterForm.controls.project.valueChanges, { initialValue: null });
  protected readonly tier: Signal<MembershipTierClass | null> = toSignal(this.filterForm.controls.tier.valueChanges, { initialValue: null });

  /** Switching foundation, or any filter, tab, range or sort change, returns the table to its first page. */
  protected readonly offset = linkedSignal({
    source: () => `${this.slug()}|${this.range()}|${this.segment()}|${this.search()}|${this.projectSlug()}|${this.tier()}|${this.sort()}|${this.dir()}`,
    computation: () => 0,
  });

  private readonly query: Signal<FoundationParticipatingOrgsQuery> = computed(() => ({
    ...this.exportFilters(),
    pageSize: this.pageSize(),
    offset: this.offset(),
  }));

  private readonly projectsState: Signal<{ slug: string; projects: FoundationParticipatingOrgsProject[] }> = this.initProjects();
  protected readonly projects = computed(() => {
    const state = this.projectsState();
    return state.slug === this.slug() ? state.projects : [];
  });
  protected readonly projectOptions = computed(() => groupProjectOptions(this.projects()));
  protected readonly selectedProjectName = computed(() => this.projects().find((project) => project.slug === this.projectSlug())?.name ?? null);

  private readonly summaryState: Signal<{ slug: string; summary: FoundationParticipatingOrgsSummary | null }> = this.initSummary();
  private readonly pageState: Signal<{ slug: string; page: FoundationParticipatingOrgsPage }> = this.initPage();
  protected readonly summary: Signal<FoundationParticipatingOrgsSummary | null> = computed(() => {
    const state = this.summaryState();
    return state.slug === this.slug() ? state.summary : null;
  });
  protected readonly page: Signal<FoundationParticipatingOrgsPage> = computed(() => {
    const state = this.pageState();
    return state.slug === this.slug() ? state.page : EMPTY_FOUNDATION_PARTICIPATING_ORGS_PAGE;
  });

  protected readonly viewState: Signal<FoundationParticipatingOrgsViewState> = computed(() => this.initViewState());
  protected readonly rows: Signal<FoundationParticipatingOrgRowVm[]> = computed(() => this.page().rows.map(decorateFoundationOrgRow));
  protected readonly showSkeleton = computed(() => this.pageLoading() && this.page().rows.length === 0);
  protected readonly refreshing = computed(() => this.pageLoading() && this.page().rows.length > 0);
  protected readonly totalRecords = computed(() => this.page().totalRecords);
  protected readonly rangeLabel = computed(() => FOUNDATION_PARTICIPATING_ORGS_RANGE_LABELS[this.range()]);
  protected readonly scopeLabel = computed(() => {
    const summary = this.summary();
    return this.selectedProjectName() ?? `All ${summary?.projectCount ?? ''} projects`.replace('  ', ' ');
  });
  protected readonly foundationName = computed(() => this.summary()?.foundationName ?? this.foundation()?.name ?? 'this foundation');
  protected readonly dataLine = computed(() => this.initDataLine());
  protected readonly subtitle = computed(() => this.initSubtitle());
  /** Tier classes the foundation holds, from its roster; the last known list stays while a new summary loads. */
  protected readonly tierOptions = linkedSignal<FoundationParticipatingOrgsSummary | null, { label: MembershipTierClass; value: MembershipTierClass }[]>({
    source: () => this.summary(),
    computation: (summary, previous) => (summary ? summary.availableTiers.map((tier) => ({ label: tier, value: tier })) : (previous?.value ?? [])),
  });
  protected readonly tiles: Signal<StatCardItem[]> = computed(() => this.initTiles());
  protected readonly tabs: Signal<FilterPillOption[]> = computed(() => this.initTabs());
  protected readonly exportMenu: Signal<MenuItem[]> = computed(() => this.initExportMenu());
  protected readonly activeFilters = computed(() => this.initActiveFilters());
  protected readonly hasActiveFilters = computed(() => this.activeFilters().length > 0);
  protected readonly breakdownViews: Signal<Record<string, FoundationParticipatingOrgBreakdownView>> = computed(() => this.initBreakdownViews());
  protected readonly sortIconMap: Signal<Record<FoundationParticipatingOrgsSortField, string>> = computed(() => this.initSortIconMap());
  protected readonly ariaSortMap: Signal<Record<FoundationParticipatingOrgsSortField, 'ascending' | 'descending' | 'none'>> = computed(() =>
    this.initAriaSortMap()
  );
  protected readonly errorSubtitle = computed(() =>
    this.summaryErrorStatus() === 503 || this.pageErrorStatus() === 503 ? FOUNDATION_PARTICIPATING_ORGS_UNAVAILABLE_MESSAGE : 'Please try again.'
  );
  protected readonly noActivityRange = computed(() => (this.range() === 'all' ? null : this.rangeLabel()));

  public constructor() {
    // A project slug belongs to one foundation, so switching foundation drops the project scope.
    toObservable(this.slug)
      .pipe(
        pairwise(),
        filter(([previous, current]) => previous !== '' && previous !== current),
        takeUntilDestroyed()
      )
      .subscribe(() => {
        this.filterForm.controls.project.setValue(null);
        this.filterForm.controls.tier.setValue(null);
      });

    // A tier the foundation's roster does not hold has dropped out of the picker, so it stops filtering too.
    toObservable(this.summary)
      .pipe(
        filter((summary): summary is FoundationParticipatingOrgsSummary => summary !== null),
        takeUntilDestroyed()
      )
      .subscribe((summary) => {
        const tier = this.filterForm.controls.tier.value;
        if (tier && !summary.availableTiers.includes(tier)) this.filterForm.controls.tier.setValue(null);
      });
  }

  protected onSegmentChange(id: string): void {
    const segment = PROJECT_PARTICIPATING_ORGS_SEGMENTS.find((value) => value === id);
    if (!segment) return;
    // Tier narrows to members of one tier, so it has no meaning on the Non-Members tab.
    if (segment === 'non_members') {
      this.filterForm.controls.tier.setValue(null);
      this.filterForm.controls.tier.disable();
    } else {
      this.filterForm.controls.tier.enable();
    }
    this.segment.set(segment);
  }

  protected onSort(field: FoundationParticipatingOrgsSortField): void {
    if (this.sort() === field) {
      this.dir.update((dir) => (dir === 'asc' ? 'desc' : 'asc'));
      return;
    }
    this.sort.set(field);
    this.dir.set(field === 'name' || field === 'tier' ? 'asc' : 'desc');
  }

  protected onTablePage(event: { first?: number; rows?: number }): void {
    this.pageSize.set(event.rows ?? this.pageSize());
    this.offset.set(event.first ?? 0);
  }

  protected clearProject(): void {
    this.filterForm.controls.project.setValue(null);
  }

  protected clearFilters(): void {
    this.filterForm.patchValue({ search: '', project: null, tier: null, range: FOUNDATION_PARTICIPATING_ORGS_DEFAULT_RANGE });
  }

  protected removeFilter(id: FoundationParticipatingOrgsFilterChipId): void {
    switch (id) {
      case 'search':
        this.filterForm.controls.search.setValue('');
        break;
      case 'project':
        this.filterForm.controls.project.setValue(null);
        break;
      case 'tier':
        this.filterForm.controls.tier.setValue(null);
        break;
      case 'range':
        this.filterForm.controls.range.setValue(FOUNDATION_PARTICIPATING_ORGS_DEFAULT_RANGE);
        break;
    }
  }

  protected showAllTime(): void {
    this.filterForm.controls.range.setValue('all');
  }

  protected retry(): void {
    this.retryTrigger.update((value) => value + 1);
    this.projectsRetryTrigger.update((value) => value + 1);
  }

  protected retryProjects(): void {
    this.projectsRetryTrigger.update((value) => value + 1);
  }

  protected export(kind: FoundationParticipatingOrgsExportKind): void {
    if (!this.slug() || this.exporting()) return;
    this.exporting.set(true);
    this.dataService
      .exportCsv(this.exportFilters(), kind)
      .pipe(
        take(1),
        finalize(() => this.exporting.set(false))
      )
      .subscribe();
  }

  /** Opens or closes a company's project breakdown; it loads on first open, not with the page. */
  protected toggleRow(key: string): void {
    const next = new Set(this.expanded());
    if (next.has(key)) {
      next.delete(key);
      this.expanded.set(next);
      return;
    }
    next.add(key);
    this.expanded.set(next);
    this.ensureBreakdownFilter(key);
    if (!this.breakdowns()[key]) this.loadBreakdown(key);
  }

  protected retryBreakdown(key: string): void {
    this.loadBreakdown(key);
  }

  protected showAllProjects(key: string): void {
    this.patchBreakdown(key, { showAll: true });
  }

  private initSearch(): Signal<string> {
    return toSignal(
      this.filterForm.controls.search.valueChanges.pipe(
        debounceTime(FOUNDATION_PARTICIPATING_ORGS_SEARCH_DEBOUNCE_MS),
        map((value) => value.trim().slice(0, FOUNDATION_PARTICIPATING_ORGS_MAX_SEARCH_LENGTH)),
        distinctUntilChanged()
      ),
      { initialValue: '' }
    );
  }

  private initProjects(): Signal<{ slug: string; projects: FoundationParticipatingOrgsProject[] }> {
    return toSignal(
      combineLatest([
        toObservable(computed(() => ({ slug: this.slug(), range: this.range() }))).pipe(
          filter(({ slug }) => slug.length > 0),
          distinctUntilChanged((a, b) => a.slug === b.slug && a.range === b.range)
        ),
        toObservable(this.projectsRetryTrigger),
      ]).pipe(
        tap(() => this.projectsFailed.set(false)),
        switchMap(([{ slug, range }]) =>
          this.dataService.getProjects(slug, range).pipe(
            map((response) => ({ slug, projects: response.projects })),
            catchError(() => {
              this.projectsFailed.set(true);
              return of({ slug, projects: [] as FoundationParticipatingOrgsProject[] });
            })
          )
        )
      ),
      { initialValue: { slug: '', projects: [] } }
    );
  }

  private initSummary(): Signal<{ slug: string; summary: FoundationParticipatingOrgsSummary | null }> {
    return toSignal(
      combineLatest([
        toObservable(
          computed(() => ({ slug: this.slug(), range: this.range(), projectSlug: this.projectSlug(), search: this.search(), tier: this.tier() }))
        ).pipe(
          filter(({ slug }) => slug.length > 0),
          distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
        ),
        toObservable(this.retryTrigger),
      ]).pipe(
        tap(() => {
          this.summaryLoadingState.set(true);
          this.summaryErrorStatus.set(null);
        }),
        switchMap(([{ slug, range, projectSlug, search, tier }]) =>
          this.dataService
            .getSummary({ foundationSlug: slug, range, projectSlug: projectSlug ?? undefined, search: search || undefined, tier: tier ?? undefined })
            .pipe(
              map((response) => ({ slug, summary: response.summary })),
              tap(() => this.summaryLoadingState.set(false)),
              catchError((error: unknown) => {
                this.summaryErrorStatus.set(error instanceof HttpErrorResponse ? error.status : 0);
                this.summaryLoadingState.set(false);
                return of({ slug, summary: null });
              })
            )
        )
      ),
      { initialValue: { slug: '', summary: null } }
    );
  }

  private initPage(): Signal<{ slug: string; page: FoundationParticipatingOrgsPage }> {
    return toSignal(
      combineLatest([
        toObservable(this.query).pipe(
          filter(({ foundationSlug }) => foundationSlug.length > 0),
          distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
        ),
        toObservable(this.retryTrigger),
      ]).pipe(
        tap(([query]) => {
          this.pageLoadingState.set(true);
          this.pageErrorStatus.set(null);
          // Breakdowns are per range and scope, so a change of either starts them over.
          if (this.breakdownScope !== `${query.foundationSlug}|${query.range}`) {
            this.breakdownScope = `${query.foundationSlug}|${query.range}`;
            this.breakdowns.set({});
            this.expanded.set(new Set());
            // The filter text belongs to the cache just dropped, so the controls go with it.
            this.clearBreakdownFilters();
          }
        }),
        switchMap(([query]) =>
          this.dataService.getPage(query).pipe(
            map((page) => ({ slug: query.foundationSlug, page })),
            tap(() => this.pageLoadingState.set(false)),
            catchError((error: unknown) => {
              this.pageErrorStatus.set(error instanceof HttpErrorResponse ? error.status : 0);
              this.pageLoadingState.set(false);
              return of({ slug: query.foundationSlug, page: EMPTY_FOUNDATION_PARTICIPATING_ORGS_PAGE });
            })
          )
        )
      ),
      { initialValue: { slug: '', page: EMPTY_FOUNDATION_PARTICIPATING_ORGS_PAGE } }
    );
  }

  private initBreakdownViews(): Record<string, FoundationParticipatingOrgBreakdownView> {
    const scope = this.projectSlug();
    return Object.fromEntries(
      Object.entries(this.breakdowns()).map(([key, state]) => {
        if (!state.data) return [key, { state, total: null, lines: [], other: null, canFilter: false }];
        const { shown, other } = splitBreakdown(state.data.projects, state.showAll, state.filter, scope);
        return [
          key,
          {
            state,
            total: decorateProjectLine(state.data.total),
            lines: shown.map((line) => ({ ...decorateProjectLine(line), inView: scope === line.projectSlug })),
            other,
            canFilter: state.data.projects.length > FOUNDATION_PARTICIPATING_ORGS_BREAKDOWN_TOP_N,
          },
        ];
      })
    );
  }

  /** Demo figures are named as such and dated by generation; only warehouse figures claim LFX Insights as their source. */
  private initDataLine(): string {
    const summary = this.summary();
    // Nothing is claimed about the source until a summary says what the figures are.
    if (!summary) return '';
    const date = formatDate(summary.asOfDate);
    return summary.dataSource === 'demo' ? `Fictional demo data, generated ${date} · not from LFX Insights` : `Data through ${date} · Source: LFX Insights`;
  }

  /** A 403 on either read is the viewer lacking access to the foundation; any other failure (503 included) is retryable. */
  private initViewState(): FoundationParticipatingOrgsViewState {
    const statuses = [this.summaryErrorStatus(), this.pageErrorStatus()];
    if (statuses.includes(403)) return 'forbidden';
    if (statuses.some((status) => status !== null)) return 'error';
    if (!this.summaryLoading() && this.summary() === null) return 'empty';
    return 'ready';
  }

  private initSubtitle(): string {
    const name = this.foundationName();
    const count = this.summary()?.projectCount;
    const projects = count === undefined ? 'all its' : `all ${count}`;
    return `Every company contributing to ${name} projects, ranked by activity and split by ${name} membership. Foundation totals add up activity across ${projects} projects.`;
  }

  private initTiles(): StatCardItem[] {
    const summary = this.summary();
    const share = summary?.memberCommitShare;
    const scope = `${this.scopeLabel()} · ${this.rangeLabel()}`;
    return [
      {
        value: (summary?.companiesCount ?? 0).toLocaleString('en-US'),
        label: 'Contributing Companies',
        subLine: scope,
        icon: 'fa-solid fa-building',
        iconContainerClass: 'bg-blue-100 text-blue-600',
      },
      {
        value: (summary?.membersCount ?? 0).toLocaleString('en-US'),
        label: 'Members',
        ...(summary ? { subLine: `${summary.contributingMembersCount.toLocaleString('en-US')} contributing` } : {}),
        icon: 'fa-solid fa-circle-check',
        iconContainerClass: 'bg-emerald-100 text-emerald-600',
      },
      {
        value: (summary?.nonMembersCount ?? 0).toLocaleString('en-US'),
        label: 'Non-Members',
        subLine: scope,
        icon: 'fa-solid fa-user-plus',
        iconContainerClass: 'bg-amber-100 text-amber-600',
      },
      {
        value: share === null || share === undefined ? '—' : `${Math.round(share * 100)}%`,
        label: 'Member Commit Share',
        subLine: scope,
        icon: 'fa-solid fa-chart-pie',
        iconContainerClass: 'bg-violet-100 text-violet-600',
      },
    ];
  }

  private initTabs(): FilterPillOption[] {
    const summary = this.summary();
    const label = (name: string, count: number | undefined): string => (count === undefined ? name : `${name} (${count.toLocaleString('en-US')})`);
    return [
      { id: 'all', label: label('All', summary?.companiesCount) },
      { id: 'members', label: label('Members', summary?.contributingMembersCount) },
      { id: 'non_members', label: label('Non-Members', summary?.nonMembersCount) },
    ];
  }

  private initExportMenu(): MenuItem[] {
    return [
      { label: 'Company summary', title: 'One row per company · foundation totals', command: () => this.export('summary') },
      { label: 'Companies by project', title: 'One row per company and project', command: () => this.export('by-project') },
    ];
  }

  private initActiveFilters(): FoundationParticipatingOrgsFilterChip[] {
    const chips: FoundationParticipatingOrgsFilterChip[] = [];
    if (this.search()) chips.push({ id: 'search', label: `Search: “${this.search()}”` });
    if (this.projectSlug()) chips.push({ id: 'project', label: `Project: ${this.selectedProjectName() ?? this.projectSlug()}` });
    if (this.tier()) chips.push({ id: 'tier', label: `Tier: ${this.tier()}` });
    if (this.range() !== FOUNDATION_PARTICIPATING_ORGS_DEFAULT_RANGE) chips.push({ id: 'range', label: `Range: ${this.rangeLabel()}` });
    return chips;
  }

  private initSortIconMap(): Record<FoundationParticipatingOrgsSortField, string> {
    const active = this.sort();
    const activeIcon = this.dir() === 'asc' ? 'fa-solid fa-arrow-up' : 'fa-solid fa-arrow-down';
    return Object.fromEntries(PROJECT_PARTICIPATING_ORGS_SORT_FIELDS.map((field) => [field, active === field ? activeIcon : 'fa-light fa-sort'])) as Record<
      FoundationParticipatingOrgsSortField,
      string
    >;
  }

  private initAriaSortMap(): Record<FoundationParticipatingOrgsSortField, 'ascending' | 'descending' | 'none'> {
    const active = this.sort();
    const direction: 'ascending' | 'descending' = this.dir() === 'asc' ? 'ascending' : 'descending';
    return Object.fromEntries(PROJECT_PARTICIPATING_ORGS_SORT_FIELDS.map((field) => [field, active === field ? direction : 'none'])) as Record<
      FoundationParticipatingOrgsSortField,
      'ascending' | 'descending' | 'none'
    >;
  }

  private loadBreakdown(key: string): void {
    const slug = this.slug();
    const range = this.range();
    this.patchBreakdown(key, { status: 'loading', data: null });
    this.dataService
      .getBreakdown(slug, range, key)
      .pipe(take(1))
      .subscribe({
        // A response for a foundation or range the page has since left must not land in the new scope's cache.
        next: (data) => {
          if (slug === this.slug() && range === this.range()) this.patchBreakdown(key, { status: 'ready', data });
        },
        error: () => {
          if (slug === this.slug() && range === this.range()) this.patchBreakdown(key, { status: 'error' });
        },
      });
  }

  /** Drops every per-company filter control without emitting, so no stale value reaches the cache being rebuilt. */
  private clearBreakdownFilters(): void {
    const form: FormGroup = this.breakdownFilterForm;
    Object.keys(form.controls).forEach((key) => form.removeControl(key, { emitEvent: false }));
  }

  private ensureBreakdownFilter(key: string): void {
    if (this.breakdownFilterForm.contains(key)) return;
    const control = new FormControl<string>('', { nonNullable: true });
    this.breakdownFilterForm.addControl(key, control);
    control.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => this.patchBreakdown(key, { filter: value }));
  }

  private patchBreakdown(key: string, patch: Partial<FoundationParticipatingOrgBreakdownState>): void {
    const initial: FoundationParticipatingOrgBreakdownState = { status: 'loading', data: null, showAll: false, filter: '' };
    this.breakdowns.update((current) => ({ ...current, [key]: { ...initial, ...current[key], ...patch } }));
  }

  private exportFilters(): FoundationParticipatingOrgsExportFilters {
    const search = this.search();
    const tier = this.tier();
    const projectSlug = this.projectSlug();
    return {
      foundationSlug: this.slug(),
      range: this.range(),
      segment: this.segment(),
      ...(projectSlug ? { projectSlug } : {}),
      ...(search ? { search } : {}),
      ...(tier ? { tier } : {}),
      sort: this.sort(),
      dir: this.dir(),
    };
  }
}

/** `2026-11-11` → `Nov 11, 2026`, pinned to en-US and UTC so SSR and the browser render the same text. */
function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
