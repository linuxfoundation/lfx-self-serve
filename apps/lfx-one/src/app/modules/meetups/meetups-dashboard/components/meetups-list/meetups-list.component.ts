// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, Signal, signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MeetupsService } from '@app/shared/services/meetups.service';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { DEFAULT_MEETUP_SORT_FIELD, DEFAULT_MEETUPS_PAGE_SIZE, EMPTY_MY_MEETUPS_RESPONSE } from '@lfx-one/shared/constants';
import {
  MeetupSortChangeEvent,
  MeetupSortField,
  MeetupSortOrder,
  MeetupStatusFilter,
  MeetupTabId,
  MyMeetupsResponse,
  PageChangeEvent,
} from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { catchError, combineLatest, debounceTime, EMPTY, finalize, of, retry, skip, switchMap, throwError, timer } from 'rxjs';

import { MeetupsTableComponent } from '../meetups-table/meetups-table.component';

@Component({
  selector: 'lfx-meetups-list',
  imports: [EmptyStateComponent, MeetupsTableComponent],
  templateUrl: './meetups-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MeetupsListComponent {
  private readonly meetupsService = inject(MeetupsService);
  private readonly messageService = inject(MessageService);
  private readonly transientRetryCount = 2;
  private readonly transientRetryDelayMs = 1000;

  public readonly activeTab = input<MeetupTabId>('upcoming');
  public readonly community = input<string | null>(null);
  public readonly searchQuery = input<string>('');
  public readonly role = input<string | null>(null);
  public readonly status = input<MeetupStatusFilter | null>(null);

  protected readonly upcomingMeetupsLoading = signal(true);
  protected readonly pastMeetupsLoading = signal(true);

  protected readonly upcomingMeetupsPage = signal<PageChangeEvent>({ offset: 0, pageSize: DEFAULT_MEETUPS_PAGE_SIZE });
  protected readonly pastMeetupsPage = signal<PageChangeEvent>({ offset: 0, pageSize: DEFAULT_MEETUPS_PAGE_SIZE });

  protected readonly upcomingSortField = signal<MeetupSortField>(DEFAULT_MEETUP_SORT_FIELD);
  protected readonly upcomingSortOrder = signal<MeetupSortOrder>('ASC');
  protected readonly pastSortField = signal<MeetupSortField>(DEFAULT_MEETUP_SORT_FIELD);
  protected readonly pastSortOrder = signal<MeetupSortOrder>('DESC');

  protected readonly upcomingMeetups: Signal<MyMeetupsResponse> = this.initializeUpcomingMeetups();
  protected readonly pastMeetups: Signal<MyMeetupsResponse> = this.initializePastMeetups();

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

  protected readonly isFiltered = computed(() => !!(this.community() || this.searchQuery() || this.role() || this.status()));

  public constructor() {
    combineLatest([toObservable(this.community), toObservable(this.searchQuery), toObservable(this.role), toObservable(this.status)])
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => {
        // Reset both tabs to page 1 when shared filters change
        this.upcomingMeetupsPage.set({ offset: 0, pageSize: this.upcomingMeetupsPage().pageSize });
        this.pastMeetupsPage.set({ offset: 0, pageSize: this.pastMeetupsPage().pageSize });
      });
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
          // The registered/not-registered filter only applies to upcoming discovery rows; past rows are already scoped to meetups the user joined.
          status: isPast ? undefined : (this.status() ?? undefined),
          sortField: sortFieldSignal(),
          sortOrder: sortOrderSignal(),
        }))
      ).pipe(
        debounceTime(0),
        switchMap(({ activeTab, offset, pageSize, community, searchQuery, role, status, sortField, sortOrder }) => {
          if (activeTab !== tabId) {
            return EMPTY;
          }

          loadingSignal.set(true);
          return this.meetupsService.getMyMeetups({ isPast, offset, pageSize, community, searchQuery, role, status, sortField, sortOrder }).pipe(
            retry({
              count: this.transientRetryCount,
              delay: (error: unknown) => (this.isTransientLoadError(error) ? timer(this.transientRetryDelayMs) : throwError(() => error)),
            }),
            catchError(() => {
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

  private isTransientLoadError(error: unknown): boolean {
    return error instanceof HttpErrorResponse && (error.status === 0 || error.status === 429 || error.status >= 500);
  }
}
