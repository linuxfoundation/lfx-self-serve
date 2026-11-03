// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, map, of, skip, startWith, switchMap, tap } from 'rxjs';

import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { OrgTrainingFilterBarComponent } from '@components/org-training-filter-bar/org-training-filter-bar.component';
import { OrgTrainingStatsComponent } from '@components/org-training-stats/org-training-stats.component';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensTrainingService } from '@services/org-lens-training.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import {
  avatarColorClass,
  countOrgTraineePairs,
  groupOrgTraineePairs,
  hasOrgTrainingFilter,
  matchesOrgTrainingFilters,
  orgTrainingFiltersSignature,
  orgTrainingStatsQuery,
  parseOrgTrainingViewState,
} from '@lfx-one/shared/utils';
import { formatMonthYearUtc } from '@shared/utils/date-format.util';
import { computePersonInitials } from '@shared/utils/person-avatar.util';
import {
  EMPTY_ORG_TRAINEES_RESPONSE,
  ORG_LENS_DEFAULT_TIME_RANGE,
  ORG_TRAINEES_INITIAL_LIMIT,
  ORG_TRAINEES_OUTSIDE_LEARNERS_FILTERED_NOTE,
  ORG_TRAINEES_OUTSIDE_LEARNERS_HEADING,
} from '@lfx-one/shared/constants';
import type {
  OrgLensTimeRange,
  OrgTraineeDetailRow,
  OrgTraineeExpandedRowVm,
  OrgTraineeOutsideLearner,
  OrgTraineesEmptyState,
  OrgTraineeRowVm,
  OrgTraineesResponse,
  OrgTraineeSortColumn,
  OrgTraineeSortDirection,
  OrgTrainingStats,
  OrgTrainingStatsQuery,
  OrgTrainingViewState,
} from '@lfx-one/shared/interfaces';
import { SkeletonModule } from 'primeng/skeleton';

import { TraineesService } from '../../services/trainees.service';

