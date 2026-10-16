// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, linkedSignal, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MetricDeltaComponent } from '@components/metric-delta/metric-delta.component';
import { SelectComponent } from '@components/select/select.component';
import { SelectButtonComponent } from '@components/select-button/select-button.component';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import {
  CONTRIBUTIONS_DATE_RANGE_OPTIONS,
  CONTRIBUTIONS_DEFAULT_DATE_RANGE,
  EMPTY_PROJECT_PARTICIPATING_ORGS_PAGE,
  MEMBERSHIP_TIER_ORDER,
  PROJECT_PARTICIPATING_ORGS_DEFAULT_SORT,
  PROJECT_PARTICIPATING_ORGS_DEFAULT_SORT_DIR,
  PROJECT_PARTICIPATING_ORGS_MAX_SEARCH_LENGTH,
  PROJECT_PARTICIPATING_ORGS_NO_ORG_LENS_ACCESS_TOOLTIP,
  PROJECT_PARTICIPATING_ORGS_PAGE_SIZE,
  PROJECT_PARTICIPATING_ORGS_PAGE_SIZE_OPTIONS,
  PROJECT_PARTICIPATING_ORGS_SEARCH_DEBOUNCE_MS,
  PROJECT_PARTICIPATING_ORGS_SEGMENTS,
  PROJECT_PARTICIPATING_ORGS_SHARE_BASE_OPTIONS,
  PROJECT_PARTICIPATING_ORGS_UNAVAILABLE_MESSAGE,
  PROJECT_PARTICIPATING_ORGS_UNIDENTIFIED_TOOLTIP,
} from '@lfx-one/shared/constants';
import type {
  ContributionsDateRangeOption,
  FilterPillOption,
  MembershipTierClass,
  ProjectParticipatingOrgRowVm,
  ProjectParticipatingOrgsExportFilters,
  ProjectParticipatingOrgsPage,
  ProjectParticipatingOrgsQuery,
  ProjectParticipatingOrgsRange,
  ProjectParticipatingOrgsSegment,
  ProjectParticipatingOrgsShareBase,
  ProjectParticipatingOrgsSortDirection,
  ProjectParticipatingOrgsSortField,
  ProjectParticipatingOrgsSummary,
  ProjectParticipatingOrgsViewState,
  StatCardItem,
} from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@services/project-context.service';
import { formatLongDateUtc } from '@shared/utils/date-format.util';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, filter, finalize, map, of, switchMap, take, tap } from 'rxjs';

import { decorateParticipatingOrgRow } from './participating-orgs.util';
import { ParticipatingOrgsService } from './services/participating-orgs.service';

/**
 * Project Lens → Participating Organizations (#2091): every company contributing code to the project, split into
 * current members of its parent foundation (with tier) and non-members, Unidentified companies included.
 * Server-paged, -sorted and -filtered; access is enforced by the BFF (project `viewer`).
 */
@Component({
  selector: 'lfx-participating-orgs',
  imports: [
    DecimalPipe,
    ReactiveFormsModule,
    RouterLink,
    TooltipModule,
    ButtonComponent,
    CardComponent,
    CardTabsBarComponent,
    EmptyStateComponent,
    InputTextComponent,
    MetricDeltaComponent,
    SelectComponent,
    SelectButtonComponent,
    StatCardGridComponent,
    TableComponent,
    TagComponent,
  ],
  templateUrl: './participating-orgs.component.html',
})
export class ParticipatingOrgsComponent {
  private readonly projectContextService = inject(ProjectContextService);
  private readonly dataService = inject(ParticipatingOrgsService);

