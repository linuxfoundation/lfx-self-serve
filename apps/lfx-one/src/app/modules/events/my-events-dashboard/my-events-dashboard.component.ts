// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, Component, computed, inject, Injector, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { ToastMessageComponent } from '@components/toast-message/toast-message.component';
import {
  DEFAULT_MY_EVENTS_TAB_ID,
  MY_EVENT_STATUS_OPTIONS,
  MY_EVENTS_TABS,
  VALID_MY_EVENTS_TAB_IDS,
  VISA_REQUEST_STATUS_OPTIONS,
} from '@lfx-one/shared/constants';
import { EventTabId, FilterOption, FilterPillOption } from '@lfx-one/shared/interfaces';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { Tooltip } from 'primeng/tooltip';
import { catchError, combineLatest, defer, filter, finalize, map, of } from 'rxjs';
import { DiscoverEventsButtonComponent } from '../components/discover-events-button/discover-events-button.component';
import { EventsTopBarComponent } from '../components/events-top-bar/events-top-bar.component';
import { EventsListComponent } from './components/events-list/events-list.component';
import { UserService } from '@app/shared/services/user.service';

/** Dedicated toast key so the custom support-CTA template renders only for this component's Salesforce-ID error toast. */
const SALESFORCE_ERROR_TOAST_KEY = 'my-events-salesforce-error';

