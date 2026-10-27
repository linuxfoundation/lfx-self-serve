// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, map, merge, of, skip, startWith, Subject, switchMap, tap } from 'rxjs';

import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { AccountContextService } from '@services/account-context.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { avatarColorClass } from '@lfx-one/shared/utils';
import { formatMonthYearUtc } from '@shared/utils/date-format.util';
import { readOrgLensTimeRange, syncOrgLensTimeRangeWithUrl } from '@shared/utils/org-lens-time-range-url.util';
import { computePersonInitials } from '@shared/utils/person-avatar.util';
import { EMPTY_ORG_TRAINEES_RESPONSE, ORG_LENS_DEFAULT_TIME_RANGE, ORG_LENS_TIME_RANGE_OPTIONS, ORG_TRAINEES_INITIAL_LIMIT } from '@lfx-one/shared/constants';
import type {
  OrgDropdownOption,
  OrgLensTimeRange,
  OrgLensTimeRangeOption,
  OrgTraineeDetailRow,
  OrgTraineeExpandedRowVm,
  OrgTraineeRowVm,
  OrgTraineesResponse,
  OrgTraineeSortColumn,
  OrgTraineeSortDirection,
  OrgTraineeStatsBaseline,
} from '@lfx-one/shared/interfaces';
import { SkeletonModule } from 'primeng/skeleton';

import { TraineesService } from '../../services/trainees.service';

