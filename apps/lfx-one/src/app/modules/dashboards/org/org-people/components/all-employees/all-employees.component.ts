// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { catchError, combineLatest, distinctUntilChanged, finalize, map, of, skip, Subject, switchMap, take, takeUntil, tap } from 'rxjs';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { AccountContextService } from '@services/account-context.service';
import { PersonProfilePanelService } from '@services/person-profile-panel.service';

import { EMPTY_ORG_ALL_EMPLOYEES_RESPONSE, ORG_ALL_EMPLOYEE_ACTIVITY_OPTIONS, ORG_ALL_EMPLOYEES_INITIAL_LIMIT } from '@lfx-one/shared/constants';
import type {
  OrgAllEmployeeActivityFilter,
  OrgAllEmployeeActivityOption,
  OrgAllEmployeeDetail,
  OrgAllEmployeeRow,
  OrgAllEmployeesResponse,
  OrgAllEmployeeSortColumn,
  OrgAllEmployeeSortDirection,
  OrgDropdownOption,
} from '@lfx-one/shared/interfaces';

import { AllEmployeesService } from '../../services/all-employees.service';

import { AllEmployeesDetailComponent } from './all-employees-detail.component';

/** File-local view model: shared wire row + per-row derivatives precomputed once so the template stays free of method calls. */
type AllEmployeeRowVm = OrgAllEmployeeRow & {
  initials: string;
  avatarColorClass: string;
};

