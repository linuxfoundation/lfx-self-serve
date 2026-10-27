// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  EMPTY_ORG_EVENT_ATTENDEES_RESPONSE,
  ORG_EVENT_ATTENDEES_INITIAL_LIMIT,
  ORG_LENS_DEFAULT_TIME_RANGE,
  ORG_LENS_TIME_RANGE_OPTIONS,
} from '@lfx-one/shared/constants';
import type {
  OrgDropdownOption,
  OrgEventAttendeeDetailRow,
  OrgEventAttendeeExpandedRowVm,
  OrgEventAttendeeRowVm,
  OrgEventAttendeesResponse,
  OrgEventAttendeeSortColumn,
  OrgEventAttendeeSortDirection,
  OrgEventAttendeeStatsBaseline,
  OrgLensTimeRange,
  OrgLensTimeRangeOption,
} from '@lfx-one/shared/interfaces';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, map, of, skip, switchMap, tap } from 'rxjs';

import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { AccountContextService } from '@services/account-context.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { avatarColorClass } from '@lfx-one/shared/utils';
import { formatLongDateUtc } from '@shared/utils/date-format.util';
import { readOrgLensTimeRange, syncOrgLensTimeRangeWithUrl } from '@shared/utils/org-lens-time-range-url.util';
import { computePersonInitials } from '@shared/utils/person-avatar.util';

import { EventAttendeesService } from '../../services/event-attendees.service';

import { filterEndedEventsInRange } from './event-attendees.util';

