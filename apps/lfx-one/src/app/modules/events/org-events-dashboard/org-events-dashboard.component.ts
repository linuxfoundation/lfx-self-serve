// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MessageService } from 'primeng/api';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, filter, finalize, of, skip, switchMap, tap } from 'rxjs';

import { CardComponent } from '@components/card/card.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { OrgLensEmptyStateComponent } from '@components/org-lens-empty-state/org-lens-empty-state.component';
import { PageHeaderComponent } from '@components/page-header/page-header.component';
import { SelectComponent } from '@components/select/select.component';
import {
  DEFAULT_EVENTS_PAGE_SIZE,
  DEFAULT_ORG_EVENTS_PARTICIPATION,
  DEFAULT_ORG_EVENTS_SCOPE,
  DEFAULT_ORG_EVENTS_TAB_ID,
  EMPTY_ORG_EVENTS_RESPONSE,
  ORG_EVENTS_ALL_FOUNDATIONS_LABEL,
  ORG_EVENTS_EMPLOYEE_MATCH_CAPTION_PHRASE,
  ORG_EVENTS_FOUNDATION_QUERY_PARAM,
  ORG_EVENTS_PARTICIPATION_CAPTION_PHRASE,
  ORG_EVENTS_PARTICIPATION_LABEL,
  ORG_EVENTS_PARTICIPATION_OPTIONS,
  ORG_EVENTS_PARTICIPATION_QUERY_PARAM,
  ORG_EVENTS_PARTICIPATION_TOOLTIP,
  ORG_EVENTS_PARTICIPATION_UPCOMING_NOTE,
  ORG_EVENTS_SCOPE_LABEL,
  ORG_EVENTS_SCOPE_OPTIONS,
  ORG_EVENTS_SCOPE_QUERY_PARAM,
  ORG_EVENTS_STATUS_OPTIONS,
  ORG_EVENTS_TABS,
  ORG_LENS_DEFAULT_TIME_RANGE,
  ORG_LENS_TIME_RANGE_OPTIONS,
  ORG_LENS_TIME_RANGE_QUERY_PARAM,
  VALID_ORG_EVENTS_TAB_IDS,
} from '@lfx-one/shared/constants';
import type {
  FilterPillOption,
  OrgDropdownOption,
  OrgEvent,
  OrgEventFoundationsResponse,
  OrgEventsParticipation,
  OrgEventsResponse,
  OrgEventsScope,
  OrgEventsSummary,
  OrgEventStatFilterId,
  OrgEventsTabId,
  OrgLensTimeRange,
  PageChangeEvent,
  SortChangeEvent,
} from '@lfx-one/shared/interfaces';
import { effectiveOrgEventsParticipation, orgLensTimeRangeUrlParam } from '@lfx-one/shared/utils';
import { AccountContextService } from '@services/account-context.service';
import { EventsService } from '@services/events.service';
import { OrgLensEmptyStateService } from '@services/org-lens-empty-state.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import {
  readOrgEventsFoundation,
  readOrgEventsParticipation,
  readOrgEventsScope,
  syncOrgEventsFoundationWithUrl,
  syncOrgEventsParticipationWithUrl,
  syncOrgEventsScopeWithUrl,
} from '@shared/utils/org-events-filters-url.util';
import { readOrgLensTimeRange, syncOrgLensTimeRangeWithUrl } from '@shared/utils/org-lens-time-range-url.util';

import { DiscoverEventsButtonComponent } from '../components/discover-events-button/discover-events-button.component';
import { EventAttendeesDrawerComponent } from './components/event-attendees-drawer/event-attendees-drawer.component';
import { EventSpeakersDrawerComponent } from './components/event-speakers-drawer/event-speakers-drawer.component';
import { OrgEventsTableComponent } from './components/org-events-table/org-events-table.component';

@Component({
  selector: 'lfx-org-events-dashboard',
  imports: [
    PageHeaderComponent,
    FormsModule,
    ReactiveFormsModule,
    CardComponent,
    CardTabsBarComponent,
    OrgLensEmptyStateComponent,
    SelectModule,
    SelectComponent,
    InputTextModule,
    SkeletonModule,
    DiscoverEventsButtonComponent,
    EventAttendeesDrawerComponent,
    EventSpeakersDrawerComponent,
    OrgEventsTableComponent,
  ],
  templateUrl: './org-events-dashboard.component.html',
})
export class OrgEventsDashboardComponent {
  // === Private injections ===
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly accountContext = inject(AccountContextService);
  private readonly eventsService = inject(EventsService);
  private readonly messageService = inject(MessageService);
  private readonly orgRoleGrantsService = inject(OrgRoleGrantsService);

