// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, linkedSignal, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TableComponent } from '@components/table/table.component';
import {
  HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_RECIPIENTS_UNMEASURED,
  HEALTH_METRICS_ENGAGEMENT_QUERY_PARAMS,
  HEALTH_METRICS_ENGAGEMENT_RECIPIENT_FILTERS,
  HEALTH_METRICS_ENGAGEMENT_RECIPIENT_PAGE_SIZE,
  HEALTH_METRICS_ENGAGEMENT_RECIPIENT_SORT_COLUMNS,
  HEALTH_METRICS_ENGAGEMENT_SEARCH_DEBOUNCE_MS,
} from '@lfx-one/shared/constants';
import {
  buildHealthMetricsEngagementRecipientMetrics,
  buildHealthMetricsEngagementRecipientRow,
  filterHealthMetricsEngagementRecipients,
  healthMetricsRowSortValue,
  sortHealthMetricsRows,
} from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiNoteComponent } from '@shared/uikit/note/note.component';
import { UiPaginationComponent } from '@shared/uikit/pagination/pagination.component';
import { UiSearchInputComponent } from '@shared/uikit/search-input/search-input.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { Skeleton } from 'primeng/skeleton';
import { catchError, debounce, distinctUntilChanged, of, skip, switchMap, tap, timer } from 'rxjs';

import { injectHealthMetricsTableSort } from '../../../components/health-metrics-th/health-metrics-table-sort';
import { HealthMetricsThComponent } from '../../../components/health-metrics-th/health-metrics-th.component';
import { HealthMetricsCellComponent } from '../../../components/health-metrics-cell/health-metrics-cell.component';
import { HealthMetricsMetricsRowComponent } from '../../../components/health-metrics-metrics-row/health-metrics-metrics-row.component';

import type {
  HealthMetricsEngagementNewsletterRecipients,
  HealthMetricsEngagementRecipient,
  HealthMetricsEngagementRecipientFilter,
  HealthMetricsEngagementRecipientQuery,
  HealthMetricsEngagementRecipientRowView,
} from '@lfx-one/shared/interfaces';

/**
 * `#recipients` — who opened and clicked the foundation's latest newsletter, most engaged first. It is always the
 * latest newsletter, so the period pill does not move it; search and the segment cut project the loaded rows.
 */
