// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import {
  EMPTY_ORG_CONTRIBUTORS_RESPONSE,
  ORG_CONTRIBUTOR_DEFAULT_TIME_RANGE,
  ORG_CONTRIBUTOR_TIME_RANGE_OPTIONS,
  ORG_CONTRIBUTORS_INITIAL_LIMIT,
} from '@lfx-one/shared/constants';
import type {
  OrgContributorExpandedRowVm,
  OrgContributorProjectRow,
  OrgContributorRow,
  OrgContributorRowVm,
  OrgContributorsResponse,
  OrgContributorSortColumn,
  OrgContributorSortDirection,
  OrgContributorTimeRange,
  OrgContributorTimeRangeOption,
  OrgDropdownOption,
} from '@lfx-one/shared/interfaces';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, map, of, skip, switchMap, tap } from 'rxjs';

import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { AccountContextService } from '@services/account-context.service';
import { PersonProfilePanelService } from '@services/person-profile-panel.service';
import { formatLongDateUtc } from '@shared/utils/date-format.util';
import { computePersonAvatarColorClass, computePersonInitials } from '@shared/utils/person-avatar.util';

import { ContributorsService } from '../../services/contributors.service';

/** Contributors tab body — search + foundation + project + time-range filter trio, four stat cards (Maintainers / Contributors / Projects / Foundations), sortable table with chevron-toggled per-project Projects Involved sub-table. */
@Component({
  selector: 'lfx-org-people-contributors',
  imports: [DecimalPipe, ReactiveFormsModule, EmptyStateComponent, InputTextComponent, SelectComponent, SkeletonModule],
  templateUrl: './contributors.component.html',
})
export class ContributorsComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly dataService = inject(ContributorsService);
  private readonly personPanel = inject(PersonProfilePanelService);

  protected readonly initialLimit = ORG_CONTRIBUTORS_INITIAL_LIMIT;
  protected readonly timeRangeOptions: OrgContributorTimeRangeOption[] = [...ORG_CONTRIBUTOR_TIME_RANGE_OPTIONS];
  protected readonly tableSkeletonRows: readonly number[] = [0, 1, 2, 3, 4, 5];
  protected readonly statSkeletonLabels: readonly string[] = ['Maintainers', 'Contributors', 'Projects', 'Foundations'];

  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
    foundation: new FormControl<string>('', { nonNullable: true }),
    project: new FormControl<string>('', { nonNullable: true }),
    timeRange: new FormControl<OrgContributorTimeRange>(ORG_CONTRIBUTOR_DEFAULT_TIME_RANGE, { nonNullable: true }),
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
  private readonly filterValues = toSignal(this.filterForm.valueChanges.pipe(debounceTime(150)), {
    initialValue: this.filterForm.getRawValue(),
  });

  private readonly orgUid$ = toObservable(this.accountContext.selectedAccount).pipe(
    map((account) => account.uid),
    distinctUntilChanged()
  );

  // Time range observable feeds the BFF refetch (A1 architecture: one slice per timeRange). distinctUntilChanged guards against duplicate emits when the form is reset to its current value.
  private readonly timeRange$ = toObservable(this.timeRangeControl()).pipe(distinctUntilChanged());

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
    this.personPanel.open(row.displayName);
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
    return this.filteredContributors().map((c) => ({
      personKey: c.personKey,
      displayName: c.displayName,
      title: c.title,
      initials: computePersonInitials(c.displayName),
      avatarColorClass: computePersonAvatarColorClass(c.personKey),
      role: c.role,
      commits: c.commits,
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
          // Maintainer < Contributor in alpha order. ASC default puts Maintainers first; tiebreak commits desc (Item 4 R4.4 lock).
          const va = a.role === 'Maintainer' ? 0 : 1;
          const vb = b.role === 'Maintainer' ? 0 : 1;
          if (va !== vb) return (va - vb) * dir;
          if (a.commits !== b.commits) return b.commits - a.commits;
          return a.displayName.localeCompare(b.displayName);
        }
        case 'commits': {
          if (a.commits !== b.commits) return (a.commits - b.commits) * dir;
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
    const timeRange: OrgContributorTimeRange = values.timeRange ?? ORG_CONTRIBUTOR_DEFAULT_TIME_RANGE;
    const hasTimeFilter = timeRange !== ORG_CONTRIBUTOR_DEFAULT_TIME_RANGE;
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
      out[personKey] = collapseExpandedRows(projects);
    }
    return out;
  }

  private initResponse(): Signal<OrgContributorsResponse> {
    return toSignal(
      combineLatest([this.orgUid$, this.timeRange$, toObservable(this.retryTrigger)]).pipe(
        tap(() => {
          this.loadingState.set(true);
          this.fetchErrorState.set(false);
        }),
        switchMap(([orgUid, timeRange]) => {
          if (!orgUid) {
            return of({ ...EMPTY_ORG_CONTRIBUTORS_RESPONSE, timeRange });
          }
          return this.dataService.getContributors(orgUid, timeRange).pipe(
            tap(() => this.loadingState.set(false)),
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

  /**
   * Project the timeRange form control to a stable Signal so toObservable() can wrap it without re-subscribing on every form-level emit. valueChanges is used directly with debounce above for the filter trio; this one fires on every distinct value so the BFF refetch is precise.
   */
  private timeRangeControl(): Signal<OrgContributorTimeRange> {
    return toSignal(this.filterForm.controls.timeRange.valueChanges, {
      initialValue: this.filterForm.controls.timeRange.value,
    });
  }

  private resetAllState(): void {
    this.filterForm.reset({ search: '', foundation: '', project: '', timeRange: ORG_CONTRIBUTOR_DEFAULT_TIME_RANGE });
    this.sortColumn.set('role');
    this.sortDirection.set(1);
    this.limit.set(ORG_CONTRIBUTORS_INITIAL_LIMIT);
    this.expansion.set({});
  }
}

/**
 * Collapse per-(person, project) rows into expansion sub-table VMs.
 * Pre-sorted by Commits desc, then last_active desc, then alpha project name
 * (Item 5 R5 lock — sub-table is non-interactive so the sort is server-stable).
 */
function collapseExpandedRows(rows: OrgContributorProjectRow[]): OrgContributorExpandedRowVm[] {
  const out: OrgContributorExpandedRowVm[] = rows.map((r) => ({
    projectId: r.projectId,
    projectName: r.projectName,
    foundationName: r.foundationName,
    role: r.role,
    commits: r.commits,
    lastActiveTs: r.lastActiveTs,
    lastActiveLabel: r.lastActiveTs ? formatLongDateUtc(r.lastActiveTs) : '—',
  }));

  return out.sort((a, b) => {
    if (a.commits !== b.commits) return b.commits - a.commits;
    const ta = a.lastActiveTs ?? '';
    const tb = b.lastActiveTs ?? '';
    if (ta !== tb) return ta > tb ? -1 : 1;
    return a.projectName.localeCompare(b.projectName);
  });
}