  // === Public injections ===
  public readonly emptyState = inject(OrgLensEmptyStateService);

  // === Template constants ===
  public readonly statusOptions = ORG_EVENTS_STATUS_OPTIONS;
  public readonly timeRangeOptions = [...ORG_LENS_TIME_RANGE_OPTIONS];
  public readonly participationOptions = [...ORG_EVENTS_PARTICIPATION_OPTIONS];
  public readonly scopeOptions = [...ORG_EVENTS_SCOPE_OPTIONS];
  public readonly participationLabel = ORG_EVENTS_PARTICIPATION_LABEL;
  public readonly scopeLabel = ORG_EVENTS_SCOPE_LABEL;

  // === Filter form ===
  // Range, foundation, count and show follow `?range=`, `?foundation=`, `?participation=` and `?eventScope=` (lfx-self-serve#4598):
  // written back on change, dropped at the default, carried across tabs.
  public readonly filterForm = new FormGroup({
    timeRange: new FormControl<OrgLensTimeRange>(readOrgLensTimeRange(this.route), { nonNullable: true }),
    foundation: new FormControl<string>(readOrgEventsFoundation(this.route), { nonNullable: true }),
    participation: new FormControl<OrgEventsParticipation>(readOrgEventsParticipation(this.route), { nonNullable: true }),
    scope: new FormControl<OrgEventsScope>(readOrgEventsScope(this.route), { nonNullable: true }),
  });

  // === WritableSignals ===
  public readonly attendeesDrawerVisible = signal(false);
  public readonly speakersDrawerVisible = signal(false);
  public readonly activeDrawerEvent = signal<OrgEvent | null>(null);
  public readonly searchTerm = signal('');
  public readonly selectedStatus = signal<string | null>(null);
  public readonly upcomingEventsLoading = signal(true);
  public readonly upcomingEventsPage = signal<PageChangeEvent>({ offset: 0, pageSize: DEFAULT_EVENTS_PAGE_SIZE });
  public readonly upcomingSortField = signal('EVENT_START_DATE');
  public readonly upcomingSortOrder = signal<'ASC' | 'DESC'>('ASC');
  public readonly pastEventsLoading = signal(true);
  public readonly pastEventsPage = signal<PageChangeEvent>({ offset: 0, pageSize: DEFAULT_EVENTS_PAGE_SIZE });
  public readonly pastSortField = signal('EVENT_START_DATE');
  public readonly pastSortOrder = signal<'ASC' | 'DESC'>('DESC');

