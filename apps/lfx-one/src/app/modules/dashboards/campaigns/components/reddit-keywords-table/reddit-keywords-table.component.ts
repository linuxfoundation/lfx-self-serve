// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { afterNextRender, Component, computed, DestroyRef, inject, input, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import {
  CAMPAIGN_NEGATIVE_KEYWORD_PLATFORM_RULES,
  DEFAULT_REDDIT_KEYWORDS_WINDOW,
  LIVE_REGION_MOUNT_DELAY_MS,
  REDDIT_KEYWORD_NEGATIVE_REVISION_ERROR,
  REDDIT_KEYWORDS_ERROR_MESSAGES,
  REDDIT_KEYWORDS_WINDOW_OPTIONS,
} from '@lfx-one/shared/constants';
import type { RedditKeywordDisplayRow, RedditKeywordNegativeTarget, RedditKeywordsView, RedditKeywordsWindow } from '@lfx-one/shared/interfaces';
import { AdsPctPipe } from '@pipes/campaign-optimization.pipe';
import { CampaignNegativeKeywordsService } from '@services/campaign-negative-keywords.service';
import { CampaignService } from '@services/campaign.service';
import { campaignNegativeKeywordsKey, redditKeywordNegativeAction, redditNegativeKeywordText } from '@shared/utils/campaign-negative-keywords.utils';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { catchError, map, of, startWith, switchMap, take } from 'rxjs';

/**
 * The Reddit keyword performance table on the Optimize tab, from campaign-service's
 * `get-reddit-ads-keywords` (#331): the top 50 (campaign, keyword) rows by impressions across the
 * project's own Reddit campaigns, read live.
 *
 * Reddit's keyword report carries no keyword id, match type or status, so a row cannot address the
 * keyword itself (it is removed from a campaign's Keyword targeting panel instead). Its TEXT can be
 * added as a NEGATIVE keyword of the row's campaign, through the same lever as the campaign's own
 * negative-keyword editor (#3299):
 *
 * - Offered only for a row whose Reddit campaign is an AVAILABLE Reddit campaign of this brief
 *   (`negativeTargets`, built from the rows that offer the editor) and whose text the lever accepts.
 * - Confirmed first. Then the campaign's keyword targeting is read for the `revision` Reddit
 *   requires (read AFTER the confirm, so it is as fresh as it can be), and the add is handed to the
 *   root `CampaignNegativeKeywordsService`, which sends it once, toasts its outcome and keeps it past
 *   this table. A read that answers no revision sends nothing.
 * - While a request of the campaign is in flight (from here or its editor) every row of that
 *   campaign is held; a keyword the last request confirmed (added or already present) shows as a
 *   negative instead of the button. Reddit offers no read of the excluded keywords themselves.
 *
 * No conversions (the read requests none). Amounts are in the ad account's own currency: no `$`.
 * Every read failure is worded by status in fixed text.
 */
