// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MessageService } from 'primeng/api';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, filter, finalize, of, skip, switchMap, tap } from 'rxjs';

import { CardComponent } from '@components/card/card.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import {
  DEFAULT_EVENTS_PAGE_SIZE,
  DEFAULT_ORG_EVENTS_TAB_ID,
  EMPTY_ORG_EVENTS_RESPONSE,
  ORG_EVENTS_STATUS_OPTIONS,
  ORG_EVENTS_TABS,
  VALID_ORG_EVENTS_TAB_IDS,
} from '@lfx-one/shared/constants';
import type {
  FilterPillOption,
  OrgEvent,
  OrgEventStatFilterId,
  OrgEventsResponse,
  OrgEventsSummary,
  OrgEventsTabId,
  PageChangeEvent,
  SortChangeEvent,
} from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { EventsService } from '@services/events.service';

import { DiscoverEventsButtonComponent } from '../components/discover-events-button/discover-events-button.component';
import { EventAttendeesDrawerComponent } from './components/event-attendees-drawer/event-attendees-drawer.component';
import { EventSpeakersDrawerComponent } from './components/event-speakers-drawer/event-speakers-drawer.component';
import { OrgEventsTableComponent } from './components/org-events-table/org-events-table.component';

@Component({
  selector: 'lfx-org-events-dashboard',
  imports: [
    FormsModule,
    CardComponent,
    CardTabsBarComponent,
    SelectModule,
    InputTextModule,
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

  // === Template constants ===
  public readonly statusOptions = ORG_EVENTS_STATUS_OPTIONS;

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
  public readonly activeTab: Signal<OrgEventsTabId> = this.initActiveTab();
  public readonly eventsSummary: Signal<OrgEventsSummary | null> = this.initEventsSummary();
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
    combineLatest([toObservable(this.debouncedSearchTerm), toObservable(this.selectedStatus)])
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => {
        this.upcomingEventsPage.set({ offset: 0, pageSize: this.upcomingEventsPage().pageSize });
        this.pastEventsPage.set({ offset: 0, pageSize: this.pastEventsPage().pageSize });
      });
  }

  // === Public methods ===
  // Stat cards are tab shortcuts: Upcoming/Total jump to the upcoming tab, Past to the past tab.
  public onStatCardClick(id: OrgEventStatFilterId): void {
    this.switchTab(id === 'past' ? 'past' : 'upcoming');
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
    const accountId$ = toObservable(computed(() => this.accountContext.selectedAccount().accountId));
    return toSignal(
      accountId$.pipe(
        filter((id): id is string => !!id),
        switchMap((id) => this.eventsService.getOrgEventsSummary(id).pipe(catchError(() => of(null))))
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
          if (!accountId) return null;
          return {
            accountId,
            ...page(),
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