/** Event Attendees tab body — search + foundation + event + range filters, four stat cards, sortable table with chevron-toggled Events detail. */
@Component({
  selector: 'lfx-org-people-event-attendees',
  imports: [DecimalPipe, ReactiveFormsModule, EmptyStateComponent, InputTextComponent, SelectComponent, SkeletonModule],
  templateUrl: './event-attendees.component.html',
})
export class EventAttendeesComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly dataService = inject(EventAttendeesService);
  private readonly drawer = inject(PersonDetailDrawerService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly initialLimit = ORG_EVENT_ATTENDEES_INITIAL_LIMIT;
  protected readonly timeRangeOptions: OrgLensTimeRangeOption[] = [...ORG_LENS_TIME_RANGE_OPTIONS];
  protected readonly tableSkeletonRows: readonly number[] = [0, 1, 2, 3, 4, 5];
  protected readonly statSkeletonLabels: readonly string[] = ['Speakers', 'Attendees', 'Events', 'Foundations'];

  protected readonly filterForm = new FormGroup({
    search: new FormControl<string>('', { nonNullable: true }),
    foundation: new FormControl<string>('', { nonNullable: true }),
    event: new FormControl<string>('', { nonNullable: true }),
    // Follows `?range=` (shared with every People tab and Code Contributions).
    timeRange: new FormControl<OrgLensTimeRange>(readOrgLensTimeRange(this.route), { nonNullable: true }),
  });

  // WritableSignals — grouped per component-organization.md (writables → computed/toSignal).
  // Prototype-default sort is Events DESC, tiebreak Name ASC (Item 4 R4.4).
  protected readonly sortColumn = signal<OrgEventAttendeeSortColumn>('events');
  protected readonly sortDirection = signal<OrgEventAttendeeSortDirection>(-1);
  protected readonly limit = signal<number>(ORG_EVENT_ATTENDEES_INITIAL_LIMIT);
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

  protected readonly response: Signal<OrgEventAttendeesResponse> = this.initResponse();

  protected readonly foundationOptions: Signal<OrgDropdownOption[]> = computed(() => this.initFoundationOptions());

  // Registrations the selected range counts (ended events, ended in the range); the detail filters and the event dropdown both start here.
  private readonly rangeDetails: Signal<OrgEventAttendeeDetailRow[]> = computed(() =>
    filterEndedEventsInRange(this.response().details, this.filterValues().timeRange ?? ORG_LENS_DEFAULT_TIME_RANGE)
  );
  protected readonly eventOptions: Signal<OrgDropdownOption[]> = computed(() => this.initEventOptions());

  // Detail set is the canonical source — every filter-aware derivation (stats, rows, expanded section) reads it.
  protected readonly filteredDetails: Signal<OrgEventAttendeeDetailRow[]> = computed(() => this.initFilteredDetails());

  protected readonly stats: Signal<OrgEventAttendeeStatsBaseline> = computed(() => this.initStats());

  protected readonly viewRows: Signal<OrgEventAttendeeRowVm[]> = computed(() => this.initViewRows());

  protected readonly sortedRows: Signal<OrgEventAttendeeRowVm[]> = computed(() => this.initSortedRows());

  protected readonly totalFiltered = computed(() => this.sortedRows().length);
  protected readonly visibleRows = computed(() => this.sortedRows().slice(0, this.limit()));
  protected readonly canShowMore = computed(() => this.limit() < this.totalFiltered());

  protected readonly footerCountLabel: Signal<string> = computed(() => this.initFooterCountLabel());

  protected readonly isFiltering: Signal<boolean> = computed(() => this.initIsFiltering());

  protected readonly ariaSortMap: Signal<Record<OrgEventAttendeeSortColumn, 'ascending' | 'descending' | 'none'>> = computed(() => this.initAriaSortMap());

  protected readonly sortIconMap: Signal<Record<OrgEventAttendeeSortColumn, string>> = computed(() => this.initSortIconMap());

  // Lookup of expanded sub-row VMs keyed by personKey; computed from `filteredDetails()` so it recomputes when filters change.
  protected readonly expandedRowsMap: Signal<Record<string, OrgEventAttendeeExpandedRowVm[]>> = computed(() => this.initExpandedRowsMap());

  public constructor() {
    this.orgUid$.pipe(skip(1), takeUntilDestroyed()).subscribe(() => this.resetAllState());

    combineLatest([toObservable(this.sortColumn), toObservable(this.sortDirection)])
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => this.limit.set(ORG_EVENT_ATTENDEES_INITIAL_LIMIT));

    this.filterForm.valueChanges.pipe(debounceTime(150), takeUntilDestroyed()).subscribe(() => {
      this.limit.set(ORG_EVENT_ATTENDEES_INITIAL_LIMIT);
      this.expansion.set({});
    });

    syncOrgLensTimeRangeWithUrl(this.filterForm.controls.timeRange, this.route, this.router);

    // A range change can drop the picked event from the dropdown; once loaded, clear the control too so the dropdown
    // shows All Events (the detail filter already ignores an event the options no longer offer).
    combineLatest([toObservable(this.eventOptions), toObservable(this.isLoading)])
      .pipe(takeUntilDestroyed())
      .subscribe(([options, loading]) => {
        const selected = this.filterForm.controls.event.value;
        if (!loading && selected && !options.some((option) => option.value === selected)) this.filterForm.patchValue({ event: '' });
      });
  }

  protected onSort(column: OrgEventAttendeeSortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.update((d) => (d === 1 ? -1 : 1));
      return;
    }
    this.sortColumn.set(column);
    // Name + role (string columns) ascend on first click; numeric / date columns descend.
    this.sortDirection.set(column === 'name' || column === 'role' ? 1 : -1);
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

  protected onPersonClick(row: OrgEventAttendeeRowVm, event: Event): void {
    event.stopPropagation();
    this.drawer.open({
      personKey: row.personKey,
      name: row.name,
      title: row.title,
      initials: row.initials,
      avatarColorClass: row.avatarColorClass,
      defaultTab: 'events',
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

  /** Only events the range counts (at least one registration passing the ended-in-range rule), in the BFF's order. */
  private initEventOptions(): OrgDropdownOption[] {
    const inRange = new Set(this.rangeDetails().map((row) => row.eventId));
    return [
      { label: 'All Events', value: '' },
      ...this.response()
        .eventOptions.filter((e) => inRange.has(e.eventId))
        .map((e) => ({ label: e.eventName, value: e.eventId })),
    ];
  }

  private initFilteredDetails(): OrgEventAttendeeDetailRow[] {
    const values = this.filterValues();
    const q = (values.search ?? '').trim().toLowerCase();
    const foundationId = values.foundation ?? '';
    // An event the range no longer offers filters nothing, from the same snapshot as the options: the control's own clear
    // lands a debounce later, and filtering on the dropped id until then would empty the table.
    const picked = values.event ?? '';
    const eventId = picked && this.eventOptions().some((option) => option.value === picked) ? picked : '';

    // Build a name+title lookup so search filters details by who-the-person-is, not by per-row strings (R1.1 — no email, no event-name).
    const personIndex = new Map<string, { name: string; title: string | null }>();
    for (const a of this.response().attendees) {
      personIndex.set(a.personKey, { name: a.name, title: a.title });
    }

    return this.rangeDetails().filter((row) => {
      if (foundationId && row.foundationId !== foundationId) return false;
      if (eventId && row.eventId !== eventId) return false;
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

  private initStats(): OrgEventAttendeeStatsBaseline {
    // Stats always reflect the currently-filtered details so all four cards stay in lockstep with the table (Item 3 lock — diverges from All Employees intentionally).
    const details = this.filteredDetails();
    const attendees = new Set<string>();
    const speakers = new Set<string>();
    const events = new Set<string>();
    const foundations = new Set<string>();
    for (const d of details) {
      attendees.add(d.personKey);
      if (d.isSpeaker) speakers.add(d.personKey);
      events.add(d.eventId);
      if (d.foundationId) foundations.add(d.foundationId);
    }
    return {
      speakers: speakers.size,
      attendees: attendees.size,
      events: events.size,
      foundations: foundations.size,
    };
  }

  private initViewRows(): OrgEventAttendeeRowVm[] {
    const details = this.filteredDetails();
    if (details.length === 0) return [];

    const detailsByPerson = new Map<string, OrgEventAttendeeDetailRow[]>();
    for (const d of details) {
      const list = detailsByPerson.get(d.personKey) ?? [];
      list.push(d);
      detailsByPerson.set(d.personKey, list);
    }

    const out: OrgEventAttendeeRowVm[] = [];
    for (const attendee of this.response().attendees) {
      const personDetails = detailsByPerson.get(attendee.personKey);
      if (!personDetails || personDetails.length === 0) continue;

      const eventIds = new Set<string>();
      let anySpeaker = false;
      let lastAttendedTs: string | null = null;
      for (const d of personDetails) {
        eventIds.add(d.eventId);
        if (d.isSpeaker) anySpeaker = true;
        if (d.eventEndDate && (!lastAttendedTs || d.eventEndDate > lastAttendedTs)) {
          lastAttendedTs = d.eventEndDate;
        }
      }

      const recent = pickMostRecent(personDetails);

      out.push({
        personKey: attendee.personKey,
        name: attendee.name,
        title: attendee.title,
        email: attendee.email,
        initials: computePersonInitials(attendee.name),
        avatarColorClass: avatarColorClass(attendee.personKey),
        role: anySpeaker ? 'Speaker' : 'Attendee',
        eventsCount: eventIds.size,
        lastAttendedTs,
        lastAttendedLabel: lastAttendedTs ? formatLongDateUtc(lastAttendedTs) : '—',
        mostRecentEventName: recent?.eventName ?? null,
        mostRecentFoundationName: recent?.foundationName ?? null,
      });
    }

    return out;
  }

  private initSortedRows(): OrgEventAttendeeRowVm[] {
    const rows = this.viewRows();
    const col = this.sortColumn();
    const dir = this.sortDirection();
    const copy = [...rows];
    copy.sort((a, b) => {
      switch (col) {
        case 'name':
          return a.name.localeCompare(b.name) * dir;
        case 'role': {
          // Speaker > Attendee. ASC puts Attendees first, DESC puts Speakers first.
          const va = a.role === 'Speaker' ? 1 : 0;
          const vb = b.role === 'Speaker' ? 1 : 0;
          if (va !== vb) return (va - vb) * dir;
          return a.name.localeCompare(b.name);
        }
        case 'events': {
          if (a.eventsCount !== b.eventsCount) return (a.eventsCount - b.eventsCount) * dir;
          return a.name.localeCompare(b.name);
        }
        case 'lastAttended': {
          const ta = a.lastAttendedTs ?? '';
          const tb = b.lastAttendedTs ?? '';
          if (ta !== tb) return ta > tb ? dir : -dir;
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
    const hasEvent = !!(values.event ?? '');
    const hasTimeFilter = (values.timeRange ?? ORG_LENS_DEFAULT_TIME_RANGE) !== ORG_LENS_DEFAULT_TIME_RANGE;
    return hasSearch || hasFoundation || hasEvent || hasTimeFilter;
  }

  private initAriaSortMap(): Record<OrgEventAttendeeSortColumn, 'ascending' | 'descending' | 'none'> {
    const active = this.sortColumn();
    const direction: 'ascending' | 'descending' = this.sortDirection() === 1 ? 'ascending' : 'descending';
    return {
      name: active === 'name' ? direction : 'none',
      role: active === 'role' ? direction : 'none',
      events: active === 'events' ? direction : 'none',
      lastAttended: active === 'lastAttended' ? direction : 'none',
    };
  }

  private initSortIconMap(): Record<OrgEventAttendeeSortColumn, string> {
    const active = this.sortColumn();
    const activeIcon = this.sortDirection() === 1 ? 'fa-light fa-sort-up' : 'fa-light fa-sort-down';
    const iconFor = (col: OrgEventAttendeeSortColumn): string => (active === col ? activeIcon : 'fa-light fa-sort');
    return {
      name: iconFor('name'),
      role: iconFor('role'),
      events: iconFor('events'),
      lastAttended: iconFor('lastAttended'),
    };
  }

  private initExpandedRowsMap(): Record<string, OrgEventAttendeeExpandedRowVm[]> {
    const detailsByPerson = new Map<string, OrgEventAttendeeDetailRow[]>();
    for (const d of this.filteredDetails()) {
      const list = detailsByPerson.get(d.personKey) ?? [];
      list.push(d);
      detailsByPerson.set(d.personKey, list);
    }
    const out: Record<string, OrgEventAttendeeExpandedRowVm[]> = {};
    for (const [personKey, rows] of detailsByPerson) {
      out[personKey] = collapseExpandedRows(rows);
    }
    return out;
  }

  private initResponse(): Signal<OrgEventAttendeesResponse> {
    return toSignal(
      combineLatest([this.orgUid$, toObservable(this.retryTrigger)]).pipe(
        tap(() => {
          this.loadingState.set(true);
          this.fetchErrorState.set(false);
        }),
        switchMap(([orgUid]) => {
          if (!orgUid) {
            this.loadingState.set(false);
            return of(EMPTY_ORG_EVENT_ATTENDEES_RESPONSE);
          }
          return this.dataService.getEventAttendees(orgUid).pipe(
            tap(() => this.loadingState.set(false)),
            catchError(() => {
              this.fetchErrorState.set(true);
              this.loadingState.set(false);
              return of(EMPTY_ORG_EVENT_ATTENDEES_RESPONSE);
            })
          );
        })
      ),
      { initialValue: EMPTY_ORG_EVENT_ATTENDEES_RESPONSE }
    );
  }

  private resetAllState(): void {
    // The range is page-level URL state, not per-org, so an org switch keeps it.
    this.filterForm.patchValue({ search: '', foundation: '', event: '' });
    this.sortColumn.set('events');
    this.sortDirection.set(-1);
    this.limit.set(ORG_EVENT_ATTENDEES_INITIAL_LIMIT);
    this.expansion.set({});
  }
}

/** Most-recent row per Item 4 R4.3 tiebreak: EVENT_END_DATE DESC NULLS LAST → EVENT_NAME ASC → EVENT_ID ASC. */
function pickMostRecent(rows: OrgEventAttendeeDetailRow[]): OrgEventAttendeeDetailRow | null {
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

function compareMostRecent(a: OrgEventAttendeeDetailRow, b: OrgEventAttendeeDetailRow): number {
  const ta = a.eventEndDate ?? '';
  const tb = b.eventEndDate ?? '';
  if (ta !== tb) return ta > tb ? -1 : 1;
  const cmp = a.eventName.localeCompare(b.eventName);
  if (cmp !== 0) return cmp;
  return a.eventId.localeCompare(b.eventId);
}

/** Collapse per-(person, event) rows; 1:1 map + location fallback + sort EVENT_END_DATE DESC NULLS LAST → EVENT_NAME ASC → EVENT_ID ASC (R5.4). */
function collapseExpandedRows(rows: OrgEventAttendeeDetailRow[]): OrgEventAttendeeExpandedRowVm[] {
  const out: OrgEventAttendeeExpandedRowVm[] = rows.map((r) => ({
    eventId: r.eventId,
    eventName: r.eventName,
    locationLabel: resolveLocationLabel(r),
    role: r.isSpeaker ? 'Speaker' : 'Attendee',
    startTs: r.eventStartDate,
    startLabel: r.eventStartDate ? formatLongDateUtc(r.eventStartDate) : '—',
    sortTs: r.eventEndDate,
  }));

  return out.sort((a, b) => {
    const ta = a.sortTs ?? '';
    const tb = b.sortTs ?? '';
    if (ta !== tb) return ta > tb ? -1 : 1;
    const cmp = a.eventName.localeCompare(b.eventName);
    if (cmp !== 0) return cmp;
    return a.eventId.localeCompare(b.eventId);
  });
}

/** Subtext fallback (R5): eventLocation → city+country (or either alone) → foundationName → null. */
function resolveLocationLabel(row: OrgEventAttendeeDetailRow): string | null {
  if (row.eventLocation) return row.eventLocation;
  const city = row.eventCity ?? '';
  const country = row.eventCountry ?? '';
  if (city && country) return `${city}, ${country}`;
  if (city) return city;
  if (country) return country;
  return row.foundationName ?? null;
}