@Component({
  selector: 'lfx-reddit-keywords-table',
  imports: [AdsPctPipe, ButtonComponent, ConfirmDialogModule, DecimalPipe],
  // Its own instance, so no other page dialog can answer this table's confirmation.
  providers: [ConfirmationService],
  templateUrl: './reddit-keywords-table.component.html',
  styleUrl: './reddit-keywords-table.component.scss',
})
export class RedditKeywordsTableComponent {
  private readonly campaignService = inject(CampaignService);
  private readonly negativeKeywordsService = inject(CampaignNegativeKeywordsService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly projectSlug = input.required<string>();
  /** Bumped by the parent's Refresh to re-read the current window. */
  public readonly reloadToken = input(0);
  /** Campaign names by Reddit campaign id, from the brief's campaigns; a row whose id is not here shows the id. */
  public readonly campaignNames = input<Record<string, string>>({});
  /** The brief the negative-keyword lever is addressed under. No action is offered without one. */
  public readonly briefId = input('');
  /**
   * The brief's Reddit campaigns that take negative keywords now, by Reddit campaign id. A row whose
   * campaign is not here offers no "Add as negative".
   */
  public readonly negativeTargets = input<Record<string, RedditKeywordNegativeTarget>>({});

  protected readonly confirmKey = 'reddit-keywords-add-negative';

  protected readonly windowOptions = REDDIT_KEYWORDS_WINDOW_OPTIONS;
  protected readonly selectedWindow = signal<RedditKeywordsWindow>(DEFAULT_REDDIT_KEYWORDS_WINDOW);
  /** Bumped by the in-panel Retry. */
  private readonly retryToken = signal(0);
  /** The row key whose campaign's revision is being read, by campaign UUID. */
  private readonly revisionReads = signal<Record<string, string>>({});
  /** Rows whose revision read failed, so nothing was sent: the fixed sentence to show, by row key. */
  private readonly revisionErrors = signal<Record<string, string>>({});

  protected readonly view: Signal<RedditKeywordsView> = this.initView();
  /** The rows with their campaign label and action precomputed, so the template calls no method. */
  protected readonly rows: Signal<RedditKeywordDisplayRow[]> = this.initRows();
  /**
   * Set LIVE_REGION_MOUNT_DELAY_MS after this component's first render, so the live region below
   * exists, EMPTY, before any loading text reaches it. A role="status" element inserted with its text already
   * present is not reliably announced — the parent mounts this panel conditionally, and the old
   * loading block was itself inserted pre-filled — so the region is persistent and only its
   * contents change, as the monitoring tab's own read-status region does.
   */
  private readonly liveRegionMounted = signal(false);
  /** What the persistent live region says: the read in flight, and nothing otherwise. */
  protected readonly loadingAnnouncement: Signal<string> = computed(() =>
    this.liveRegionMounted() && this.view().state === 'loading' ? 'Loading Reddit keyword metrics' : ''
  );

  public constructor() {
    afterNextRender(() => {
      // Deferred past this render's own task, so the region is in the DOM, empty, before its text.
      const handle = setTimeout(() => this.liveRegionMounted.set(true), LIVE_REGION_MOUNT_DELAY_MS);
      this.destroyRef.onDestroy(() => clearTimeout(handle));
    });
  }

  protected selectWindow(window: RedditKeywordsWindow): void {
    this.selectedWindow.set(window);
  }

  protected retry(): void {
    this.retryToken.update((n) => n + 1);
  }

  /**
   * Asks before adding. The keyword, campaign and brief are fixed HERE, from the row the operator
   * is looking at, so a re-read landing while the dialog is open cannot change what is sent.
   */
  protected confirmAddNegative(row: RedditKeywordDisplayRow): void {
    const target = this.targetFor(row.campaignId);
    const text = redditNegativeKeywordText(row.keyword);
    if (row.negative.state !== 'available' || target === null || text === null) {
      return;
    }
    const projectSlug = this.projectSlug();
    const briefId = this.briefId();
    this.confirmationService.confirm({
      key: this.confirmKey,
      header: 'Add a negative keyword?',
      message: `Add "${text}" as a negative keyword to ${target.campaignName}? ${CAMPAIGN_NEGATIVE_KEYWORD_PLATFORM_RULES['reddit-ads'].destination} The campaign then stops serving where it matches. This changes a live campaign.`,
      acceptLabel: 'Add as negative',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-sm',
      rejectButtonStyleClass: 'p-button-outlined p-button-sm',
      accept: () => this.addNegative(projectSlug, briefId, row, target, text),
    });
  }

  private initRows(): Signal<RedditKeywordDisplayRow[]> {
    return computed(() => {
      const names = this.campaignNames();
      const projectSlug = this.projectSlug();
      const briefId = this.briefId();
      const requests = this.negativeKeywordsService.requests();
      const reads = this.revisionReads();
      const errors = this.revisionErrors();
      return (this.view().data?.keywords ?? []).map((row) => {
        const target = this.targetFor(row.campaignId);
        const request = target === null ? null : (requests[campaignNegativeKeywordsKey(projectSlug, briefId, target.campaignId)] ?? null);
        const reading = target === null ? undefined : reads[target.campaignId];
        const action = redditKeywordNegativeAction(row.keyword, target, request, { campaignReading: reading !== undefined, rowReading: reading === row.key });
        // A failed revision read sent nothing; it is said only while no request outcome speaks for the keyword.
        const revisionError = Object.hasOwn(errors, row.key) && action.state === 'available' && action.outcomeLabel === '' ? errors[row.key] : '';
        return {
          ...row,
          campaignLabel: Object.hasOwn(names, row.campaignId) ? names[row.campaignId] : row.campaignId,
          negative: revisionError === '' ? action : { ...action, outcomeLabel: 'Not sent', outcomeDetail: revisionError, outcomeTone: 'error' as const },
        };
      });
    });
  }

  /** One read per (project, window, reload, retry); `switchMap` drops a read for an abandoned window. */
  private initView(): Signal<RedditKeywordsView> {
    const idle: RedditKeywordsView = { state: 'idle', data: null, message: '' };
    const request = computed(() => ({
      projectSlug: this.projectSlug(),
      window: this.selectedWindow(),
      reload: this.reloadToken(),
      retry: this.retryToken(),
    }));
    return toSignal(
      toObservable(request).pipe(
        switchMap(({ projectSlug, window }) => {
          if (projectSlug === '') {
            return of(idle);
          }
          return this.campaignService.getRedditKeywords(projectSlug, window).pipe(
            map((data): RedditKeywordsView => ({ state: 'loaded', data, message: '' })),
            catchError((err: unknown) => of(failureView(err))),
            startWith<RedditKeywordsView>({ state: 'loading', data: null, message: '' })
          );
        })
      ),
      { initialValue: idle }
    );
  }

  /**
   * Reads the campaign's keyword targeting for the `revision` Reddit requires, then hands the add to
   * the root service exactly as the campaign's editor does. The read is not retried and its failure
   * sends nothing; a table destroyed mid-read sends nothing either. Nothing is sent when, while the
   * dialog was open, the page moved to another project or brief or the campaign stopped taking
   * negatives.
   */
  private addNegative(projectSlug: string, briefId: string, row: RedditKeywordDisplayRow, target: RedditKeywordNegativeTarget, text: string): void {
    const { campaignId, campaignName } = target;
    const rowKey = row.key;
    if (
      this.projectSlug() !== projectSlug ||
      this.briefId() !== briefId ||
      this.targetFor(row.campaignId)?.campaignId !== campaignId ||
      this.revisionReads()[campaignId] !== undefined ||
      this.negativeKeywordsService.requests()[campaignNegativeKeywordsKey(projectSlug, briefId, campaignId)]?.pending
    ) {
      return;
    }
    this.revisionReads.update((reads) => ({ ...reads, [campaignId]: rowKey }));
    this.revisionErrors.update((errors) => omitKey(errors, rowKey));
    this.campaignService
      .getKeywordTargeting(projectSlug, briefId, campaignId)
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (targeting) => {
          this.revisionReads.update((reads) => omitKey(reads, campaignId));
          const revision = typeof targeting?.revision === 'string' && targeting.revision !== '' ? targeting.revision : null;
          if (revision === null) {
            this.revisionErrors.update((errors) => ({ ...errors, [rowKey]: REDDIT_KEYWORD_NEGATIVE_REVISION_ERROR }));
            return;
          }
          const rules = CAMPAIGN_NEGATIVE_KEYWORD_PLATFORM_RULES['reddit-ads'];
          this.negativeKeywordsService.submit({
            projectSlug,
            briefId,
            campaignId,
            campaignName,
            platform: 'reddit-ads',
            keywords: [text],
            matchType: rules.defaultMatchType,
            revision,
          });
        },
        error: () => {
          this.revisionReads.update((reads) => omitKey(reads, campaignId));
          this.revisionErrors.update((errors) => ({ ...errors, [rowKey]: REDDIT_KEYWORD_NEGATIVE_REVISION_ERROR }));
        },
      });
  }

  /** The brief campaign a row's add would write to, or `null`: none without a brief, nor for a campaign not offered. */
  private targetFor(redditCampaignId: string): RedditKeywordNegativeTarget | null {
    const targets = this.negativeTargets();
    if (this.briefId() === '' || !Object.hasOwn(targets, redditCampaignId)) {
      return null;
    }
    return targets[redditCampaignId];
  }
}

/**
 * A failed read, in fixed words by status. 404 (no Reddit connection) and 400 (Reddit metrics
 * switched off upstream) are standing facts of the foundation or environment, not faults, so they
 * offer no Retry.
 */
function failureView(err: unknown): RedditKeywordsView {
  const status = err instanceof HttpErrorResponse ? err.status : 0;
  if (status === 404) {
    return { state: 'unavailable', data: null, message: REDDIT_KEYWORDS_ERROR_MESSAGES.notConnected };
  }
  if (status === 400) {
    return { state: 'unavailable', data: null, message: REDDIT_KEYWORDS_ERROR_MESSAGES.disabled };
  }
  if (status === 409) {
    return { state: 'error', data: null, message: REDDIT_KEYWORDS_ERROR_MESSAGES.conflict };
  }
  return { state: 'error', data: null, message: REDDIT_KEYWORDS_ERROR_MESSAGES.other };
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}
