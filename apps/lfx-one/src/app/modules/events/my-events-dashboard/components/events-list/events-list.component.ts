// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, output, Signal, signal, viewChild, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { EventsService } from '@app/shared/services/events.service';
import { DEFAULT_EVENTS_PAGE_SIZE, EMPTY_MY_EVENTS_RESPONSE } from '@lfx-one/shared/constants';
import { EventTabId, MyEventsResponse, PageChangeEvent, SortChangeEvent } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { catchError, combineLatest, debounceTime, finalize, of, skip, switchMap, tap } from 'rxjs';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { EventRequestListComponent } from '../event-request-list/event-request-list.component';
import { EventsTableComponent } from '../events-table/events-table.component';

@Component({
  selector: 'lfx-events-list',
  imports: [EventsTableComponent, EventRequestListComponent, EmptyStateComponent],
  templateUrl: './events-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventsListComponent {
  private readonly requestListRef = viewChild(EventRequestListComponent);

  private readonly eventsService = inject(EventsService);
  private readonly messageService = inject(MessageService);

  public readonly activeTab = input<EventTabId>('upcoming');
  public readonly foundation = input<string | null>(null);
  public readonly searchQuery = input<string>('');
  public readonly role = input<string | null>(null);
  public readonly status = input<string | null>(null);

  protected readonly upcomingEventsLoading = signal(true);
  protected readonly pastEventsLoading = signal(true);
  private readonly statsUpcomingAllLoading = signal(true);
  private readonly statsUpcomingRegisteredLoading = signal(true);
  private readonly statsPastLoading = signal(true);

  protected readonly upcomingEventsPage = signal<PageChangeEvent>({ offset: 0, pageSize: DEFAULT_EVENTS_PAGE_SIZE });
  protected readonly pastEventsPage = signal<PageChangeEvent>({ offset: 0, pageSize: DEFAULT_EVENTS_PAGE_SIZE });

  protected readonly upcomingSortField = signal('EVENT_START_DATE');
  protected readonly upcomingSortOrder = signal<'ASC' | 'DESC'>('ASC');
  protected readonly pastSortField = signal('EVENT_START_DATE');
  protected readonly pastSortOrder = signal<'ASC' | 'DESC'>('DESC');

  protected readonly upcomingEvents: Signal<MyEventsResponse> = this.initializeUpcomingEvents();
  protected readonly pastEvents: Signal<MyEventsResponse> = this.initializePastEvents();

  // Unfiltered stats signals — fetched once with pageSize=1, used only for totals and next-event name
  private readonly statsUpcomingAll: Signal<MyEventsResponse> = this.initializeStatsUpcomingAll();
  private readonly statsUpcomingRegistered: Signal<MyEventsResponse> = this.initializeStatsUpcomingRegistered();
  private readonly statsPast: Signal<MyEventsResponse> = this.initializeStatsPast();

  // Me lens stat cards — derived from server-reported totals so counts stay accurate regardless of page size
  public readonly eventsStatsLoading = computed(() => this.statsUpcomingAllLoading() || this.statsUpcomingRegisteredLoading() || this.statsPastLoading());
  public readonly registeredCount = computed(() => this.statsUpcomingRegistered().total);
  public readonly attendedCount = computed(() => this.statsPast().total);
  public readonly nextEventName = computed(() => this.statsUpcomingRegistered().data[0]?.name ?? '');
  public readonly availableToJoinCount = computed(() => Math.max(0, this.statsUpcomingAll().total - this.statsUpcomingRegistered().total));
  public readonly tabCounts = computed(() => ({
    upcoming: this.statsUpcomingAll().total,
    past: this.statsPast().total,
  }));

  /**
   * True when the filter/search bar should be visible:
   * always show when filters are active; hide only on a true empty state (no data + no filters).
   */
  public readonly showFiltersBar = computed(() => {
    const tab = this.activeTab();
    const hasFilters = !!(this.foundation() || this.searchQuery() || this.role() || this.status());
    if (hasFilters) return true;
    if (tab === 'upcoming') return this.upcomingEventsLoading() || this.upcomingEvents().data.length > 0;
    if (tab === 'past') return this.pastEventsLoading() || this.pastEvents().data.length > 0;
    // For visa-letters / travel-funding tabs — delegate to the rendered request list
    return this.requestListRef()?.hasData() ?? true;
  });

  public readonly resetFilters = output<void>();

  protected readonly isFiltered = computed(() => !!(this.foundation() || this.searchQuery() || this.role() || this.status()));

  public constructor() {
    // Reset both tabs to page 1 when shared filters change
    combineLatest([toObservable(this.foundation), toObservable(this.searchQuery), toObservable(this.role), toObservable(this.status)])
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => {
        this.upcomingEventsPage.set({ offset: 0, pageSize: this.upcomingEventsPage().pageSize });
        this.pastEventsPage.set({ offset: 0, pageSize: this.pastEventsPage().pageSize });
      });
  }

  /** Delegates to the currently rendered EventRequestListComponent (visa-letters / travel-funding tabs). */
  public openCurrentRequestDialog(): void {
    this.requestListRef()?.openApplicationDialog();
  }

  protected onUpcomingPageChange(event: PageChangeEvent): void {
    this.upcomingEventsLoading.set(true);
    this.upcomingEventsPage.set(event);
  }

  protected onPastPageChange(event: PageChangeEvent): void {
    this.pastEventsLoading.set(true);
    this.pastEventsPage.set(event);
  }

  protected onUpcomingSortChange(event: SortChangeEvent): void {
    if (this.upcomingSortField() === event.field) {
      this.upcomingSortOrder.set(this.upcomingSortOrder() === 'ASC' ? 'DESC' : 'ASC');
    } else {
      this.upcomingSortField.set(event.field);
      this.upcomingSortOrder.set('ASC');
    }
    this.upcomingEventsPage.set({ offset: 0, pageSize: this.upcomingEventsPage().pageSize });
  }

  protected onPastSortChange(event: SortChangeEvent): void {
    if (this.pastSortField() === event.field) {
      this.pastSortOrder.set(this.pastSortOrder() === 'ASC' ? 'DESC' : 'ASC');
    } else {
      this.pastSortField.set(event.field);
      this.pastSortOrder.set('ASC');
    }
    this.pastEventsPage.set({ offset: 0, pageSize: this.pastEventsPage().pageSize });
  }

  private initializeUpcomingEvents(): Signal<MyEventsResponse> {
    return this.initializeEvents(false, this.upcomingEventsPage, this.upcomingEventsLoading, this.upcomingSortField, this.upcomingSortOrder);
  }

  private initializePastEvents(): Signal<MyEventsResponse> {
    return this.initializeEvents(true, this.pastEventsPage, this.pastEventsLoading, this.pastSortField, this.pastSortOrder);
  }

  private initializeStatsUpcomingAll(): Signal<MyEventsResponse> {
    return toSignal(
      this.eventsService.getMyEvents({ isPast: false, offset: 0, pageSize: 1 }).pipe(
        catchError(() => of(EMPTY_MY_EVENTS_RESPONSE)),
        finalize(() => this.statsUpcomingAllLoading.set(false))
      ),
      { initialValue: EMPTY_MY_EVENTS_RESPONSE }
    );
  }

  private initializeStatsUpcomingRegistered(): Signal<MyEventsResponse> {
    return toSignal(
      this.eventsService.getMyEvents({ isPast: false, offset: 0, pageSize: 1, registeredOnly: true, sortField: 'EVENT_START_DATE', sortOrder: 'ASC' }).pipe(
        catchError(() => of(EMPTY_MY_EVENTS_RESPONSE)),
        finalize(() => this.statsUpcomingRegisteredLoading.set(false))
      ),
      { initialValue: EMPTY_MY_EVENTS_RESPONSE }
    );
  }

  private initializeStatsPast(): Signal<MyEventsResponse> {
    return toSignal(
      this.eventsService.getMyEvents({ isPast: true, offset: 0, pageSize: 1 }).pipe(
        catchError(() => of(EMPTY_MY_EVENTS_RESPONSE)),
        finalize(() => this.statsPastLoading.set(false))
      ),
      { initialValue: EMPTY_MY_EVENTS_RESPONSE }
    );
  }

  private initializeEvents(
    isPast: boolean,
    pageSignal: WritableSignal<PageChangeEvent>,
    loadingSignal: WritableSignal<boolean>,
    sortFieldSignal: WritableSignal<string>,
    sortOrderSignal: WritableSignal<'ASC' | 'DESC'>
  ): Signal<MyEventsResponse> {
    return toSignal(
      toObservable(
        computed(() => ({
          ...pageSignal(),
          projectName: this.foundation() ?? undefined,
          searchQuery: this.searchQuery() || undefined,
          role: this.role() ?? undefined,
          status: this.status() ?? undefined,
          sortField: sortFieldSignal(),
          sortOrder: sortOrderSignal(),
        }))
      ).pipe(
        debounceTime(0),
        tap(() => loadingSignal.set(true)),
        switchMap(({ offset, pageSize, projectName, searchQuery, role, status, sortField, sortOrder }) =>
          this.eventsService.getMyEvents({ isPast, offset, pageSize, projectName, searchQuery, role, status, sortField, sortOrder }).pipe(
            catchError(() => {
              this.messageService.add({
                severity: 'error',
                summary: 'Error',
                detail: 'Failed to load events. Please try again.',
              });
              return of(EMPTY_MY_EVENTS_RESPONSE);
            }),
            finalize(() => loadingSignal.set(false))
          )
        )
      ),
      { initialValue: EMPTY_MY_EVENTS_RESPONSE }
    );
  }
}