@Component({
  selector: 'lfx-engagement-newsletter-recipients',
  imports: [
    EmptyStateComponent,
    HealthMetricsCellComponent,
    HealthMetricsMetricsRowComponent,
    HealthMetricsThComponent,
    Skeleton,
    TableComponent,
    UiBadgeComponent,
    UiNoteComponent,
    UiOptionComponent,
    UiPaginationComponent,
    UiSearchInputComponent,
    UiSelectComponent,
  ],
  templateUrl: './engagement-newsletter-recipients.component.html',
})
export class EngagementNewsletterRecipientsComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  /** Fires once the section settles, `true` when there is no newsletter to show; its height changes, moving every anchor below. */
  public readonly settled = output<boolean>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  protected readonly filters = HEALTH_METRICS_ENGAGEMENT_RECIPIENT_FILTERS;
  protected readonly size = HEALTH_METRICS_ENGAGEMENT_RECIPIENT_PAGE_SIZE;

  private readonly initialParams = this.route.snapshot.queryParamMap;

  protected readonly filter = signal<HealthMetricsEngagementRecipientFilter>(
    this.toFilter(this.initialParams.get(HEALTH_METRICS_ENGAGEMENT_QUERY_PARAMS.nlFilter))
  );
  protected readonly searchText = signal<string>('');
  protected readonly loading = signal<boolean>(true);
  /** A failed read is not a foundation without a newsletter, and the empty state below asserts the difference. */
  protected readonly loadFailed = signal<boolean>(false);
  /** "12 hr ago" is measured from here; refreshed on every read. */
  protected readonly now = signal<Date>(new Date());

  // Debounced: the cut runs over every recipient, so an undebounced keystroke re-filters them all.
  // Typing is debounced, as the cut runs over every loaded recipient; a cleared search applies at once, so a reset never lags.
  protected readonly search = toSignal(
    toObservable(this.searchText).pipe(debounce((term) => (term ? timer(HEALTH_METRICS_ENGAGEMENT_SEARCH_DEBOUNCE_MS) : of(0)))),
    { initialValue: '' }
  );

  protected readonly query: Signal<HealthMetricsEngagementRecipientQuery> = computed(() => ({
    foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
  }));
  protected readonly response: Signal<HealthMetricsEngagementNewsletterRecipients> = this.initResponse();

  /** No arrow by default: recipients keep the view's engagement order. */
  protected readonly sorting = injectHealthMetricsTableSort(HEALTH_METRICS_ENGAGEMENT_RECIPIENT_SORT_COLUMNS, null);
  /** Narrowing or re-sorting the table must land the reader on rows, so any change to the cut or the order restarts paging. */
  protected readonly page = linkedSignal<string, number>({
    source: computed(() => `${this.query().foundationSlug}|${this.filter()}|${this.search()}|${JSON.stringify(this.sorting.sort())}`),
    computation: () => 0,
  });

  /** The status counts cover the loaded recipients, so a cut read shows the counts of what is loaded. */
  protected readonly metrics = computed(() => buildHealthMetricsEngagementRecipientMetrics(this.response().recipients));
  private readonly rowViewsByRecipient = computed(() => {
    const now = this.now();
    return new Map<HealthMetricsEngagementRecipient, HealthMetricsEngagementRecipientRowView>(
      this.response().recipients.map((recipient) => [recipient, buildHealthMetricsEngagementRecipientRow(recipient, now)])
    );
  });
  protected readonly rowViews = computed<HealthMetricsEngagementRecipientRowView[]>(() => {
    const views = this.rowViewsByRecipient();
    const filtered = filterHealthMetricsEngagementRecipients(this.response().recipients, this.filter(), this.search())
      .map((recipient) => views.get(recipient))
      .filter((view) => view !== undefined);
    return sortHealthMetricsRows(filtered, this.sorting.order(), healthMetricsRowSortValue);
  });
  // Kept inside the loaded rows, so a page picked before a smaller read lands never leaves the table blank.
  protected readonly pageRows = computed(() => {
    const rows = this.rowViews();
    const page = Math.min(this.page(), Math.max(0, Math.ceil(rows.length / this.size) - 1));
    return rows.slice(page * this.size, (page + 1) * this.size);
  });
  protected readonly totalRecords = computed(() => this.rowViews().length);
  /** The foundation has sent no newsletter; the shell shows the section's empty state instead. */
  protected readonly empty = computed(() => !this.loading() && !this.loadFailed() && this.response().newsletter === null);
  /** Locale pinned, so the server render and the hydrated one agree on separators. */
  protected readonly loadedCount = computed(() => this.response().recipients.length.toLocaleString('en-US'));

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      // `skip(1)` drops the cut just read out of the URL; writing it back would be a no-op navigation.
      toObservable(this.filter)
        .pipe(skip(1), takeUntilDestroyed())
        .subscribe((filter) => this.syncUrl(filter));
    }
  }

  protected onFilterChange(key: string | null): void {
    this.filter.set(this.toFilter(key));
  }

  protected onResetFilters(): void {
    this.searchText.set('');
    this.filter.set('all');
  }

  private initResponse(): Signal<HealthMetricsEngagementNewsletterRecipients> {
    if (!isPlatformBrowser(this.platformId)) {
      // `loading` stays at its static `true` so the serialized skeleton matches the pre-hydration DOM.
      return computed(() => HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_RECIPIENTS_UNMEASURED);
    }

    // Latches on the first non-empty slug so an unresolved foundation holds the skeleton.
    let foundationSeen = false;

    return toSignal(
      toObservable(this.query).pipe(
        distinctUntilChanged((a, b) => a.foundationSlug === b.foundationSlug),
        tap((query) => {
          foundationSeen = foundationSeen || query.foundationSlug !== '';
          this.loading.set(true);
          this.loadFailed.set(false);
          this.reading.emit();
        }),
        switchMap((query) =>
          (query.foundationSlug
            ? this.analyticsService.getEngagementNewsletterRecipients(query)
            : of(HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_RECIPIENTS_UNMEASURED)
          ).pipe(
            // `AnalyticsService` has already logged the error before rethrowing it.
            catchError(() => {
              this.loadFailed.set(true);
              return of(HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_RECIPIENTS_UNMEASURED);
            }),
            tap((response) => {
              this.now.set(new Date());
              this.loading.set(!foundationSeen);
              // Held until a foundation is seen, so an unread section cannot release the shell's deep link.
              if (foundationSeen) this.settled.emit(!this.loadFailed() && response.newsletter === null);
            })
          )
        )
      ),
      { initialValue: HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_RECIPIENTS_UNMEASURED }
    );
  }

  private syncUrl(filter: HealthMetricsEngagementRecipientFilter): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [HEALTH_METRICS_ENGAGEMENT_QUERY_PARAMS.nlFilter]: filter === 'all' ? null : filter },
      queryParamsHandling: 'merge',
      preserveFragment: true,
      replaceUrl: true,
    });
  }

  private toFilter(key: string | null): HealthMetricsEngagementRecipientFilter {
    return HEALTH_METRICS_ENGAGEMENT_RECIPIENT_FILTERS.find((filter) => filter.key === key)?.key ?? 'all';
  }
}