/** Trainees tab body — the shared filter bar and stat strip, a name/title search, a sortable table with chevron-toggled Courses & Certifications detail, and a name-and-status list of learners not on the people list. */
@Component({
  selector: 'lfx-org-people-trainees',
  imports: [
    DecimalPipe,
    ReactiveFormsModule,
    EmptyStateComponent,
    InputTextComponent,
    OrgTrainingFilterBarComponent,
    OrgTrainingStatsComponent,
    SkeletonModule,
  ],
  templateUrl: './trainees.component.html',
})
export class TraineesComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly dataService = inject(TraineesService);
  private readonly trainingService = inject(OrgLensTrainingService);
  private readonly drawer = inject(PersonDetailDrawerService);
  private readonly route = inject(ActivatedRoute);

  protected readonly initialLimit = ORG_TRAINEES_INITIAL_LIMIT;
  protected readonly tableSkeletonRows: readonly number[] = [0, 1, 2, 3, 4, 5];
  protected readonly outsideLearnersHeading = ORG_TRAINEES_OUTSIDE_LEARNERS_HEADING;
  protected readonly outsideLearnersFilteredNote = ORG_TRAINEES_OUTSIDE_LEARNERS_FILTERED_NOTE;

  /** Only the name/title search is page-local; the range and filters live in the URL, written by the shared filter bar. */
  public readonly filterForm = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
  });

  // WritableSignals — keep grouped per component-organization.md (writables → computed/toSignal).
  protected readonly sortColumn = signal<OrgTraineeSortColumn>('courses');
  protected readonly sortDirection = signal<OrgTraineeSortDirection>(-1);
  protected readonly limit = signal<number>(ORG_TRAINEES_INITIAL_LIMIT);
  protected readonly expansion = signal<Record<string, boolean>>({});
  protected readonly retryTrigger = signal<number>(0);
  private readonly loadingState = signal<boolean>(true);
  private readonly fetchErrorState = signal<boolean>(false);

  // Computed / readonly views.
  protected readonly isLoading = this.loadingState.asReadonly();
  protected readonly fetchError = this.fetchErrorState.asReadonly();

  // Mirror the search into a signal; debounce ~150ms so per-keystroke filtering doesn't thrash through the computed graph.
  private readonly searchValue = toSignal(this.filterForm.controls.search.valueChanges.pipe(debounceTime(150)), { initialValue: '' });

  // Range and filters, as the shared filter bar writes them to the URL.
  private readonly viewState: Signal<OrgTrainingViewState> = toSignal(
    this.route.queryParamMap.pipe(map((params) => parseOrgTrainingViewState((key) => params.get(key)))),
    { initialValue: parseOrgTrainingViewState((key) => this.route.snapshot.queryParamMap.get(key)) }
  );
  protected readonly range: Signal<OrgLensTimeRange> = computed(() => this.viewState().range);
  private readonly statsQuery: Signal<OrgTrainingStatsQuery> = computed(() => orgTrainingStatsQuery(this.viewState()));
  private readonly statsQuerySignature: Signal<string> = computed(() => orgTrainingFiltersSignature(this.statsQuery()));

  private readonly orgUid$ = toObservable(this.accountContext.selectedAccount).pipe(
    map((account) => account.uid),
    distinctUntilChanged()
  );

  protected readonly response: Signal<OrgTraineesResponse> = this.initResponse();

  /** The shared strip's numbers for the URL's range and filters; null while loading or when the read fails. */
  protected readonly trainingStats: Signal<OrgTrainingStats | null> = this.initTrainingStats();

  // Learners not on the people list carry no course data, so no foundation, project, course, level or format can match them.
  protected readonly courseFilterPicked: Signal<boolean> = computed(() => hasOrgTrainingFilter(this.viewState()));

  // Learners not on the people list: already the range's (the BFF windows them), narrowed by the name search only, by name.
  protected readonly outsideLearners: Signal<OrgTraineeOutsideLearner[]> = computed(() => this.initOutsideLearners());

  // Detail set is the canonical source of the table rows and the expanded section; the cards come from the stats call.
  protected readonly filteredDetails: Signal<OrgTraineeDetailRow[]> = computed(() => this.initFilteredDetails());

  protected readonly viewRows: Signal<OrgTraineeRowVm[]> = computed(() => this.initViewRows());

  protected readonly sortedRows: Signal<OrgTraineeRowVm[]> = computed(() => this.initSortedRows());

  protected readonly totalFiltered = computed(() => this.sortedRows().length);
  protected readonly visibleRows = computed(() => this.sortedRows().slice(0, this.limit()));
  protected readonly canShowMore = computed(() => this.limit() < this.totalFiltered());

  protected readonly footerCountLabel: Signal<string> = computed(() => this.initFooterCountLabel());

  /** Which empty-table copy applies; only a search or a dropdown pick reads as filtering, never the range alone. */
  public readonly emptyState: Signal<OrgTraineesEmptyState> = computed(() => this.initEmptyState());

  protected readonly ariaSortMap: Signal<Record<OrgTraineeSortColumn, 'ascending' | 'descending' | 'none'>> = computed(() => this.initAriaSortMap());

  protected readonly sortIconMap: Signal<Record<OrgTraineeSortColumn, string>> = computed(() => this.initSortIconMap());

  // Lookup of expanded sub-row VMs keyed by personKey; computed from `filteredDetails()` so it recomputes when filters change.
  protected readonly expandedRowsMap: Signal<Record<string, OrgTraineeExpandedRowVm[]>> = computed(() => this.initExpandedRowsMap());

  public constructor() {
    // Reset filter / sort / pagination / expansion when the org actually changes.
    this.orgUid$.pipe(skip(1), takeUntilDestroyed()).subscribe(() => this.resetAllState());

    // Sort change: reset pagination, preserve expansion (same rows, new order).
    combineLatest([toObservable(this.sortColumn), toObservable(this.sortDirection)])
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => this.limit.set(ORG_TRAINEES_INITIAL_LIMIT));

    // Search, range or filter change: reset pagination + expansion (collapse so (N) tracks the scope).
    combineLatest([toObservable(this.searchValue), toObservable(this.statsQuerySignature)])
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => {
        this.limit.set(ORG_TRAINEES_INITIAL_LIMIT);
        this.expansion.set({});
      });
  }

  public onSort(column: OrgTraineeSortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.update((d) => (d === 1 ? -1 : 1));
      return;
    }
    this.sortColumn.set(column);
    // Name + recent (string columns) ascend on first click; numeric / status columns descend.
    this.sortDirection.set(column === 'name' || column === 'recent' ? 1 : -1);
  }

  public onPersonClick(row: OrgTraineeRowVm, event: Event): void {
    event.stopPropagation();
    this.drawer.open({
      personKey: row.personKey,
      name: row.name,
      title: row.title,
      initials: row.initials,
      avatarColorClass: row.avatarColorClass,
      defaultTab: 'training',
      // The Code tab's Maintainer pills follow the range this tab lists the person in.
      range: this.range(),
    });
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

  protected showAll(): void {
    this.limit.set(this.totalFiltered());
  }

  protected retry(): void {
    this.retryTrigger.update((v) => v + 1);
  }

  private initFilteredDetails(): OrgTraineeDetailRow[] {
    const filters = this.viewState();
    const q = this.searchValue().trim().toLowerCase();

    // Build a name+title lookup so search filters details by who-the-person-is, not by per-row strings.
    const personIndex = new Map<string, { name: string; title: string | null }>();
    for (const t of this.response().trainees) {
      personIndex.set(t.personKey, { name: t.name, title: t.title });
    }

    // The details are already the range's (the BFF windows them), so only the filters and the search apply here.
    return this.response().details.filter((row) => {
      if (!matchesOrgTrainingFilters(row, filters)) return false;
      if (q) {
        const person = personIndex.get(row.personKey);
        if (!person) return false;
        const inName = person.name.toLowerCase().includes(q);
        const inTitle = (person.title ?? '').toLowerCase().includes(q);
        if (!inName && !inTitle) return false;
      }
      return true;
    });
  }

  private initViewRows(): OrgTraineeRowVm[] {
    const details = this.filteredDetails();
    if (details.length === 0) return [];

    // Group details by personKey once, then map to VMs.
    const detailsByPerson = new Map<string, OrgTraineeDetailRow[]>();
    for (const d of details) {
      const list = detailsByPerson.get(d.personKey) ?? [];
      list.push(d);
      detailsByPerson.set(d.personKey, list);
    }

    const out: OrgTraineeRowVm[] = [];
    for (const trainee of this.response().trainees) {
      const personDetails = detailsByPerson.get(trainee.personKey);
      if (!personDetails || personDetails.length === 0) continue;

      const counts = countOrgTraineePairs(groupOrgTraineePairs(personDetails));

      const recent = pickMostRecent(personDetails);

      out.push({
        personKey: trainee.personKey,
        name: trainee.name,
        title: trainee.title,
        email: trainee.email,
        initials: computePersonInitials(trainee.name),
        avatarColorClass: avatarColorClass(trainee.personKey),
        status: counts.certifications + counts.trainingsCompleted > 0 ? 'Certified' : 'Enrolled',
        coursesCount: counts.coursesTaken,
        certsCount: counts.certifications,
        trainingsCompletedCount: counts.trainingsCompleted,
        inProgressCount: counts.inProgress,
        recentCourseName: recent?.courseName ?? null,
        recentFoundationName: recent?.foundationName ?? null,
      });
    }

    return out;
  }

  private initSortedRows(): OrgTraineeRowVm[] {
    const rows = this.viewRows();
    const col = this.sortColumn();
    const dir = this.sortDirection();
    const copy = [...rows];
    copy.sort((a, b) => {
      switch (col) {
        case 'name':
          return a.name.localeCompare(b.name) * dir;
        case 'status': {
          const va = a.status === 'Certified' ? 1 : 0;
          const vb = b.status === 'Certified' ? 1 : 0;
          if (va !== vb) return (va - vb) * dir;
          return a.name.localeCompare(b.name);
        }
        case 'courses': {
          if (a.coursesCount !== b.coursesCount) return (a.coursesCount - b.coursesCount) * dir;
          return a.name.localeCompare(b.name);
        }
        case 'certs': {
          if (a.certsCount !== b.certsCount) return (a.certsCount - b.certsCount) * dir;
          return a.name.localeCompare(b.name);
        }
        case 'trainings': {
          if (a.trainingsCompletedCount !== b.trainingsCompletedCount) return (a.trainingsCompletedCount - b.trainingsCompletedCount) * dir;
          return a.name.localeCompare(b.name);
        }
        case 'inProgress': {
          if (a.inProgressCount !== b.inProgressCount) return (a.inProgressCount - b.inProgressCount) * dir;
          return a.name.localeCompare(b.name);
        }
        case 'recent': {
          const ra = (a.recentCourseName ?? '').toLowerCase();
          const rb = (b.recentCourseName ?? '').toLowerCase();
          const cmp = ra.localeCompare(rb);
          if (cmp !== 0) return cmp * dir;
          return a.name.localeCompare(b.name);
        }
      }
    });
    return copy;
  }

  private initFooterCountLabel(): string {
    const visible = Math.min(this.limit(), this.totalFiltered());
    return `Showing ${visible.toLocaleString()} of ${this.totalFiltered().toLocaleString()}`;
  }

  private initEmptyState(): OrgTraineesEmptyState {
    const searching = this.searchValue().trim().length > 0;
    const hasDropdown = this.courseFilterPicked();
    // Learners outside the people list follow the range and the search, and are hidden while a dropdown is picked.
    const outsideShown = !hasDropdown && this.outsideLearners().length > 0;
    if (hasDropdown) return 'filters';
    if (searching) return outsideShown ? 'people-list-search' : 'filters';
    if (outsideShown) return 'people-list-range';
    return this.range() !== ORG_LENS_DEFAULT_TIME_RANGE ? 'range' : 'none';
  }

  private initAriaSortMap(): Record<OrgTraineeSortColumn, 'ascending' | 'descending' | 'none'> {
    const active = this.sortColumn();
    const direction: 'ascending' | 'descending' = this.sortDirection() === 1 ? 'ascending' : 'descending';
    return {
      name: active === 'name' ? direction : 'none',
      status: active === 'status' ? direction : 'none',
      courses: active === 'courses' ? direction : 'none',
      certs: active === 'certs' ? direction : 'none',
      trainings: active === 'trainings' ? direction : 'none',
      inProgress: active === 'inProgress' ? direction : 'none',
      recent: active === 'recent' ? direction : 'none',
    };
  }

  private initSortIconMap(): Record<OrgTraineeSortColumn, string> {
    const active = this.sortColumn();
    const activeIcon = this.sortDirection() === 1 ? 'fa-light fa-sort-up' : 'fa-light fa-sort-down';
    const iconFor = (col: OrgTraineeSortColumn): string => (active === col ? activeIcon : 'fa-light fa-sort');
    return {
      name: iconFor('name'),
      status: iconFor('status'),
      courses: iconFor('courses'),
      certs: iconFor('certs'),
      trainings: iconFor('trainings'),
      inProgress: iconFor('inProgress'),
      recent: iconFor('recent'),
    };
  }

  private initExpandedRowsMap(): Record<string, OrgTraineeExpandedRowVm[]> {
    const detailsByPerson = new Map<string, OrgTraineeDetailRow[]>();
    for (const d of this.filteredDetails()) {
      const list = detailsByPerson.get(d.personKey) ?? [];
      list.push(d);
      detailsByPerson.set(d.personKey, list);
    }
    const out: Record<string, OrgTraineeExpandedRowVm[]> = {};
    for (const [personKey, rows] of detailsByPerson) {
      out[personKey] = collapseExpandedRows(rows);
    }
    return out;
  }

  private initOutsideLearners(): OrgTraineeOutsideLearner[] {
    const q = this.searchValue().trim().toLowerCase();
    const learners = q ? this.response().outsideLearners.filter((learner) => (learner.name ?? '').toLowerCase().includes(q)) : this.response().outsideLearners;
    // By name; a learner without one sorts last.
    return [...learners].sort((a, b) => {
      if (a.name === b.name) return 0;
      if (a.name === null) return 1;
      if (b.name === null) return -1;
      return a.name.localeCompare(b.name, 'en-US');
    });
  }

  private initResponse(): Signal<OrgTraineesResponse> {
    const range$ = toObservable(this.range);
    return toSignal(
      combineLatest([this.orgUid$, range$, toObservable(this.retryTrigger)]).pipe(
        tap(() => {
          this.loadingState.set(true);
          this.fetchErrorState.set(false);
        }),
        switchMap(([orgUid, timeRange]) => {
          if (!orgUid) {
            this.loadingState.set(false);
            return of({ ...EMPTY_ORG_TRAINEES_RESPONSE, timeRange });
          }
          return this.dataService.getTrainees(orgUid, timeRange).pipe(
            tap(() => this.loadingState.set(false)),
            catchError(() => {
              this.fetchErrorState.set(true);
              this.loadingState.set(false);
              return of({ ...EMPTY_ORG_TRAINEES_RESPONSE, timeRange });
            })
          );
        })
      ),
      { initialValue: EMPTY_ORG_TRAINEES_RESPONSE }
    );
  }

  /** One stats call per org, range and filter set; a failed read leaves the strip on dashes rather than zeros. */
  private initTrainingStats(): Signal<OrgTrainingStats | null> {
    const query$ = toObservable(this.statsQuerySignature).pipe(map(() => this.statsQuery()));
    return toSignal(
      combineLatest([this.orgUid$, query$, toObservable(this.retryTrigger)]).pipe(
        switchMap(([orgUid, query]) => {
          if (!orgUid) return of(null);
          return this.trainingService.getTrainingStats(orgUid, query).pipe(
            catchError(() => of(null)),
            startWith(null)
          );
        })
      ),
      { initialValue: null }
    );
  }

  private resetAllState(): void {
    // The range and filters are page-level URL state (the filter bar prunes what the new org lacks), so an org switch keeps them.
    this.filterForm.patchValue({ search: '' });
    this.sortColumn.set('courses');
    this.sortDirection.set(-1);
    this.limit.set(ORG_TRAINEES_INITIAL_LIMIT);
    this.expansion.set({});
  }
}