@Component({
  selector: 'lfx-my-events-dashboard',
  imports: [
    ButtonComponent,
    CardComponent,
    CardTabsBarComponent,
    DiscoverEventsButtonComponent,
    EventsTopBarComponent,
    EventsListComponent,
    Tooltip,
    ToastModule,
    ToastMessageComponent,
    OpenIntercomDirective,
  ],
  templateUrl: './my-events-dashboard.component.html',
})
export class MyEventsDashboardComponent {
  private readonly userService = inject(UserService);
  private readonly messageService = inject(MessageService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly eventsListRef = viewChild(EventsListComponent);

  /** Single subscription to the route's query params — activeTab and activeEventId both derive from it. */
  private readonly queryParamMap = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });

  /** Guards the deep-linked `?event=` auto-open so each event id fires at most once per page load. */
  private readonly consumedDeepLinkEventIds = new Set<string>();

  protected readonly activeTab: Signal<EventTabId> = this.initActiveTab();
  /** Event id from a deep link (`?tab=visa-letters&event=<id>`); null once the URL is stripped post-auto-open, or absent. */
  protected readonly activeEventId: Signal<string | null> = this.initActiveEventId();

  protected readonly tabOptions: FilterPillOption[] = MY_EVENTS_TABS;
  protected readonly selectedFoundation = signal<string | null>(null);
  protected readonly selectedRole = signal<string | null>(null);
  protected readonly selectedStatus = signal<string | null>(null);
  protected readonly selectedSearchQuery = signal('');

  protected readonly isPast = computed(() => this.activeTab() === 'past');

  /** True when the active tab uses request-style filters (no role, no foundation, different statuses). */
  protected readonly isRequestTab = computed(() => this.activeTab() === 'visa-letters' || this.activeTab() === 'travel-funding');

  protected readonly currentStatusOptions = computed<FilterOption[]>(() => (this.isRequestTab() ? VISA_REQUEST_STATUS_OPTIONS : MY_EVENT_STATUS_OPTIONS));

  protected readonly searchPlaceholder = computed(() => {
    if (this.activeTab() === 'visa-letters') return 'Search visa letters...';
    if (this.activeTab() === 'travel-funding') return 'Search travel funding...';
    return 'Search events...';
  });

  protected readonly requestButtonLabel = computed(() => (this.activeTab() === 'visa-letters' ? 'New Letter Application' : 'New Funding Application'));

  /** Delegates to EventsListComponent — lifted here to avoid template forward-reference issues. */
  protected readonly showFiltersBar = computed(() => this.eventsListRef()?.showFiltersBar() ?? true);
  protected readonly eventsStatsLoading = computed(() => this.eventsListRef()?.eventsStatsLoading() ?? true);
  protected readonly registeredCount = computed(() => this.eventsListRef()?.registeredCount() ?? 0);
  protected readonly attendedCount = computed(() => this.eventsListRef()?.attendedCount() ?? 0);
  protected readonly nextEventName = computed(() => this.eventsListRef()?.nextEventName() ?? '');
  protected readonly upcomingCount = computed(() => this.eventsListRef()?.tabCounts().upcoming ?? 0);

  protected readonly isSalesforceIdLoading = signal(false);
  protected readonly salesforceErrorToastKey = SALESFORCE_ERROR_TOAST_KEY;
  protected readonly isCreateEnabled: Signal<boolean> = this.initIsCreateEnabled();

  public constructor() {
    // Auto-open the request dialog for a deep link (`?tab=visa-letters&event=<id>`). RxJS, not
    // effect(), per the frontend checklist (effect() is reserved for logging/debugging —
    // docs/reviews/frontend-checklist.md §5); afterNextRender's explicit injector keeps the
    // deferred-render timing this needs without an active injection context at fire time.
    combineLatest([toObservable(this.isRequestTab), toObservable(this.activeEventId), toObservable(this.isCreateEnabled)])
      .pipe(
        map(([isRequestTab, eventId, isCreateEnabled]) => (isRequestTab && isCreateEnabled ? eventId : null)),
        filter((eventId): eventId is string => !!eventId && !this.consumedDeepLinkEventIds.has(eventId)),
        takeUntilDestroyed()
      )
      .subscribe((eventId) => {
        afterNextRender(
          () => {
            if (this.consumedDeepLinkEventIds.has(eventId) || !this.openCurrentRequestDialog()) return;
            this.consumedDeepLinkEventIds.add(eventId);
            void this.router.navigate([], { relativeTo: this.route, queryParams: { event: null }, queryParamsHandling: 'merge', replaceUrl: true });
          },
          { injector: this.injector }
        );
      });
  }

  protected onFoundationChange(value: string | null): void {
    this.selectedFoundation.set(value);
  }

  protected onRoleChange(value: string | null): void {
    this.selectedRole.set(value);
  }

  protected onStatusChange(value: string | null): void {
    this.selectedStatus.set(value);
  }

  protected onSearchQueryChange(value: string): void {
    this.selectedSearchQuery.set(value);
  }

  protected onActiveTabChange(tab: string): void {
    if (!VALID_MY_EVENTS_TAB_IDS.has(tab as EventTabId)) return;

    // Deliberate replaceUrl, matching the deep-link strip above and OrgEventsDashboardComponent's
    // tab pattern — manual tab switches don't push a history entry.
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab === DEFAULT_MY_EVENTS_TAB_ID ? null : tab, event: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });

    // Reset all filters when switching tabs — each tab has different filter sets
    this.selectedFoundation.set(null);
    this.selectedRole.set(null);
    this.selectedStatus.set(null);
    this.selectedSearchQuery.set('');
  }

  /** False when isCreateEnabled is false or the active tab's request-list child isn't rendered yet. */
  protected openCurrentRequestDialog(): boolean {
    if (!this.isCreateEnabled()) return false;
    return this.eventsListRef()?.openCurrentRequestDialog() ?? false;
  }

  /** Template wrapper — (onClick) expects void; openCurrentRequestDialog()'s boolean return would otherwise trigger preventDefault(). */
  protected onNewRequestClick(): void {
    this.openCurrentRequestDialog();
  }

  protected resetFilters(): void {
    this.selectedFoundation.set(null);
    this.selectedRole.set(null);
    this.selectedStatus.set(null);
    this.selectedSearchQuery.set('');
  }

  private initActiveTab(): Signal<EventTabId> {
    return computed(() => {
      const raw = this.queryParamMap().get('tab');
      return raw && VALID_MY_EVENTS_TAB_IDS.has(raw as EventTabId) ? (raw as EventTabId) : DEFAULT_MY_EVENTS_TAB_ID;
    });
  }

  private initActiveEventId(): Signal<string | null> {
    return computed(() => this.queryParamMap().get('event'));
  }

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
            key: SALESFORCE_ERROR_TOAST_KEY,
            severity: 'error',
            summary: 'Error',
            detail: 'Your account is missing the required Salesforce ID. Please contact support.',
            data: { showSupport: true },
            closable: true,
            // Sticky: the Contact Support CTA is the only remediation path — a 3s auto-dismiss
            // (PrimeNG default life) would remove it before most users finish reading.
            sticky: true,
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