/** Trainees tab body — search + foundation + course + range filters, four stat cards, sortable table with chevron-toggled Courses & Certifications detail. */
@Component({
  selector: 'lfx-org-people-trainees',
  imports: [DecimalPipe, ReactiveFormsModule, EmptyStateComponent, InputTextComponent, SelectComponent, SkeletonModule],
  templateUrl: './trainees.component.html',
})
export class TraineesComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly dataService = inject(TraineesService);
  private readonly drawer = inject(PersonDetailDrawerService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly initialLimit = ORG_TRAINEES_INITIAL_LIMIT;
  protected readonly timeRangeOptions: OrgLensTimeRangeOption[] = [...ORG_LENS_TIME_RANGE_OPTIONS];
  protected readonly tableSkeletonRows: readonly number[] = [0, 1, 2, 3, 4, 5];
  protected readonly statSkeletonLabels: readonly string[] = ['Trainees', 'Courses Enrolled', 'Certifications', 'Completion Rate'];

  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
    foundation: new FormControl<string>('', { nonNullable: true }),
    course: new FormControl<string>('', { nonNullable: true }),
    // Follows `?range=` (shared with every People tab and Code Contributions); the BFF reads only this range's rows.
    timeRange: new FormControl<OrgLensTimeRange>(readOrgLensTimeRange(this.route), { nonNullable: true }),
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

  // Mirror reactive form into a signal; debounce ~150ms so per-keystroke filtering doesn't thrash through the computed graph.
  // A selection cleared for a new range skips the debounce, so the response never renders behind it.
  private readonly selectionsPruned$ = new Subject<void>();
  private readonly filterValues = toSignal(
    merge(this.filterForm.valueChanges.pipe(debounceTime(150)), this.selectionsPruned$.pipe(map(() => this.filterForm.getRawValue()))),
    { initialValue: this.filterForm.getRawValue() }
  );

  private readonly orgUid$ = toObservable(this.accountContext.selectedAccount).pipe(
    map((account) => account.uid),
    distinctUntilChanged()
  );

  // The range refetches undebounced, once per distinct value.
  private readonly timeRange$ = this.filterForm.controls.timeRange.valueChanges.pipe(
    startWith(this.filterForm.controls.timeRange.value),
    distinctUntilChanged()
  );

  protected readonly response: Signal<OrgTraineesResponse> = this.initResponse();

  protected readonly foundationOptions: Signal<OrgDropdownOption[]> = computed(() => this.initFoundationOptions());
  protected readonly courseOptions: Signal<OrgDropdownOption[]> = computed(() => this.initCourseOptions());

  // Detail set is the canonical source — every filter-aware derivation (stats, rows, expanded section) reads it.
  protected readonly filteredDetails: Signal<OrgTraineeDetailRow[]> = computed(() => this.initFilteredDetails());

  protected readonly stats: Signal<OrgTraineeStatsBaseline> = computed(() => this.initStats());

  protected readonly viewRows: Signal<OrgTraineeRowVm[]> = computed(() => this.initViewRows());

  protected readonly sortedRows: Signal<OrgTraineeRowVm[]> = computed(() => this.initSortedRows());

  protected readonly totalFiltered = computed(() => this.sortedRows().length);
  protected readonly visibleRows = computed(() => this.sortedRows().slice(0, this.limit()));
  protected readonly canShowMore = computed(() => this.limit() < this.totalFiltered());

  protected readonly footerCountLabel: Signal<string> = computed(() => this.initFooterCountLabel());

  protected readonly isFiltering: Signal<boolean> = computed(() => this.initIsFiltering());

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

    // Filter change: reset pagination + expansion (collapse so (N) tracks filter scope).
    this.filterForm.valueChanges.pipe(debounceTime(150), takeUntilDestroyed()).subscribe(() => {
      this.limit.set(ORG_TRAINEES_INITIAL_LIMIT);
      this.expansion.set({});
    });

    syncOrgLensTimeRangeWithUrl(this.filterForm.controls.timeRange, this.route, this.router);
  }

  protected onSort(column: OrgTraineeSortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.update((d) => (d === 1 ? -1 : 1));
      return;
    }
    this.sortColumn.set(column);
    // Name + recent (string columns) ascend on first click; numeric / status columns descend.
    this.sortDirection.set(column === 'name' || column === 'recent' ? 1 : -1);
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

  protected onPersonClick(row: OrgTraineeRowVm, event: Event): void {
    event.stopPropagation();
    this.drawer.open({
      personKey: row.personKey,
      name: row.name,
      title: row.title,
      initials: row.initials,
      avatarColorClass: row.avatarColorClass,
      defaultTab: 'training',
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

  private initCourseOptions(): OrgDropdownOption[] {
    return [{ label: 'All Courses', value: '' }, ...this.response().courseOptions.map((c) => ({ label: c.courseName, value: c.courseId }))];
  }

  private initFilteredDetails(): OrgTraineeDetailRow[] {
    const values = this.filterValues();
    const q = (values.search ?? '').trim().toLowerCase();
    const foundationId = values.foundation ?? '';
    const courseId = values.course ?? '';

    // Build a name+title lookup so search filters details by who-the-person-is, not by per-row strings.
    const personIndex = new Map<string, { name: string; title: string | null }>();
    for (const t of this.response().trainees) {
      personIndex.set(t.personKey, { name: t.name, title: t.title });
    }

    // The details are already the range's (the BFF windows them), so only the client-side trio filters here.
    return this.response().details.filter((row) => {
      if (foundationId && row.foundationId !== foundationId) return false;
      if (courseId && row.courseId !== courseId) return false;
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

  private initStats(): OrgTraineeStatsBaseline {
    // Stats always reflect the currently-filtered details so the four cards stay in sync with what the table shows (Items 5+6 of the locked design), within the range the BFF read.
    const details = this.filteredDetails();
    const trainees = new Set<string>();
    const courseKeys = new Set<string>();
    const certKeys = new Set<string>();
    for (const d of details) {
      trainees.add(d.personKey);
      const composite = `${d.personKey}|${d.courseId}`;
      courseKeys.add(composite);
      if (d.status === 'Certified') {
        certKeys.add(composite);
      }
    }
    const coursesEnrolled = courseKeys.size;
    const certifications = certKeys.size;
    const completionRate = coursesEnrolled === 0 ? 0 : Math.round((certifications / coursesEnrolled) * 100);
    return {
      trainees: trainees.size,
      coursesEnrolled,
      certifications,
      completionRate,
    };
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

      const courseIds = new Set<string>();
      const certCourseIds = new Set<string>();
      for (const d of personDetails) {
        courseIds.add(d.courseId);
        if (d.status === 'Certified') certCourseIds.add(d.courseId);
      }

      const recent = pickMostRecent(personDetails);

      out.push({
        personKey: trainee.personKey,
        name: trainee.name,
        title: trainee.title,
        email: trainee.email,
        initials: computePersonInitials(trainee.name),
        avatarColorClass: avatarColorClass(trainee.personKey),
        status: certCourseIds.size > 0 ? 'Certified' : 'Enrolled',
        coursesCount: courseIds.size,
        certsCount: certCourseIds.size,
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

  private initIsFiltering(): boolean {
    const values = this.filterValues();
    const hasSearch = (values.search ?? '').trim().length > 0;
    const hasFoundation = !!(values.foundation ?? '');
    const hasCourse = !!(values.course ?? '');
    const hasTimeFilter = (values.timeRange ?? ORG_LENS_DEFAULT_TIME_RANGE) !== ORG_LENS_DEFAULT_TIME_RANGE;
    return hasSearch || hasFoundation || hasCourse || hasTimeFilter;
  }

  private initAriaSortMap(): Record<OrgTraineeSortColumn, 'ascending' | 'descending' | 'none'> {
    const active = this.sortColumn();
    const direction: 'ascending' | 'descending' = this.sortDirection() === 1 ? 'ascending' : 'descending';
    return {
      name: active === 'name' ? direction : 'none',
      status: active === 'status' ? direction : 'none',
      courses: active === 'courses' ? direction : 'none',
      certs: active === 'certs' ? direction : 'none',
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

  private initResponse(): Signal<OrgTraineesResponse> {
    return toSignal(
      combineLatest([this.orgUid$, this.timeRange$, toObservable(this.retryTrigger)]).pipe(
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
            tap((res) => {
              this.dropSelectionsAbsentFrom(res);
              this.loadingState.set(false);
            }),
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

  /** A new range rebuilds both dropdowns, and filtering on a foundation or course it no longer lists would hide every row. */
  private dropSelectionsAbsentFrom(res: OrgTraineesResponse): void {
    const { foundation, course } = this.filterForm.getRawValue();
    const patch: { foundation?: string; course?: string } = {};
    if (foundation && !res.foundationOptions.some((option) => option.foundationId === foundation)) patch.foundation = '';
    if (course && !res.courseOptions.some((option) => option.courseId === course)) patch.course = '';
    if (patch.foundation === undefined && patch.course === undefined) return;
    this.filterForm.patchValue(patch);
    this.selectionsPruned$.next();
  }

  private resetAllState(): void {
    // The range is page-level URL state, not per-org, so an org switch keeps it.
    this.filterForm.patchValue({ search: '', foundation: '', course: '' });
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

/** Collapse (personKey, courseId) source rows; Certification supersedes Course; sort recent-first per Item 4 tiebreak. */
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
    const isCertified = certifiedTs !== null;
    // MAX is defensive against rare source-data anomalies where certifiedTs < enrolledTs.
    const sortTs = maxIsoTs(enrolledTs, certifiedTs);

    out.push({
      courseId: group[0].courseId,
      courseName: group[0].courseName,
      type: isCertified ? 'Certification' : 'Course',
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