  // === Computed / toSignal ===
  // Debounced search feeds the server-side query so typing doesn't fire a request per keystroke.
  private readonly debouncedSearchTerm = toSignal(toObservable(this.searchTerm).pipe(debounceTime(300), distinctUntilChanged()), { initialValue: '' });
  public readonly companyName = computed(() => this.accountContext.selectedAccount().accountName ?? '');
  // Spec 053 / #2961 — the page-level state replacing the page (`could-not-load`, `staff-check-failed`,
  // `contractor-no-grant`, `no-organization`), or null when the page renders.
  public readonly pageState = this.emptyState.pageState;
  public readonly correlationId = this.orgRoleGrantsService.correlationId;
  // The page's content, its org-naming title and its fetches wait for the classifier and never appear
  // behind a page-level state: a refused caller's reads would only fail and toast "Failed to load".
  public readonly contentVisible = computed(() => this.emptyState.settled() && !this.emptyState.hasPageState());
  public readonly activeTab: Signal<OrgEventsTabId> = this.initActiveTab();
  // The pickers, undebounced: each one drives the reads.
  private readonly timeRange: Signal<OrgLensTimeRange> = toSignal(this.filterForm.controls.timeRange.valueChanges, {
    initialValue: this.filterForm.controls.timeRange.value,
  });
  private readonly foundation: Signal<string> = toSignal(this.filterForm.controls.foundation.valueChanges, {
    initialValue: this.filterForm.controls.foundation.value,
  });
  private readonly participation: Signal<OrgEventsParticipation> = toSignal(this.filterForm.controls.participation.valueChanges, {
    initialValue: this.filterForm.controls.participation.value,
  });
  private readonly scope: Signal<OrgEventsScope> = toSignal(this.filterForm.controls.scope.valueChanges, {
    initialValue: this.filterForm.controls.scope.value,
  });
  // Count reads registrations on the Upcoming tab, where no one has attended yet.
  private readonly effectiveParticipation = computed(() => effectiveOrgEventsParticipation(this.participation(), this.activeTab() === 'past'));
  // What the tiles and the foundation options read: not the tab, search or status.
  private readonly tileFilters = computed(() => ({
    eventScope: this.scope(),
    foundation: this.foundation(),
    range: this.timeRange(),
  }));
  public readonly foundationsResponse: Signal<OrgEventFoundationsResponse | null> = this.initFoundationsResponse();
  public readonly foundationOptions: Signal<OrgDropdownOption[]> = computed(() => [
    { label: ORG_EVENTS_ALL_FOUNDATIONS_LABEL, value: '' },
    ...(this.foundationsResponse()?.data ?? []).map((foundation) => ({ label: foundation.name, value: foundation.id })),
  ]);
  public readonly isPastTab = computed(() => this.activeTab() === 'past');
  public readonly countDisabledTitle = computed(() => (this.isPastTab() ? null : ORG_EVENTS_PARTICIPATION_UPCOMING_NOTE));
  public readonly countTooltip = computed(() =>
    this.isPastTab() ? ORG_EVENTS_PARTICIPATION_TOOLTIP[this.participation()] : ORG_EVENTS_PARTICIPATION_UPCOMING_NOTE
  );
  public readonly canClearFilters = computed(
    () =>
      this.searchTerm() !== '' ||
      this.selectedStatus() !== null ||
      this.timeRange() !== ORG_LENS_DEFAULT_TIME_RANGE ||
      this.foundation() !== '' ||
      this.participation() !== DEFAULT_ORG_EVENTS_PARTICIPATION ||
      this.scope() !== DEFAULT_ORG_EVENTS_SCOPE
  );
  public readonly eventsSummary: Signal<OrgEventsSummary | null> = this.initEventsSummary();
  public readonly upcomingAttendeesCaption = computed(
    () => `${ORG_EVENTS_PARTICIPATION_CAPTION_PHRASE.registered} ${ORG_EVENTS_EMPLOYEE_MATCH_CAPTION_PHRASE}`
  );
  public readonly pastAttendeesCaption = computed(
    () => `${ORG_EVENTS_PARTICIPATION_CAPTION_PHRASE[this.participation()]} ${ORG_EVENTS_EMPLOYEE_MATCH_CAPTION_PHRASE}`
  );
  public readonly drawerParticipation = this.effectiveParticipation;
  public readonly upcomingEvents: Signal<OrgEventsResponse> = this.initEventsPipeline({
    tab: 'upcoming',
    page: this.upcomingEventsPage,
    sortField: this.upcomingSortField,
    sortOrder: this.upcomingSortOrder,
    loading: this.upcomingEventsLoading,
    isPast: false,
    errorDetail: 'Failed to load upcoming events. Please try again.',
  });
  public readonly pastEvents: Signal<OrgEventsResponse> = this.initEventsPipeline({
    tab: 'past',
    page: this.pastEventsPage,
    sortField: this.pastSortField,
    sortOrder: this.pastSortOrder,
    loading: this.pastEventsLoading,
    isPast: true,
    errorDetail: 'Failed to load past events. Please try again.',
  });
  public readonly tabPillOptions = computed<FilterPillOption[]>(() => {
    const summary = this.eventsSummary();
    return ORG_EVENTS_TABS.map((tab) => {
      let count: number | null = null;
      if (summary !== null) {
        count = tab.id === 'upcoming' ? summary.upcomingEvents : summary.pastEvents;
      }
      return { id: tab.id, label: count !== null ? `${tab.label} (${count})` : tab.label };
    });
  });

