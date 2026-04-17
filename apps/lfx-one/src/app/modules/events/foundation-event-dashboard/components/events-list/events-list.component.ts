// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, inject, input, Signal, signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { EventsService } from '@app/shared/services/events.service';
import { DEFAULT_EVENTS_PAGE_SIZE, EMPTY_EVENTS_RESPONSE } from '@lfx-one/shared/constants';
import { EventStatusFilter, EventsResponse, EventTab, EventTabId, PageChangeEvent, SortChangeEvent } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { catchError, combineLatest, debounceTime, finalize, of, skip, switchMap, tap } from 'rxjs';
import { EventsTableComponent } from '../events-table/events-table.component';

@Component({
  selector: 'lfx-foundation-events-list',
  imports: [NgClass, EventsTableComponent],
  templateUrl: './events-list.component.html',
})
export class EventsListComponent {
  private readonly eventsService = inject(EventsService);
  private readonly messageService = inject(MessageService);

  public readonly foundation = input<string | null>(null);
  public readonly searchQuery = input<string>('');
  public readonly status = input<string | null>(null);

  protected readonly activeTab = signal<EventTabId>('upcoming');

  public readonly upcomingEventsLoading = signal(true);
  public readonly pastEventsLoading = signal(true);

  protected readonly upcomingEventsPage = signal<PageChangeEvent>({ offset: 0, pageSize: DEFAULT_EVENTS_PAGE_SIZE });
  protected readonly pastEventsPage = signal<PageChangeEvent>({ offset: 0, pageSize: DEFAULT_EVENTS_PAGE_SIZE });

  protected readonly upcomingSortField = signal('EVENT_START_DATE');
  protected readonly upcomingSortOrder = signal<'ASC' | 'DESC'>('ASC');
  protected readonly pastSortField = signal('EVENT_START_DATE');
  protected readonly pastSortOrder = signal<'ASC' | 'DESC'>('DESC');

  protected readonly upcomingEvents: Signal<EventsResponse> = this.initializeUpcomingEvents();
  protected readonly pastEvents: Signal<EventsResponse> = this.initializePastEvents();

  protected readonly tabs: EventTab[] = [
    { id: 'upcoming', label: 'Upcoming', countKey: 'upcoming' },
    { id: 'past', label: 'Past', countKey: 'past' },
  ];

  public readonly tabCounts = computed(() => ({
    upcoming: this.upcomingEvents().total,
    past: this.pastEvents().total,
  }));

  public readonly eventsStatsLoading = computed(() => this.upcomingEventsLoading() || this.pastEventsLoading());

  public constructor() {
    // Reset both tabs to page 1 when shared filters change
    combineLatest([toObservable(this.foundation), toObservable(this.searchQuery), toObservable(this.status)])
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => {
        this.upcomingEventsPage.set({ offset: 0, pageSize: this.upcomingEventsPage().pageSize });
        this.pastEventsPage.set({ offset: 0, pageSize: this.pastEventsPage().pageSize });
      });
  }

  protected setActiveTab(tab: EventTabId): void {
    this.activeTab.set(tab);
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

  private initializeUpcomingEvents(): Signal<EventsResponse> {
    return this.initializeEvents(false, this.upcomingEventsPage, this.upcomingEventsLoading, this.upcomingSortField, this.upcomingSortOrder);
  }

  private initializePastEvents(): Signal<EventsResponse> {
    return this.initializeEvents(true, this.pastEventsPage, this.pastEventsLoading, this.pastSortField, this.pastSortOrder);
  }

  private initializeEvents(
    isPast: boolean,
    pageSignal: WritableSignal<PageChangeEvent>,
    loadingSignal: WritableSignal<boolean>,
    sortFieldSignal: WritableSignal<string>,
    sortOrderSignal: WritableSignal<'ASC' | 'DESC'>
  ): Signal<EventsResponse> {
    return toSignal(
      toObservable(
        computed(() => ({
          ...pageSignal(),
          foundation: this.foundation(),
          searchQuery: this.searchQuery() || undefined,
          status: (this.status() ?? undefined) as EventStatusFilter | undefined,
          sortField: sortFieldSignal(),
          sortOrder: sortOrderSignal(),
        }))
      ).pipe(
        debounceTime(0),
        tap(() => loadingSignal.set(true)),
        switchMap(({ offset, pageSize, foundation, searchQuery, status, sortField, sortOrder }) =>
          this.eventsService
            .getEvents({
              isPast,
              offset,
              pageSize,
              projectNames: foundation ? [foundation] : undefined,
              searchQuery,
              status,
              sortField,
              sortOrder,
            })
            .pipe(
              catchError(() => {
                this.messageService.add({
                  severity: 'error',
                  summary: 'Error',
                  detail: 'Failed to load events. Please try again.',
                });
                return of(EMPTY_EVENTS_RESPONSE);
              }),
              finalize(() => loadingSignal.set(false))
            )
        )
      ),
      { initialValue: EMPTY_EVENTS_RESPONSE }
    );
  }
}
