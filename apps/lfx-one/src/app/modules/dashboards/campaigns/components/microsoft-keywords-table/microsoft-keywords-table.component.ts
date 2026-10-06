// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, output, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  DEFAULT_MICROSOFT_KEYWORDS_WINDOW,
  KEYWORD_ACTION_OUTCOME_CLASSES,
  KEYWORD_ACTION_OUTCOME_LABELS,
  MICROSOFT_KEYWORDS_WINDOW_OPTIONS,
} from '@lfx-one/shared/constants';
import type {
  KeywordActionOutcome,
  KeywordActionType,
  MicrosoftKeywordActionRequest,
  MicrosoftKeywordDisplayRow,
  MicrosoftKeywordMetrics,
  MicrosoftKeywordMetricsResponse,
  MicrosoftKeywordsWindow,
} from '@lfx-one/shared/interfaces';
import { keywordActionKey } from '@lfx-one/shared/utils';
import { AdsPctPipe } from '@pipes/campaign-optimization.pipe';
import { CampaignService } from '@services/campaign.service';
import { ButtonComponent } from '@components/button/button.component';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { catchError, EMPTY, map, of, switchMap } from 'rxjs';

/**
 * The Microsoft Advertising keyword table on the Optimize tab.
 *
 * The Google keyword table's sibling, with the differences the source forces:
 *
 * - The figures come from campaign-service's last FINISHED saved report, not a live query, so the
 *   table always says how old they are (`metricsAsOf`) and whether a newer one is building. A
 *   first read with no finished report (`metricsAsOf: null`) is "the report is building", never
 *   "no keywords".
 * - It takes a reporting WINDOW (`MICROSOFT_KEYWORDS_WINDOWS`), not a day count.
 * - Amounts are in each ad account's own currency, which this view does not know: no `$`, and
 *   spend is never totalled across campaigns.
 * - A conversion count Microsoft left blank arrives as `0`; when the report says so
 *   (`conversionsComplete: false`) a `0` is shown as not measured.
 *
 * Owns its read. The keyword ACTIONS stay with the parent, which already owns the Google actions'
 * request, positional outcome reading and toast; this table only asks for one and renders the
 * state the parent hands back, keyed by `keywordActionKey`.
 */
@Component({
  selector: 'lfx-microsoft-keywords-table',
  imports: [AdsPctPipe, ButtonComponent, DatePipe, DecimalPipe],
  templateUrl: './microsoft-keywords-table.component.html',
  styleUrl: './microsoft-keywords-table.component.scss',
})
export class MicrosoftKeywordsTableComponent {
  private readonly campaignService = inject(CampaignService);

  public readonly projectSlug = input.required<string>();
  /** Bumped by the parent's Refresh to re-read the current window. */
  public readonly reloadToken = input(0);
  /** The parent's in-flight keyword actions, keyed by `keywordActionKey`. */
  public readonly actionInProgress = input<Record<string, boolean>>({});
  /** The parent's keyword action outcomes, keyed by `keywordActionKey`. */
  public readonly actionResults = input<Record<string, KeywordActionOutcome>>({});

  public readonly keywordAction = output<MicrosoftKeywordActionRequest>();

  protected readonly windowOptions = MICROSOFT_KEYWORDS_WINDOW_OPTIONS;
  protected readonly selectedWindow = signal<MicrosoftKeywordsWindow>(DEFAULT_MICROSOFT_KEYWORDS_WINDOW);
  protected readonly state = signal<'idle' | 'loading' | 'loaded' | 'error' | 'not-connected'>('idle');
  /** Bumped by the in-panel Retry button; combined with the page-level reloadToken. */
  protected readonly retryToken = signal(0);
  protected readonly data = signal<MicrosoftKeywordMetricsResponse | null>(null);
  protected readonly errorMessage = signal('');

  protected readonly OUTCOME_LABEL = KEYWORD_ACTION_OUTCOME_LABELS;
  protected readonly OUTCOME_CLASS = KEYWORD_ACTION_OUTCOME_CLASSES;

  /** True when no finished report covers the project yet: the rows are empty because it is building. */
  protected readonly reportBuilding: Signal<boolean> = computed(() => {
    const data = this.data();
    return data !== null && data.metricsAsOf === null;
  });
  protected readonly rows: Signal<MicrosoftKeywordDisplayRow[]> = this.initRows();
  /** False when the conversions total may be understated, because some rows' conversions were left blank. */
  protected readonly conversionsTotalMeasured: Signal<boolean> = computed(() => this.data()?.conversionsComplete === true);

  public constructor() {
    this.initLoad();
  }

  protected selectWindow(window: MicrosoftKeywordsWindow): void {
    this.selectedWindow.set(window);
  }

  protected retry(): void {
    this.retryToken.update((n) => n + 1);
  }

  protected act(keyword: MicrosoftKeywordMetrics, action: KeywordActionType): void {
    this.keywordAction.emit({ keyword, action });
  }

  /**
   * One read per (project, window, reload). `switchMap`, so a read for an abandoned window is
   * cancelled rather than landing over the new one; errors are caught inside the switch so one
   * failed read does not end the stream.
   */
  private initLoad(): void {
    toObservable(computed(() => ({ projectSlug: this.projectSlug(), window: this.selectedWindow(), reload: this.reloadToken(), retry: this.retryToken() })))
      .pipe(
        switchMap(({ projectSlug, window }) => {
          this.data.set(null);
          this.errorMessage.set('');
          if (projectSlug === '') {
            this.state.set('idle');
            return EMPTY;
          }
          this.state.set('loading');
          return this.campaignService.getMicrosoftKeywords(projectSlug, window).pipe(
            map((data) => ({ data, error: '', notConnected: false })),
            catchError((err: unknown) =>
              of({
                data: null,
                error: extractErrorMessage(err, 'Microsoft keyword metrics are unavailable right now.'),
                // A foundation with no Microsoft Advertising connection (404), or a deployment where
                // Microsoft metrics are not enabled (400), is not a failure to retry — it is a
                // state to state plainly, without an error box on every project page.
                notConnected: isNotConnectedStatus(err),
              })
            )
          );
        }),
        takeUntilDestroyed()
      )
      .subscribe(({ data, error, notConnected }) => {
        this.data.set(data);
        this.errorMessage.set(error);
        if (data !== null) {
          this.state.set('loaded');
        } else if (notConnected) {
          this.state.set('not-connected');
        } else {
          this.state.set('error');
        }
      });
  }

  private initRows(): Signal<MicrosoftKeywordDisplayRow[]> {
    return computed(() => {
      const data = this.data();
      if (data === null) {
        return [];
      }
      const inProgress = this.actionInProgress();
      const results = this.actionResults();
      return (data.keywords ?? []).map((keyword) => {
        const key = keywordActionKey('microsoft-ads', keyword.adGroupId, keyword.criterionId);
        return {
          key,
          keyword,
          inProgress: !!inProgress[key],
          result: results[key] ?? null,
          conversionsMeasured: data.conversionsComplete || keyword.conversions !== 0,
        };
      });
    });
  }
}

/** 404 (no Microsoft connection for this foundation) or 400 (Microsoft metrics not enabled). */
function isNotConnectedStatus(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return status === 404 || status === 400;
}
