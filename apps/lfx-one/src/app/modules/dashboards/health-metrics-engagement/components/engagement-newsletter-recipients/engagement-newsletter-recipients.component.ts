// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, linkedSignal, output, PLATFORM_ID, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TableComponent } from '@components/table/table.component';
import {
  HEALTH_METRICS_ENGAGEMENT_NEWSLETTER_RECIPIENTS_UNMEASURED,
  HEALTH_METRICS_ENGAGEMENT_QUERY_PARAMS,
  HEALTH_METRICS_ENGAGEMENT_RECIPIENT_FILTERS,
  HEALTH_METRICS_ENGAGEMENT_RECIPIENT_PAGE_SIZE,
  HEALTH_METRICS_ENGAGEMENT_SEARCH_DEBOUNCE_MS,
} from '@lfx-one/shared/constants';
import {
  buildHealthMetricsEngagementRecipientRow,
  countHealthMetricsEngagementRecipients,
  filterHealthMetricsEngagementRecipients,
  formatIsoDateLabel,
} from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { Skeleton } from 'primeng/skeleton';
import { catchError, debounceTime, distinctUntilChanged, of, skip, switchMap, tap } from 'rxjs';

import type { TablePageEvent } from 'primeng/table';

import type {
  FilterPillOption,
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
  imports: [EmptyStateComponent, FilterPillsComponent, InputTextComponent, Skeleton, TableComponent],
  templateUrl: './engagement-newsletter-recipients.component.html',
})
export class EngagementNewsletterRecipientsComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  /** The sub-nav badge: the latest newsletter's recipients; `null` while a read is pending or failed. */
  public readonly countChange = output<number | null>();
  /** Fires once the section settles, `true` when there is no newsletter to show; its height changes, moving every anchor below. */
  public readonly settled = output<boolean>();
  /** Fires as a read starts, so the L2 shell knows this section's height is about to move again. */
  public readonly reading = output<void>();

  protected readonly searchForm = new FormGroup({ search: new FormControl<string>('', { nonNullable: true }) });

  private readonly initialParams = this.route.snapshot.queryParamMap;

  protected readonly filter = signal<HealthMetricsEngagementRecipientFilter>(
    this.toFilter(this.initialParams.get(HEALTH_METRICS_ENGAGEMENT_QUERY_PARAMS.nlFilter))
  );
  protected readonly size = signal<number>(HEALTH_METRICS_ENGAGEMENT_RECIPIENT_PAGE_SIZE);
  protected readonly loading = signal<boolean>(true);
  /** A failed read is not a foundation without a newsletter, and the empty state below asserts the difference. */
  protected readonly loadFailed = signal<boolean>(false);
  /** "12 hr ago" is measured from here; refreshed on every read. */
  protected readonly now = signal<Date>(new Date());

  // Debounced: the cut runs over every recipient, so an undebounced keystroke re-filters them all.
  protected readonly search = toSignal(this.searchForm.controls.search.valueChanges.pipe(debounceTime(HEALTH_METRICS_ENGAGEMENT_SEARCH_DEBOUNCE_MS)), {
    initialValue: '',
  });

  protected readonly query: Signal<HealthMetricsEngagementRecipientQuery> = computed(() => ({
    foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '',
  }));
  protected readonly response: Signal<HealthMetricsEngagementNewsletterRecipients> = this.initResponse();

  /** Narrowing the table must land the reader on rows, so any change to the cut restarts paging. */
  protected readonly first = linkedSignal<string, number>({
    source: computed(() => `${this.query().foundationSlug}|${this.filter()}|${this.search()}`),
    computation: () => 0,
  });

  /** Each pill carries its cut's count, as the design labels them. */
  protected readonly filterOptions = computed<FilterPillOption[]>(() => {
    const counts = countHealthMetricsEngagementRecipients(this.response().recipients);
    return HEALTH_METRICS_ENGAGEMENT_RECIPIENT_FILTERS.map((filter) => ({
      id: filter.key,
      label: `${filter.label} (${counts[filter.key].toLocaleString('en-US')})`,
    }));
  });
  // Labelled once per response rather than per keystroke: the date fallback builds an `Intl` formatter per call.
  private readonly rowViewsByRecipient = computed(() => {
    const now = this.now();
    return new Map<HealthMetricsEngagementRecipient, HealthMetricsEngagementRecipientRowView>(
      this.response().recipients.map((recipient) => [recipient, buildHealthMetricsEngagementRecipientRow(recipient, now)])
    );
  });
  protected readonly rowViews = computed<HealthMetricsEngagementRecipientRowView[]>(() => {
    const views = this.rowViewsByRecipient();
    return filterHealthMetricsEngagementRecipients(this.response().recipients, this.filter(), this.search())
      .map((recipient) => views.get(recipient))
      .filter((view) => view !== undefined);
  });
  protected readonly totalRecords = computed(() => this.rowViews().length);
  /** The foundation has sent no newsletter; the shell shows the section's empty state instead. */
  protected readonly empty = computed(() => !this.loading() && !this.loadFailed() && this.response().newsletter === null);
  protected readonly newsletterLabel = computed(() => {
    const newsletter = this.response().newsletter;
    if (!newsletter) return '';
    return newsletter.sentDate ? `${newsletter.name} · Sent ${formatIsoDateLabel(newsletter.sentDate)}` : newsletter.name;
  });
  /** Locale pinned, so the server render and the hydrated one agree on separators. */
  protected readonly loadedCount = computed(() => this.response().recipients.length.toLocaleString('en-US'));
  protected readonly countLabel = computed(() => `${this.loadedCount()} ${this.response().recipients.length === 1 ? 'recipient' : 'recipients'}`);

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      // `skip(1)` drops the cut just read out of the URL; writing it back would be a no-op navigation.
      toObservable(this.filter)
        .pipe(skip(1), takeUntilDestroyed())
        .subscribe((filter) => this.syncUrl(filter));
    }
  }

  protected onFilterChange(key: string): void {
    this.filter.set(this.toFilter(key));
  }

  protected onTablePage(event: TablePageEvent): void {
    this.size.set(event.rows ?? this.size());
    this.first.set(event.first ?? 0);
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
          this.countChange.emit(null);
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
              if (!foundationSeen) return;

              this.countChange.emit(this.loadFailed() || !response.newsletter ? null : response.recipients.length);
              this.settled.emit(!this.loadFailed() && response.newsletter === null);
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