/** Most-recent row per Item 4 tiebreak: ACTIVITY_TS DESC → STATUS='Certified' DESC → COURSE_NAME ASC. */
function pickMostRecent(rows: OrgTraineeDetailRow[]): OrgTraineeDetailRow | null {
  if (rows.length === 0) return null;
  let best = rows[0];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (compareMostRecent(r, best) < 0) {
      best = r;
    }
  }
  return best;
}

/** Max of two ISO timestamps; at least one must be non-null (caller-enforced). */
function maxIsoTs(a: string | null, b: string | null): string {
  if (a === null) return b as string;
  if (b === null) return a;
  return a > b ? a : b;
}

function compareMostRecent(a: OrgTraineeDetailRow, b: OrgTraineeDetailRow): number {
  if (a.activityTs !== b.activityTs) {
    return a.activityTs > b.activityTs ? -1 : 1;
  }
  const aCert = a.status === 'Certified' ? 1 : 0;
  const bCert = b.status === 'Certified' ? 1 : 0;
  if (aCert !== bCert) return bCert - aCert;
  return a.courseName.localeCompare(b.courseName);
}

/** Collapse (personKey, courseId) source rows to one per course; typed by product, sorted recent-first per Item 4 tiebreak. */
function collapseExpandedRows(rows: OrgTraineeDetailRow[]): OrgTraineeExpandedRowVm[] {
  const byCourse = new Map<string, OrgTraineeDetailRow[]>();
  for (const r of rows) {
    const list = byCourse.get(r.courseId) ?? [];
    list.push(r);
    byCourse.set(r.courseId, list);
  }

  const out: OrgTraineeExpandedRowVm[] = [];
  for (const group of byCourse.values()) {
    const enrolledTs = minActivityTs(group.filter((r) => r.status === 'Enrolled'));
    const certifiedTs = minActivityTs(group.filter((r) => r.status === 'Certified'));
    // MAX is defensive against rare source-data anomalies where certifiedTs < enrolledTs.
    const sortTs = maxIsoTs(enrolledTs, certifiedTs);
    const [pair] = groupOrgTraineePairs(group);

    out.push({
      courseId: group[0].courseId,
      courseName: group[0].courseName,
      type: pair.productType === 'Certification' ? 'Certification' : 'Training',
      enrolledTs,
      completedTs: certifiedTs,
      enrolledLabel: enrolledTs ? formatMonthYearUtc(enrolledTs) : '—',
      completedLabel: certifiedTs ? formatMonthYearUtc(certifiedTs) : '—',
      sortTs,
    });
  }

  return out.sort((a, b) => {
    if (a.sortTs !== b.sortTs) return a.sortTs > b.sortTs ? -1 : 1;
    if (a.type !== b.type) return a.type === 'Certification' ? -1 : 1;
    return a.courseName.localeCompare(b.courseName);
  });
}

function minActivityTs(rows: OrgTraineeDetailRow[]): string | null {
  if (rows.length === 0) return null;
  let min = rows[0].activityTs;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].activityTs < min) min = rows[i].activityTs;
  }
  return min || null;
}
