// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, output, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  DEFAULT_MICROSOFT_KEYWORDS_WINDOW,
  KEYWORD_ACTION_OUTCOME_CLASSES,
  KEYWORD_ACTION_OUTCOME_LABELS,
  MICROSOFT_KEYWORD_PREVIOUS_UNCONFIRMED_NOTE,
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
import { isBffErrorEnvelope } from '@shared/utils/campaign-write-error.utils';
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
  /**
   * The action last asked for per row since the table was last read, keyed by `keywordActionKey`.
   * The parent's outcome does not say which action it answers, and a confirmed REMOVE must withdraw
   * the row's controls. Reset by every read, so Refresh offers them again.
   */
  private readonly requestedAction = signal<Record<string, KeywordActionType>>({});

  protected readonly OUTCOME_LABEL = KEYWORD_ACTION_OUTCOME_LABELS;
  protected readonly OUTCOME_CLASS = KEYWORD_ACTION_OUTCOME_CLASSES;
  protected readonly PREVIOUS_UNCONFIRMED_NOTE = MICROSOFT_KEYWORD_PREVIOUS_UNCONFIRMED_NOTE;

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
    const key = keywordActionKey('microsoft-ads', keyword.adGroupId, keyword.criterionId);
    this.requestedAction.update((requested) => ({ ...requested, [key]: action }));
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
          this.requestedAction.set({});
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
                // A foundation with no Microsoft Advertising connection, or a deployment where
                // Microsoft metrics are not enabled, is not a failure to retry — it is a state to
                // state plainly, without an error box on every project page. Decided on what the
                // response SAYS, not its status alone (see `isNotConnectedError`).
                notConnected: isNotConnectedError(err),
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
      const requested = this.requestedAction();
      return (data.keywords ?? []).map((keyword) => {
        const key = keywordActionKey('microsoft-ads', keyword.adGroupId, keyword.criterionId);
        return {
          key,
          keyword,
          inProgress: !!inProgress[key],
          result: results[key] ?? null,
          removed: requested[key] === 'remove' && results[key]?.state === 'done',
          conversionsMeasured: data.conversionsComplete || keyword.conversions !== 0,
        };
      });
    });
  }
}

/**
 * Whether a failed read means "Microsoft metrics are not available for this foundation", rather
 * than a read that failed.
 *
 * Only campaign-service's own answers, relayed in the BFF's `{ error, code }` envelope, qualify:
 * a 404 saying no connection is configured for the project, or a 400 saying the read is not
 * supported (Microsoft metrics switched off). Every other 400 (an unusable connection, a rejected
 * window) and every other 404 (a deployment that has not exposed the route answers a bare
 * "Not Found") is a read failure, shown with its message and a Retry — never as a missing
 * connection, which would hide it.
 *
 * CONTRACT — these are campaign-service's sentences, matched verbatim:
 * - 404 `no microsoft ads connection configured for this project` — `classifyDiscoveryError`'s
 *   `domain.ErrNotFound` arm, `internal/service/connection.go`, with the `microsoftAdsKeywordInsights`
 *   descriptor of `internal/service/connection_keyword_report.go`.
 * - 400 `keyword and audience insights are not supported for this platform` —
 *   `classifyInsightsErrorFor`'s `domain.ErrKeywordInsightsUnsupported` arm,
 *   `internal/service/connection_keywords.go` (raised while `MICROSOFT_METRICS_ENABLED` is off) —
 *   and its sibling `keyword insights is not supported for this platform` (`classifyDiscoveryError`).
 *
 * Both patterns are ANCHORED to the whole message, deliberately the same way: a message is one of
 * these sentences or it is not. A `\b`-bounded substring would also match a longer, different
 * refusal that merely quotes one of them, and hide that refusal as "not connected".
 */
function isNotConnectedError(err: unknown): boolean {
  const status = err instanceof HttpErrorResponse ? err.status : undefined;
  const body: unknown = err instanceof HttpErrorResponse ? err.error : undefined;
  if ((status !== 404 && status !== 400) || !isBffErrorEnvelope(body)) {
    return false;
  }
  const message = (body as { error: string }).error.trim();
  if (status === 404) {
    return /^no .+ connection configured for this project$/i.test(message);
  }
  return /^.+ (?:is|are) not supported for this platform$/i.test(message);
}