/** All Employees tab body — filter bar, 5 stat cards, sortable table with chevron-toggled detail rows. */
@Component({
  selector: 'lfx-org-people-all-employees',
  imports: [DecimalPipe, FormsModule, InputTextModule, SelectModule, SkeletonModule, TooltipModule, EmptyStateComponent, AllEmployeesDetailComponent],
  templateUrl: './all-employees.component.html',
})
export class AllEmployeesComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly dataService = inject(AllEmployeesService);
  private readonly personPanel = inject(PersonProfilePanelService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly initialLimit = ORG_ALL_EMPLOYEES_INITIAL_LIMIT;

  // Spread to a mutable array so PrimeNG's mutable [options] input type accepts it without an unsafe cast.
  protected readonly activityOptions: OrgAllEmployeeActivityOption[] = [...ORG_ALL_EMPLOYEE_ACTIVITY_OPTIONS];

  protected readonly statSkeletonLabels: readonly string[] = [
    'Employees Active in Open Source',
    'In Governance',
    'Code Contributors',
    'Event Attendees',
    'Trainees',
  ];

  protected readonly tableSkeletonRows: readonly number[] = [0, 1, 2, 3, 4, 5];

  protected readonly searchTerm = signal<string>('');
  protected readonly selectedFoundationId = signal<string>('');
  protected readonly selectedActivity = signal<OrgAllEmployeeActivityFilter>('all');

  protected readonly sortColumn = signal<OrgAllEmployeeSortColumn>('name');
  protected readonly sortDirection = signal<OrgAllEmployeeSortDirection>(1);
  protected readonly limit = signal<number>(ORG_ALL_EMPLOYEES_INITIAL_LIMIT);

  // Expansion is per-(account, personKey) reset on account change → personKey is unique within an account, so keying by personKey alone is safe.
  protected readonly expansion = signal<Record<string, boolean>>({});

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
  protected readonly isLoading = this.loadingState.asReadonly();

  private readonly fetchErrorState = signal<boolean>(false);
  protected readonly fetchError = this.fetchErrorState.asReadonly();

  private readonly orgUid$ = toObservable(this.accountContext.selectedAccount).pipe(
    map((account) => account.uid),
    distinctUntilChanged()
  );

  protected readonly response: Signal<OrgAllEmployeesResponse> = toSignal(
    combineLatest([this.orgUid$, toObservable(this.retryTrigger)]).pipe(
      tap(() => {
        this.loadingState.set(true);
        this.fetchErrorState.set(false);
      }),
      switchMap(([orgUid]) => {
        if (!orgUid) {
          this.loadingState.set(false);
          return of(EMPTY_ORG_ALL_EMPLOYEES_RESPONSE);
        }
        return this.dataService.getAllEmployees(orgUid).pipe(
          tap(() => this.loadingState.set(false)),
          catchError(() => {
            this.fetchErrorState.set(true);
            this.loadingState.set(false);
            return of(EMPTY_ORG_ALL_EMPLOYEES_RESPONSE);
          })
        );
      })
    ),
    { initialValue: EMPTY_ORG_ALL_EMPLOYEES_RESPONSE }
  );

  protected readonly stats = computed(() => this.response().stats);

  protected readonly foundationOptions: Signal<OrgDropdownOption[]> = computed(() => this.initFoundationOptions());

  // Bake per-row derivatives (initials, avatar color) once per response; downstream filter/sort layers carry them through for free.
  protected readonly viewRows: Signal<AllEmployeeRowVm[]> = computed(() => this.initViewRows());

  protected readonly filteredRows: Signal<AllEmployeeRowVm[]> = computed(() => this.initFilteredRows());

  protected readonly sortedRows: Signal<AllEmployeeRowVm[]> = computed(() => this.initSortedRows());

  protected readonly totalFiltered = computed(() => this.sortedRows().length);

  protected readonly visibleRows = computed(() => this.sortedRows().slice(0, this.limit()));

  protected readonly canShowMore = computed(() => this.limit() < this.totalFiltered());

  protected readonly footerCountLabel: Signal<string> = computed(() => this.initFooterCountLabel());

  protected readonly isFiltering: Signal<boolean> = computed(() => this.initIsFiltering());

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
      toObservable(this.sortColumn),
      toObservable(this.sortDirection),
    ])
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => this.limit.set(ORG_ALL_EMPLOYEES_INITIAL_LIMIT));
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

  protected onRowKeydown(event: KeyboardEvent, row: OrgAllEmployeeRow): void {
    // Ignore events bubbled from interactive descendants (e.g. the inner name <button>) so a keypress on the button doesn't also toggle the row.
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.toggleRow(row);
  }

  protected toggleRow(row: OrgAllEmployeeRow): void {
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

  protected onPersonClick(row: OrgAllEmployeeRow): void {
    this.personPanel.open(row.name);
  }

  protected retry(): void {
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

  private initFoundationOptions(): OrgDropdownOption[] {
    return [{ label: 'All Foundations', value: '' }, ...this.response().foundations.map((f) => ({ label: f.foundationName, value: f.foundationId }))];
  }

  private initViewRows(): AllEmployeeRowVm[] {
    return this.response().rows.map((row) => ({
      ...row,
      initials: AllEmployeesComponent.computeInitials(row.name),
      avatarColorClass: AllEmployeesComponent.computeAvatarColorClass(row.personKey),
    }));
  }

  private initFilteredRows(): AllEmployeeRowVm[] {
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

  private initSortedRows(): AllEmployeeRowVm[] {
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
    return this.searchTerm().trim().length > 0 || !!this.selectedFoundationId() || this.selectedActivity() !== 'all';
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
    };
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
    this.sortColumn.set('name');
    this.sortDirection.set(1);
    this.limit.set(ORG_ALL_EMPLOYEES_INITIAL_LIMIT);
    this.expansion.set({});
    this.detailMap.set({});
    this.detailLoading.set({});
    this.detailErrorMap.set({});
  }

  private static numericSortValue(row: OrgAllEmployeeRow, column: Exclude<OrgAllEmployeeSortColumn, 'name'>): number {
    switch (column) {
      case 'seats':
        return row.seatsCount;
      case 'commits':
        return row.commitsCount;
      case 'events':
        return row.eventsCount;
      case 'courses':
        return row.coursesCount;
    }
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
