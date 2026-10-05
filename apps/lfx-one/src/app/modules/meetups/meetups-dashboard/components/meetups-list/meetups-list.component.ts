// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output, Signal, signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MeetupsService } from '@app/shared/services/meetups.service';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import {
  DEFAULT_MEETUP_SORT_FIELD,
  DEFAULT_MEETUPS_PAGE_SIZE,
  EMPTY_MY_MEETUPS_RESPONSE,
  MEETUPS_DISCOVERABLE_UPCOMING_LIMIT,
  MY_MEETUPS_UPCOMING_VIEWS,
} from '@lfx-one/shared/constants';
import {
  MeetupSortChangeEvent,
  MeetupSortField,
  MeetupSortOrder,
  MeetupTabId,
  MyMeetupsResponse,
  MyMeetupsUpcomingView,
  PageChangeEvent,
} from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { catchError, combineLatest, debounceTime, EMPTY, filter, finalize, of, skip, switchMap } from 'rxjs';

import { retryTransientHttpError } from '@shared/utils/http-error.utils';

import { MeetupsTableComponent } from '../meetups-table/meetups-table.component';

@Component({
  selector: 'lfx-meetups-list',
  imports: [EmptyStateComponent, FilterPillsComponent, MeetupsTableComponent],
  templateUrl: './meetups-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MeetupsListComponent {
  private readonly meetupsService = inject(MeetupsService);
  private readonly messageService = inject(MessageService);
  private readonly transientRetryCount = 2;

  public readonly activeTab = input<MeetupTabId>('upcoming');
  public readonly community = input<string | null>(null);
  public readonly searchQuery = input<string>('');
  public readonly role = input<string | null>(null);

  protected readonly upcomingMeetupsLoading = signal(true);
  protected readonly pastMeetupsLoading = signal(true);
  private readonly statsUpcomingRegisteredLoading = signal(true);
  protected readonly upcomingMeetupsError = signal(false);
  private readonly upcomingRetry = signal(0);

  protected readonly upcomingMeetupsPage = signal<PageChangeEvent>({ offset: 0, pageSize: DEFAULT_MEETUPS_PAGE_SIZE });
  protected readonly pastMeetupsPage = signal<PageChangeEvent>({ offset: 0, pageSize: DEFAULT_MEETUPS_PAGE_SIZE });

  protected readonly upcomingSortField = signal<MeetupSortField>(DEFAULT_MEETUP_SORT_FIELD);
  protected readonly upcomingSortOrder = signal<MeetupSortOrder>('ASC');
  protected readonly pastSortField = signal<MeetupSortField>(DEFAULT_MEETUP_SORT_FIELD);
  protected readonly pastSortOrder = signal<MeetupSortOrder>('DESC');

  protected readonly upcomingMeetups: Signal<MyMeetupsResponse> = this.initializeUpcomingMeetups();
  protected readonly pastMeetups: Signal<MyMeetupsResponse> = this.initializePastMeetups();

  private readonly statsUpcomingRegistered: Signal<MyMeetupsResponse | null> = this.initializeStatsUpcomingRegistered();
  protected readonly upcomingViewOptions = MY_MEETUPS_UPCOMING_VIEWS;
  protected readonly upcomingView: WritableSignal<MyMeetupsUpcomingView> = this.initUpcomingView();
  public readonly upcomingRegisteredOnly = computed(() => (this.statsUpcomingRegisteredLoading() ? null : this.upcomingView() === 'registered'));
  protected readonly showUpcomingViewPills = this.initShowUpcomingViewPills();
  protected readonly discoverableLimit = MEETUPS_DISCOVERABLE_UPCOMING_LIMIT;

  /**
   * True when the filter/search bar should be visible:
   * always show when filters are active; hide only on a true empty state (no data + no filters).
   */
  public readonly showFiltersBar = computed(() => {
    const hasFilters = this.isFiltered();
    if (hasFilters) return true;
    if (this.activeTab() === 'upcoming') return this.upcomingMeetupsLoading() || this.upcomingMeetups().data.length > 0;
    return this.pastMeetupsLoading() || this.pastMeetups().data.length > 0;
  });

  public readonly resetFilters = output<void>();

  protected readonly isFiltered = computed(() => !!(this.community() || this.searchQuery() || this.role()));

  public constructor() {
    combineLatest([toObservable(this.community), toObservable(this.searchQuery), toObservable(this.role)])
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => {
        // Reset both tabs to page 1 when shared filters change
        this.upcomingMeetupsPage.set({ offset: 0, pageSize: this.upcomingMeetupsPage().pageSize });
        this.pastMeetupsPage.set({ offset: 0, pageSize: this.pastMeetupsPage().pageSize });
      });

    toObservable(this.upcomingView)
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => {
        if (this.upcomingMeetupsPage().offset !== 0) {
          this.upcomingMeetupsPage.set({ offset: 0, pageSize: this.upcomingMeetupsPage().pageSize });
        }
      });
  }

  protected onUpcomingViewChange(view: string): void {
    const match = MY_MEETUPS_UPCOMING_VIEWS.find((option) => option.id === view);
    if (match) this.upcomingView.set(match.id);
  }

  protected retryUpcomingMeetups(): void {
    this.upcomingRetry.update((value) => value + 1);
  }

  protected onUpcomingPageChange(event: PageChangeEvent): void {
    this.upcomingMeetupsLoading.set(true);
    this.upcomingMeetupsPage.set(event);
  }

  protected onPastPageChange(event: PageChangeEvent): void {
    this.pastMeetupsLoading.set(true);
    this.pastMeetupsPage.set(event);
  }

  protected onUpcomingSortChange(event: MeetupSortChangeEvent): void {
    this.updateSort(event, this.upcomingSortField, this.upcomingSortOrder, this.upcomingMeetupsPage);
  }

  protected onPastSortChange(event: MeetupSortChangeEvent): void {
    this.updateSort(event, this.pastSortField, this.pastSortOrder, this.pastMeetupsPage);
  }

  private initializeUpcomingMeetups(): Signal<MyMeetupsResponse> {
    return this.initializeMeetups(false, this.upcomingMeetupsPage, this.upcomingMeetupsLoading, this.upcomingSortField, this.upcomingSortOrder);
  }

  private initializePastMeetups(): Signal<MyMeetupsResponse> {
    return this.initializeMeetups(true, this.pastMeetupsPage, this.pastMeetupsLoading, this.pastSortField, this.pastSortOrder);
  }

  private initUpcomingView(): WritableSignal<MyMeetupsUpcomingView> {
    return linkedSignal<{ tab: MeetupTabId; registeredCount: number | null }, MyMeetupsUpcomingView>({
      source: () => ({ tab: this.activeTab(), registeredCount: this.statsUpcomingRegistered()?.total ?? null }),
      computation: ({ registeredCount }) => (registeredCount === 0 ? 'all' : 'registered'),
    });
  }

  private initShowUpcomingViewPills(): Signal<boolean> {
    return computed(() => !this.statsUpcomingRegisteredLoading() && ((this.statsUpcomingRegistered()?.total ?? 0) > 0 || this.upcomingMeetups().total > 0));
  }

  private initializeStatsUpcomingRegistered(): Signal<MyMeetupsResponse | null> {
    return toSignal(
      this.meetupsService.getMyMeetups({ isPast: false, offset: 0, pageSize: 1, status: 'registered' }).pipe(
        catchError(() => {
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: 'Failed to load registration totals. Upcoming defaults to My Registrations.',
          });
          return of(null);
        }),
        finalize(() => this.statsUpcomingRegisteredLoading.set(false))
      ),
      { initialValue: EMPTY_MY_MEETUPS_RESPONSE }
    );
  }

  private initializeMeetups(
    isPast: boolean,
    pageSignal: WritableSignal<PageChangeEvent>,
    loadingSignal: WritableSignal<boolean>,
    sortFieldSignal: WritableSignal<MeetupSortField>,
    sortOrderSignal: WritableSignal<MeetupSortOrder>
  ): Signal<MyMeetupsResponse> {
    const tabId: MeetupTabId = isPast ? 'past' : 'upcoming';

    return toSignal(
      toObservable(
        computed(() => ({
          activeTab: this.activeTab(),
          ...pageSignal(),
          community: this.community() ?? undefined,
          searchQuery: this.searchQuery() || undefined,
          role: this.role() ?? undefined,
          status: !isPast && this.upcomingRegisteredOnly() ? ('registered' as const) : undefined,
          ready: isPast || this.upcomingRegisteredOnly() !== null,
          retry: isPast ? 0 : this.upcomingRetry(),
          sortField: sortFieldSignal(),
          sortOrder: sortOrderSignal(),
        }))
      ).pipe(
        filter(({ ready }) => ready),
        debounceTime(0),
        switchMap(({ activeTab, offset, pageSize, community, searchQuery, role, status, sortField, sortOrder }) => {
          if (activeTab !== tabId) {
            return EMPTY;
          }

          loadingSignal.set(true);
          if (!isPast) this.upcomingMeetupsError.set(false);
          return this.meetupsService.getMyMeetups({ isPast, offset, pageSize, community, searchQuery, role, status, sortField, sortOrder }).pipe(
            retryTransientHttpError(this.transientRetryCount),
            catchError((error) => {
              console.error('Failed to load meetups:', error);
              if (!isPast && status === 'registered') this.upcomingMeetupsError.set(true);
              if (this.activeTab() === tabId) {
                this.showLoadError();
              }
              return of({ ...EMPTY_MY_MEETUPS_RESPONSE, pageSize, offset });
            }),
            finalize(() => loadingSignal.set(false))
          );
        })
      ),
      { initialValue: EMPTY_MY_MEETUPS_RESPONSE }
    );
  }

  private updateSort(
    event: MeetupSortChangeEvent,
    sortFieldSignal: WritableSignal<MeetupSortField>,
    sortOrderSignal: WritableSignal<MeetupSortOrder>,
    pageSignal: WritableSignal<PageChangeEvent>
  ): void {
    if (sortFieldSignal() === event.field) {
      sortOrderSignal.set(sortOrderSignal() === 'ASC' ? 'DESC' : 'ASC');
    } else {
      sortFieldSignal.set(event.field);
      sortOrderSignal.set('ASC');
    }
    pageSignal.set({ offset: 0, pageSize: pageSignal().pageSize });
  }

  private showLoadError(): void {
    this.messageService.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to load meetups. Please try again.',
    });
  }
}