  public constructor() {
    combineLatest([toObservable(this.debouncedSearchTerm), toObservable(this.selectedStatus), toObservable(this.tileFilters), toObservable(this.participation)])
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => {
        this.upcomingEventsPage.set({ offset: 0, pageSize: this.upcomingEventsPage().pageSize });
        this.pastEventsPage.set({ offset: 0, pageSize: this.pastEventsPage().pageSize });
      });

    syncOrgLensTimeRangeWithUrl(this.filterForm.controls.timeRange, this.route, this.router);
    syncOrgEventsFoundationWithUrl(this.filterForm.controls.foundation, this.route, this.router);
    syncOrgEventsParticipationWithUrl(this.filterForm.controls.participation, this.route, this.router);
    syncOrgEventsScopeWithUrl(this.filterForm.controls.scope, this.route, this.router);

    // Count is disabled on the Upcoming tab (it always counts registrations); the picked value is kept for the Past tab.
    toObservable(this.isPastTab)
      .pipe(takeUntilDestroyed())
      .subscribe((isPast) => {
        const control = this.filterForm.controls.participation;
        if (isPast) control.enable({ emitEvent: false });
        else control.disable({ emitEvent: false });
      });

    // A foundation the options no longer offer (another "Show") is cleared once the options have loaded. An empty
    // list proves nothing: the BFF answers an upstream failure with no options, so the pick is left alone.
    toObservable(this.foundationsResponse)
      .pipe(
        filter((response): response is OrgEventFoundationsResponse => response !== null),
        takeUntilDestroyed()
      )
      .subscribe((response) => {
        const selected = this.filterForm.controls.foundation.value;
        if (selected && response.data.length > 0 && !response.data.some((foundation) => foundation.id === selected))
          this.filterForm.controls.foundation.setValue('');
      });
  }

  // === Public methods ===
  // Stat cards are tab shortcuts: Upcoming/Total jump to the upcoming tab, Past to the past tab.
  public onStatCardClick(id: OrgEventStatFilterId): void {
    this.switchTab(id === 'past' ? 'past' : 'upcoming');
  }

  /** Every filter back to its default; the URL-backed ones reset through one URL write and the pickers follow it, `tab` is kept. */
  public clearFilters(): void {
    this.searchTerm.set('');
    this.selectedStatus.set(null);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        [ORG_LENS_TIME_RANGE_QUERY_PARAM]: orgLensTimeRangeUrlParam(ORG_LENS_DEFAULT_TIME_RANGE),
        [ORG_EVENTS_FOUNDATION_QUERY_PARAM]: null,
        [ORG_EVENTS_PARTICIPATION_QUERY_PARAM]: null,
        [ORG_EVENTS_SCOPE_QUERY_PARAM]: null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  public switchTab(tabId: string): void {
    if (!VALID_ORG_EVENTS_TAB_IDS.has(tabId as OrgEventsTabId)) {
      return;
    }
    if (tabId === this.activeTab()) {
      return;
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tabId === DEFAULT_ORG_EVENTS_TAB_ID ? null : tabId },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  public onAttendeesClick(event: OrgEvent): void {
    this.activeDrawerEvent.set(event);
    this.speakersDrawerVisible.set(false);
    this.attendeesDrawerVisible.set(true);
  }

  public onSpeakersClick(event: OrgEvent): void {
    this.activeDrawerEvent.set(event);
    this.attendeesDrawerVisible.set(false);
    this.speakersDrawerVisible.set(true);
  }

  public onUpcomingPageChange(event: PageChangeEvent): void {
    this.upcomingEventsLoading.set(true);
    this.upcomingEventsPage.set(event);
  }

  public onUpcomingSortChange(event: SortChangeEvent): void {
    if (this.upcomingSortField() === event.field) {
      this.upcomingSortOrder.set(this.upcomingSortOrder() === 'ASC' ? 'DESC' : 'ASC');
    } else {
      this.upcomingSortField.set(event.field);
      this.upcomingSortOrder.set('ASC');
    }
    this.upcomingEventsPage.set({ offset: 0, pageSize: this.upcomingEventsPage().pageSize });
  }

  public onPastPageChange(event: PageChangeEvent): void {
    this.pastEventsLoading.set(true);
    this.pastEventsPage.set(event);
  }

  public onPastSortChange(event: SortChangeEvent): void {
    if (this.pastSortField() === event.field) {
      this.pastSortOrder.set(this.pastSortOrder() === 'ASC' ? 'DESC' : 'ASC');
    } else {
      this.pastSortField.set(event.field);
      this.pastSortOrder.set('ASC');
    }
    this.pastEventsPage.set({ offset: 0, pageSize: this.pastEventsPage().pageSize });
  }

  // === Private initializers ===
  private initActiveTab(): Signal<OrgEventsTabId> {
    const queryParamMap = toSignal(this.route.queryParamMap, {
      initialValue: this.route.snapshot.queryParamMap,
    });
    return computed(() => {
      const raw = queryParamMap().get('tab');
      return raw && VALID_ORG_EVENTS_TAB_IDS.has(raw as OrgEventsTabId) ? (raw as OrgEventsTabId) : DEFAULT_ORG_EVENTS_TAB_ID;
    });
  }

  private initEventsSummary(): Signal<OrgEventsSummary | null> {
    const query$ = toObservable(
      computed(() => {
        const accountId = this.contentVisible() ? this.accountContext.selectedAccount().accountId : null;
        return accountId ? { accountId, ...this.tileFilters() } : null;
      })
    );
    return toSignal(
      query$.pipe(
        filter((query): query is NonNullable<typeof query> => query !== null),
        switchMap(({ accountId, ...params }) => this.eventsService.getOrgEventsSummary(accountId, params).pipe(catchError(() => of(null))))
      ),
      { initialValue: null }
    );
  }

  // Foundations with events under the picked "Show"; `null` until loaded or when the read fails.
  private initFoundationsResponse(): Signal<OrgEventFoundationsResponse | null> {
    const query$ = toObservable(
      computed(() => {
        const accountId = this.contentVisible() ? this.accountContext.selectedAccount().accountId : null;
        return accountId ? { accountId, eventScope: this.scope() } : null;
      })
    ).pipe(distinctUntilChanged((a, b) => a?.accountId === b?.accountId && a?.eventScope === b?.eventScope));
    return toSignal(
      query$.pipe(
        filter((query): query is NonNullable<typeof query> => query !== null),
        switchMap(({ accountId, ...params }) => this.eventsService.getOrgEventFoundations(accountId, params).pipe(catchError(() => of(null))))
      ),
      { initialValue: null }
    );
  }

  // Shared events query pipeline for both tabs; only the active tab fetches, the inactive tab keeps its last value.
  private initEventsPipeline(opts: {
    tab: OrgEventsTabId;
    page: Signal<PageChangeEvent>;
    sortField: Signal<string>;
    sortOrder: Signal<'ASC' | 'DESC'>;
    loading: WritableSignal<boolean>;
    isPast: boolean;
    errorDetail: string;
  }): Signal<OrgEventsResponse> {
    const { tab, page, sortField, sortOrder, loading, isPast, errorDetail } = opts;
    return toSignal(
      toObservable(
        computed(() => {
          if (this.activeTab() !== tab) return null;
          const accountId = this.accountContext.selectedAccount().accountId;
          if (!accountId || !this.contentVisible()) return null;
          return {
            accountId,
            ...page(),
            eventScope: this.scope(),
            foundation: this.foundation(),
            participation: this.effectiveParticipation(),
            // The Upcoming tab ignores the range, so a range pick does not refetch it.
            ...(isPast ? { range: this.timeRange() } : {}),
            searchQuery: this.debouncedSearchTerm() || undefined,
            status: this.selectedStatus() ?? null,
            sortField: sortField(),
            sortOrder: sortOrder(),
          };
        })
      ).pipe(
        debounceTime(0),
        filter((params): params is NonNullable<typeof params> => params !== null),
        tap(() => loading.set(true)),
        switchMap(({ accountId, ...params }) =>
          this.eventsService.getOrgEvents(accountId, { ...params, isPast }).pipe(
            catchError(() => {
              this.messageService.add({
                severity: 'error',
                summary: 'Error',
                detail: errorDetail,
              });
              const { pageSize, offset } = page();
              return of({ ...EMPTY_ORG_EVENTS_RESPONSE, pageSize, offset });
            }),
            finalize(() => loading.set(false))
          )
        )
      ),
      { initialValue: EMPTY_ORG_EVENTS_RESPONSE }
    );
  }
}
