// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, Type, computed, inject, input, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { EventsService } from '@app/shared/services/events.service';
import { UserService } from '@app/shared/services/user.service';
import { EventRequestStatusSeverityPipe } from '@app/shared/pipes/event-request-status-severity.pipe';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { DEFAULT_EVENTS_PAGE_SIZE, EMPTY_TRAVEL_FUND_REQUESTS_RESPONSE, EMPTY_VISA_REQUESTS_RESPONSE } from '@lfx-one/shared/constants';
import { PageChangeEvent, RequestType, VisaRequestsResponse } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogModule } from 'primeng/dynamicdialog';
import { catchError, combineLatest, defer, finalize, map, of, skip, switchMap, tap } from 'rxjs';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TravelFundApplicationDialogComponent } from '../travel-fund-application-dialog/travel-fund-application-dialog.component';
import { VisaRequestApplicationDialogComponent } from '../visa-request-application-dialog/visa-request-application-dialog.component';
@Component({
  selector: 'lfx-event-request-list',
  imports: [TableComponent, TagComponent, DynamicDialogModule, EventRequestStatusSeverityPipe, EmptyStateComponent],
  providers: [DialogService],
  templateUrl: './event-request-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventRequestListComponent {
  private readonly eventsService = inject(EventsService);
  private readonly dialogService = inject(DialogService);
  private readonly userService = inject(UserService);
  private readonly messageService = inject(MessageService);

  public readonly requestType = input.required<RequestType>();
  public readonly searchQuery = input<string>('');
  public readonly status = input<string | null>(null);

  protected readonly loading = signal(false);
  protected readonly sortField = signal<string>('APPLICATION_DATE');
  protected readonly sortOrder = signal<'ASC' | 'DESC'>('DESC');
  protected readonly page = signal<PageChangeEvent>({ offset: 0, pageSize: DEFAULT_EVENTS_PAGE_SIZE });
  protected readonly isSalesforceIdLoading = signal(false);
  protected readonly requestsResponse: Signal<VisaRequestsResponse> = this.initRequests();
  protected readonly isCreateEnabled: Signal<boolean> = this.initIsCreateEnabled();

  protected readonly rppOptions = computed<number[] | undefined>(() =>
    this.requestsResponse().total > 10 ? [10, 25, 50] : undefined
  );

  /** True while loading or when at least one result exists — parent uses this to decide whether to show the filter bar. */
  public readonly hasData = computed(() => this.loading() || this.requestsResponse().data.length > 0);

  protected readonly config = computed(() => {
    const isVisa = this.requestType() === 'visa';
    return {
      dialogComponent: (isVisa ? VisaRequestApplicationDialogComponent : TravelFundApplicationDialogComponent) as Type<unknown>,
      dialogHeader: isVisa ? 'Visa Letter Application' : 'Travel Funding Application',
      buttonLabel: isVisa ? 'New Letter Application' : 'New Funding Application',
      emptyIcon: isVisa ? 'fa-light fa-passport' : 'fa-light fa-plane',
      emptyTitle: isVisa ? 'No visa letter requests yet' : 'No travel funding requests yet',
      emptySubtitle: isVisa ? 'Submit a request to get a visa support letter for an LF event.' : 'Submit an application to get travel funding for an LF event.',
      testIdPrefix: isVisa ? 'visa-request' : 'travel-funding',
    };
  });

  protected readonly sortIcons = computed(() => {
    const field = this.sortField();
    const order = this.sortOrder();
    const getIcon = (f: string): string => {
      if (field !== f) return 'fa-light fa-sort text-gray-300';
      return order === 'ASC' ? 'fa-solid fa-caret-up text-blue-500' : 'fa-solid fa-caret-down text-blue-500';
    };
    return {
      EVENT_NAME: getIcon('EVENT_NAME'),
      EVENT_CITY: getIcon('EVENT_CITY'),
      APPLICATION_DATE: getIcon('APPLICATION_DATE'),
    };
  });

  public constructor() {
    combineLatest([toObservable(this.searchQuery), toObservable(this.status)])
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => {
        this.page.set({ offset: 0, pageSize: this.page().pageSize });
      });
  }

  public openApplicationDialog(): void {
    if (!this.isCreateEnabled()) return;
    this.dialogService.open(this.config().dialogComponent, {
      header: this.config().dialogHeader,
      width: '800px',
      modal: true,
      closable: true,
      closeOnEscape: true,
    });
  }

  protected onPageChange(event: { first: number; rows: number }): void {
    this.loading.set(true);
    this.page.set({ offset: event.first, pageSize: event.rows });
  }

  protected onHeaderClick(field: string): void {
    if (this.sortField() === field) {
      this.sortOrder.set(this.sortOrder() === 'ASC' ? 'DESC' : 'ASC');
    } else {
      this.sortField.set(field);
      this.sortOrder.set('ASC');
    }
    this.page.set({ offset: 0, pageSize: this.page().pageSize });
  }

  private initRequests(): Signal<VisaRequestsResponse> {
    return toSignal(
      toObservable(
        computed(() => ({
          ...this.page(),
          searchQuery: this.searchQuery() || undefined,
          status: this.status() ?? undefined,
          sortField: this.sortField(),
          sortOrder: this.sortOrder(),
          requestType: this.requestType(),
        }))
      ).pipe(
        tap(() => this.loading.set(true)),
        switchMap(({ offset, pageSize, searchQuery, status, sortField, sortOrder, requestType }) => {
          const params = { offset, pageSize, searchQuery, status, sortField, sortOrder };
          const emptyResponse = requestType === 'visa' ? EMPTY_VISA_REQUESTS_RESPONSE : EMPTY_TRAVEL_FUND_REQUESTS_RESPONSE;
          const fetch$ = requestType === 'visa' ? this.eventsService.getVisaRequests(params) : this.eventsService.getTravelFundRequests(params);
          return fetch$.pipe(
            catchError(() => {
              this.messageService.add({
                severity: 'error',
                summary: 'Error',
                detail: 'Failed to load requests. Please try again.',
              });
              return of(emptyResponse);
            }),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: EMPTY_VISA_REQUESTS_RESPONSE }
    );
  }

  // Salesforce ID is required to create a new request
  private initIsCreateEnabled(): Signal<boolean> {
    if (this.userService.apiGatewayUserId()) {
      return signal(true);
    }

    return toSignal(
      defer(() => {
        this.isSalesforceIdLoading.set(true);
        return this.userService.getSalesforceId();
      }).pipe(
        map((profile) => {
          if (profile?.id) {
            this.userService.apiGatewayUserId.set(profile.id);
            return true;
          }

          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: 'Your account is missing the required Salesforce ID. Please contact support.',
          });
          return false;
        }),
        catchError(() => {
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: 'Unable to verify your account. Please refresh the page.',
          });
          return of(false);
        }),
        finalize(() => this.isSalesforceIdLoading.set(false))
      ),
      { initialValue: false }
    );
  }
}
