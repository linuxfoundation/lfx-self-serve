// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, Signal, signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { EventsService } from '@app/shared/services/events.service';
import { DEFAULT_EVENTS_PAGE_SIZE, EMPTY_MY_EVENTS_RESPONSE } from '@lfx-one/shared/constants';
import { EventTab, EventTabId, MyEventsResponse, PageChangeEvent, SortChangeEvent } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { catchError, combineLatest, debounceTime, finalize, of, skip, switchMap, tap } from 'rxjs';
import { EventRequestListComponent } from '../event-request-list/event-request-list.component';
import { EventsTableComponent } from '../events-table/events-table.component';

@Component({
  selector: 'lfx-events-list',
  imports: [NgClass, EventsTableComponent, EventRequestListComponent],
  templateUrl: './events-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventsListComponent {
  private readonly eventsService = inject(EventsService);
  private readonly messageService = inject(MessageService);

  public readonly foundation = input<string | null>(null);
  public readonly searchQuery = input<string>('');
  public readonly role = input<string | null>(null);
  public readonly status = input<string | null>(null);

  public readonly activeTabChange = output<EventTabId>();

  protected readonly activeTab = signal<EventTabId>('upcoming');

  protected readonly upcomingEventsLoading = signal(true);
  protected readonly pastEventsLoading = signal(true);

  protected readonly upcomingEventsPage = signal<PageChangeEvent>({ offset: 0, pageSize: DEFAULT_EVENTS_PAGE_SIZE });
  protected readonly pastEventsPage = signal<PageChangeEvent>({ offset: 0, pageSize: DEFAULT_EVENTS_PAGE_SIZE });

  protected readonly upcomingSortField = signal('EVENT_START_DATE');
  protected readonly upcomingSortOrder = signal<'ASC' | 'DESC'>('ASC');
  protected readonly pastSortField = signal('EVENT_START_DATE');
  protected readonly pastSortOrder = signal<'ASC' | 'DESC'>('DESC');

  protected readonly upcomingEvents: Signal<MyEventsResponse> = this.initializeUpcomingEvents();
  protected readonly pastEvents: Signal<MyEventsResponse> = this.initializePastEvents();

  protected readonly tabs: EventTab[] = [
    { id: 'upcoming', label: 'Upcoming', countKey: 'upcoming' },
    { id: 'past', label: 'Past', countKey: 'past' },
    { id: 'visa-letters', label: 'Visa Letters' },
    { id: 'travel-funding', label: 'Travel Funding' },
  ];

  protected readonly tabCounts = computed(() => ({
    upcoming: this.upcomingEvents().total,
    past: this.pastEvents().total,
  }));

  public constructor() {
    // Reset both tabs to page 1 when shared filters change
    combineLatest([toObservable(this.foundation), toObservable(this.searchQuery), toObservable(this.role), toObservable(this.status)])
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => {
        this.upcomingEventsPage.set({ offset: 0, pageSize: this.upcomingEventsPage().pageSize });
        this.pastEventsPage.set({ offset: 0, pageSize: this.pastEventsPage().pageSize });
      });
  }

  protected setActiveTab(tab: EventTabId): void {
    this.activeTab.set(tab);
    this.activeTabChange.emit(tab);
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