  protected readonly rangeOptions: ContributionsDateRangeOption[] = [...CONTRIBUTIONS_DATE_RANGE_OPTIONS];
  protected readonly tierOptions = MEMBERSHIP_TIER_ORDER.map((tier) => ({ label: tier, value: tier }));
  protected readonly shareBaseOptions = [...PROJECT_PARTICIPATING_ORGS_SHARE_BASE_OPTIONS];
  protected readonly pageSizeOptions: number[] = [...PROJECT_PARTICIPATING_ORGS_PAGE_SIZE_OPTIONS];
  protected readonly maxSearchLength = PROJECT_PARTICIPATING_ORGS_MAX_SEARCH_LENGTH;
  protected readonly noAccessTooltip = PROJECT_PARTICIPATING_ORGS_NO_ORG_LENS_ACCESS_TOOLTIP;
  protected readonly unidentifiedTooltip = PROJECT_PARTICIPATING_ORGS_UNIDENTIFIED_TOOLTIP;

  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
    tier: new FormControl<MembershipTierClass | null>(null),
  });
  protected readonly rangeForm = new FormGroup({
    range: new FormControl<ProjectParticipatingOrgsRange>(CONTRIBUTIONS_DEFAULT_DATE_RANGE, { nonNullable: true }),
  });
  protected readonly shareForm = new FormGroup({
    shareBase: new FormControl<ProjectParticipatingOrgsShareBase>(this.shareBaseOptions[0].value, { nonNullable: true }),
  });

  protected readonly segment = signal<ProjectParticipatingOrgsSegment>('all');
  protected readonly sort = signal<ProjectParticipatingOrgsSortField>(PROJECT_PARTICIPATING_ORGS_DEFAULT_SORT);
  protected readonly dir = signal<ProjectParticipatingOrgsSortDirection>(PROJECT_PARTICIPATING_ORGS_DEFAULT_SORT_DIR);
  protected readonly pageSize = signal<number>(PROJECT_PARTICIPATING_ORGS_PAGE_SIZE);
  protected readonly exporting = signal(false);
  private readonly retryTrigger = signal(0);

  private readonly summaryLoadingState = signal(true);
  /** HTTP status of the last failed read (0 when not an HTTP error); null while the read is healthy. */
  private readonly summaryErrorStatus = signal<number | null>(null);
  private readonly pageLoadingState = signal(true);
  private readonly pageErrorStatus = signal<number | null>(null);
  protected readonly summaryLoading = this.summaryLoadingState.asReadonly();
  protected readonly pageLoading = this.pageLoadingState.asReadonly();

  private readonly slug = computed(() => this.projectContextService.activeContext()?.slug ?? '');
  private readonly range: Signal<ProjectParticipatingOrgsRange> = toSignal(this.rangeForm.controls.range.valueChanges, {
    initialValue: this.rangeForm.controls.range.value,
  });
  private readonly search: Signal<string> = this.initSearch();
  private readonly tier: Signal<MembershipTierClass | null> = toSignal(this.filterForm.controls.tier.valueChanges, { initialValue: null });
  private readonly shareBase: Signal<ProjectParticipatingOrgsShareBase> = toSignal(this.shareForm.controls.shareBase.valueChanges, {
    initialValue: this.shareForm.controls.shareBase.value,
  });

  /** Switching project, or any filter, tab, range or sort change, returns the table to its first page. */
  protected readonly offset = linkedSignal({
    source: () => `${this.slug()}|${this.range()}|${this.segment()}|${this.search()}|${this.tier()}|${this.sort()}|${this.dir()}`,
    computation: () => 0,
  });

  private readonly query: Signal<ProjectParticipatingOrgsQuery> = computed(() => ({
    ...this.exportFilters(),
    pageSize: this.pageSize(),
    offset: this.offset(),
  }));

  protected readonly summary: Signal<ProjectParticipatingOrgsSummary | null> = this.initSummary();
  protected readonly page: Signal<ProjectParticipatingOrgsPage> = this.initPage();

  protected readonly viewState: Signal<ProjectParticipatingOrgsViewState> = computed(() => this.initViewState());
  protected readonly rows: Signal<ProjectParticipatingOrgRowVm[]> = computed(() => {
    const foundationSlug = this.page().foundationSlug ?? this.summary()?.foundationSlug ?? null;
    return this.page().rows.map((row) => decorateParticipatingOrgRow(row, foundationSlug));
  });
  protected readonly totalRecords = computed(() => this.page().totalRecords);
  protected readonly subtitle = computed(() => this.initSubtitle());
  protected readonly asOfLabel = computed(() => {
    const asOf = this.summary()?.asOfDate;
    return asOf ? `Data as of ${formatLongDateUtc(asOf)}` : null;
  });
  protected readonly tiles: Signal<StatCardItem[]> = computed(() => this.initTiles());
  protected readonly tabs: Signal<FilterPillOption[]> = computed(() => this.initTabs());
  protected readonly sortIconMap: Signal<Record<ProjectParticipatingOrgsSortField, string>> = computed(() => this.initSortIconMap());
  protected readonly ariaSortMap: Signal<Record<ProjectParticipatingOrgsSortField, 'ascending' | 'descending' | 'none'>> = computed(() =>
    this.initAriaSortMap()
  );
  protected readonly errorSubtitle = computed(() =>
    this.summaryErrorStatus() === 503 || this.pageErrorStatus() === 503 ? PROJECT_PARTICIPATING_ORGS_UNAVAILABLE_MESSAGE : 'Please try again.'
  );

  public constructor() {
    // The tier filter narrows to members of one tier, so it has no meaning on the Non-Members tab.
    toObservable(this.segment)
      .pipe(takeUntilDestroyed())
      .subscribe((segment) => {
        const tier = this.filterForm.controls.tier;
        if (segment === 'non_members') {
          tier.setValue(null);
          tier.disable();
          return;
        }
        tier.enable();
      });
  }

  protected onSegmentChange(id: string): void {
    const segment = PROJECT_PARTICIPATING_ORGS_SEGMENTS.find((value) => value === id);
    if (segment) {
      this.segment.set(segment);
    }
  }

  protected onSort(field: ProjectParticipatingOrgsSortField): void {
    if (this.sort() === field) {
      this.dir.update((dir) => (dir === 'asc' ? 'desc' : 'asc'));
      return;
    }
    this.sort.set(field);
    // Name A→Z and tier Platinum-first read naturally ascending; the counts lead with the largest.
    this.dir.set(field === 'name' || field === 'tier' ? 'asc' : 'desc');
  }

  protected onTablePage(event: { first?: number; rows?: number }): void {
    this.pageSize.set(event.rows ?? this.pageSize());
    this.offset.set(event.first ?? 0);
  }

  protected exportCsv(): void {
    const slug = this.slug();
    if (!slug || this.exporting()) return;
    this.exporting.set(true);
    this.dataService
      .exportCsv(slug, this.exportFilters())
      .pipe(
        take(1),
        finalize(() => this.exporting.set(false))
      )
      .subscribe();
  }

  protected retry(): void {
    this.retryTrigger.update((value) => value + 1);
  }

  private exportFilters(): ProjectParticipatingOrgsExportFilters {
    const search = this.search();
    const tier = this.tier();
    return {
      range: this.range(),
      segment: this.segment(),
      ...(search ? { search } : {}),
      ...(tier ? { tier } : {}),
      sort: this.sort(),
      dir: this.dir(),
    };
  }

  private initSearch(): Signal<string> {
    return toSignal(
      this.filterForm.controls.search.valueChanges.pipe(
        debounceTime(PROJECT_PARTICIPATING_ORGS_SEARCH_DEBOUNCE_MS),
        map((value) => value.trim().slice(0, PROJECT_PARTICIPATING_ORGS_MAX_SEARCH_LENGTH)),
        distinctUntilChanged()
      ),
      { initialValue: '' }
    );
  }

  private initSummary(): Signal<ProjectParticipatingOrgsSummary | null> {
    return toSignal(
      combineLatest([
        toObservable(computed(() => ({ slug: this.slug(), range: this.range() }))).pipe(
          filter(({ slug }) => slug.length > 0),
          distinctUntilChanged((a, b) => a.slug === b.slug && a.range === b.range)
        ),
        toObservable(this.retryTrigger),
      ]).pipe(
        tap(() => {
          this.summaryLoadingState.set(true);
          this.summaryErrorStatus.set(null);
        }),
        switchMap(([{ slug, range }]) =>
          this.dataService.getSummary(slug, range).pipe(
            map((response) => response.summary),
            tap(() => this.summaryLoadingState.set(false)),
            catchError((error: unknown) => {
              this.summaryErrorStatus.set(error instanceof HttpErrorResponse ? error.status : 0);
              this.summaryLoadingState.set(false);
              return of(null);
            })
          )
        )
      ),
      { initialValue: null }
    );
  }

  private initPage(): Signal<ProjectParticipatingOrgsPage> {
    return toSignal(
      combineLatest([
        // Slug and query travel as one value, so a project switch arrives together with its page reset — never as the
        // new slug paired with the previous project's offset.
        toObservable(computed(() => ({ slug: this.slug(), query: this.query() }))).pipe(
          filter(({ slug }) => slug.length > 0),
          distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
        ),
        toObservable(this.retryTrigger),
      ]).pipe(
        tap(() => {
          this.pageLoadingState.set(true);
          this.pageErrorStatus.set(null);
        }),
        switchMap(([{ slug, query }]) =>
          this.dataService.getPage(slug, query).pipe(
            tap(() => this.pageLoadingState.set(false)),
            catchError((error: unknown) => {
              this.pageErrorStatus.set(error instanceof HttpErrorResponse ? error.status : 0);
              this.pageLoadingState.set(false);
              return of(EMPTY_PROJECT_PARTICIPATING_ORGS_PAGE);
            })
          )
        )
      ),
      { initialValue: EMPTY_PROJECT_PARTICIPATING_ORGS_PAGE }
    );
  }

  /** A 403 on either read is the viewer lacking project access; any other failure (503 included) is retryable. */
  private initViewState(): ProjectParticipatingOrgsViewState {
    const statuses = [this.summaryErrorStatus(), this.pageErrorStatus()];
    if (statuses.includes(403)) return 'forbidden';
    if (statuses.some((status) => status !== null)) return 'error';
    if (!this.summaryLoading() && this.summary() === null) return 'empty';
    return 'ready';
  }

  private initSubtitle(): string {
    const project = this.projectContextService.activeContext()?.name ?? 'this project';
    const summary = this.summary();
    const foundation = summary?.foundationName ?? summary?.foundationSlug;
    return foundation
      ? `Companies contributing code to ${project}, split by ${foundation} membership.`
      : `Companies contributing code to ${project}, split by parent foundation membership.`;
  }

  private initTiles(): StatCardItem[] {
    const summary = this.summary();
    const share = this.shareBase() === 'all' ? summary?.memberCommitShareOfAllCommits : summary?.memberCommitShareOfCompanyCommits;
    const unidentified = summary?.unidentifiedCount ?? 0;
    return [
      {
        value: (summary?.orgsCount ?? 0).toLocaleString('en-US'),
        label: 'Orgs Participating',
        icon: 'fa-light fa-building',
        iconContainerClass: 'bg-blue-100 text-blue-600',
      },
      {
        value: (summary?.membersCount ?? 0).toLocaleString('en-US'),
        label: 'Members',
        icon: 'fa-light fa-id-badge',
        iconContainerClass: 'bg-emerald-100 text-emerald-600',
      },
      {
        value: (summary?.nonMembersCount ?? 0).toLocaleString('en-US'),
        label: 'Non-Members',
        subLine: unidentified > 0 ? `${unidentified.toLocaleString('en-US')} Unidentified` : undefined,
        icon: 'fa-light fa-building-circle-xmark',
        iconContainerClass: 'bg-amber-100 text-amber-600',
      },
      {
        value: share === null || share === undefined ? '—' : `${(share * 100).toFixed(1)}%`,
        label: 'Member Commit Share',
        icon: 'fa-light fa-chart-pie',
        iconContainerClass: 'bg-violet-100 text-violet-600',
      },
    ];
  }

  private initTabs(): FilterPillOption[] {
    const summary = this.summary();
    // Locale pinned so SSR on Node and the browser render the same digits (no hydration mismatch).
    const label = (name: string, count: number | undefined): string => (count === undefined ? name : `${name} (${count.toLocaleString('en-US')})`);
    return [
      { id: 'all', label: label('All', summary?.orgsCount) },
      { id: 'members', label: label('Members', summary?.membersCount) },
      { id: 'non_members', label: label('Non-Members', summary?.nonMembersCount) },
    ];
  }

  private initSortIconMap(): Record<ProjectParticipatingOrgsSortField, string> {
    const active = this.sort();
    const activeIcon = this.dir() === 'asc' ? 'fa-light fa-sort-up' : 'fa-light fa-sort-down';
    const iconFor = (field: ProjectParticipatingOrgsSortField): string => (active === field ? activeIcon : 'fa-light fa-sort');
    return { name: iconFor('name'), tier: iconFor('tier'), commits: iconFor('commits'), contributors: iconFor('contributors') };
  }

  private initAriaSortMap(): Record<ProjectParticipatingOrgsSortField, 'ascending' | 'descending' | 'none'> {
    const active = this.sort();
    const direction: 'ascending' | 'descending' = this.dir() === 'asc' ? 'ascending' : 'descending';
    const sortFor = (field: ProjectParticipatingOrgsSortField): 'ascending' | 'descending' | 'none' => (active === field ? direction : 'none');
    return { name: sortFor('name'), tier: sortFor('tier'), commits: sortFor('commits'), contributors: sortFor('contributors') };
  }
}
