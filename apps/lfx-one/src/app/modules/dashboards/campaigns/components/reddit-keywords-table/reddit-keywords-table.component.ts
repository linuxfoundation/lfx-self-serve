// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { afterNextRender, Component, computed, DestroyRef, inject, input, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import {
  CAMPAIGN_NEGATIVE_KEYWORD_NOT_SENT_LABEL,
  CAMPAIGN_NEGATIVE_KEYWORD_PLATFORM_RULES,
  DEFAULT_REDDIT_KEYWORDS_WINDOW,
  LIVE_REGION_MOUNT_DELAY_MS,
  REDDIT_KEYWORD_NEGATIVE_REVISION_ERROR,
  REDDIT_KEYWORD_NEGATIVE_SCOPE_CHANGED_MESSAGE,
  REDDIT_KEYWORD_NEGATIVE_SUPERSEDED_MESSAGE,
  REDDIT_KEYWORDS_ERROR_MESSAGES,
  REDDIT_KEYWORDS_WINDOW_OPTIONS,
} from '@lfx-one/shared/constants';
import type {
  CampaignNegativeKeywordLastOutcome,
  RedditKeywordDisplayRow,
  RedditKeywordNegativeTarget,
  RedditKeywordsView,
  RedditKeywordsWindow,
} from '@lfx-one/shared/interfaces';
import { slugify } from '@lfx-one/shared/utils';
import { AdsPctPipe } from '@pipes/campaign-optimization.pipe';
import { CampaignKeywordTargetingService } from '@services/campaign-keyword-targeting.service';
import { CampaignNegativeKeywordsService } from '@services/campaign-negative-keywords.service';
import { CampaignService } from '@services/campaign.service';
import {
  campaignKeywordWriteKey,
  campaignNegativeKeywordsKey,
  negativeKeywordsScopesMatch,
  negativeKeywordUnconfirmedAdvice,
  redditKeywordNegativeAction,
  redditNegativeKeywordText,
} from '@shared/utils/campaign-negative-keywords.utils';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { catchError, filter, finalize, map, of, startWith, switchMap, take, takeUntil } from 'rxjs';

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
 * - Confirmed first (with the verify-first advice when the keyword's last add was not confirmed).
 *   Then the campaign is RESERVED in the root `CampaignNegativeKeywordsService` and its keyword
 *   targeting is read for the `revision` Reddit requires (read AFTER the confirm, so it is as fresh
 *   as it can be); the add is handed to that service, which sends it once, toasts its outcome and
 *   keeps it past this table. A failed read, a read with no revision, or a submit the service
 *   refuses sends nothing, and the row says "Not sent" (as an alert, beside the keyword's last write
 *   outcome, which it never hides) until the table reads again, the keyword is tried again, or the
 *   keyword gets a new write outcome. A request for another keyword of the campaign leaves it.
 * - Each keyword keeps its own last write outcome on the campaign (the service's `keywordOutcomes`),
 *   so a later add of another keyword does not erase a "not confirmed" and its verify-first advice.
 * - A campaign's Reddit targeting is one domain: while a negative-keyword request or reservation of
 *   it, or a keyword-targeting removal of it, is in flight, every row of that campaign is held (and
 *   the campaign's editor and targeting panel hold too). A keyword the last request confirmed (added
 *   or already present) shows as a negative instead of the button. Reddit offers no read of the
 *   excluded keywords themselves.
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
  private readonly keywordTargetingService = inject(CampaignKeywordTargetingService);
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
  protected readonly notSentLabel = CAMPAIGN_NEGATIVE_KEYWORD_NOT_SENT_LABEL;

  protected readonly windowOptions = REDDIT_KEYWORDS_WINDOW_OPTIONS;
  protected readonly selectedWindow = signal<RedditKeywordsWindow>(DEFAULT_REDDIT_KEYWORDS_WINDOW);
  /** Bumped by the in-panel Retry. */
  private readonly retryToken = signal(0);
  /** The row key whose campaign's revision is being read, by campaign UUID. */
  private readonly revisionReads = signal<Record<string, string>>({});
  /**
   * Rows whose add was not sent (the revision read failed or answered none, or another keyword change
   * started first, or the page left the campaign), by row key, with the keyword read they were made
   * against and the keyword's own last write outcome then. A Refresh, Retry or window change (a new
   * read), a later attempt for the SAME keyword, or a new write outcome for that keyword drops it; a
   * request for another keyword of the campaign does not.
   */
  private readonly notSent = signal<Record<string, { read: string; lastOutcome: CampaignNegativeKeywordLastOutcome | null; message: string }>>({});
  /**
   * The page's (project, brief), for abandoning an add's revision read when the page LEAVES the scope
   * the add was confirmed in (`negativeKeywordsScopesMatch`: a transient empty brief is not leaving).
   */
  private readonly scope$ = toObservable(computed(() => ({ projectSlug: this.projectSlug(), briefId: this.briefId() })));
  /** Identifies the keyword read the rows come from: changes on Refresh, Retry and window change. */
  private readonly readId: Signal<string> = computed(() => `${this.reloadToken()}|${this.retryToken()}|${this.selectedWindow()}`);

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
    // The last request could not confirm this keyword: it may already be a negative, so say so first.
    const verifyFirst = row.negative.outcomeTone === 'warning' ? ` ${negativeKeywordUnconfirmedAdvice('reddit-ads')}` : '';
    this.confirmationService.confirm({
      key: this.confirmKey,
      header: 'Add a negative keyword?',
      message: `Add "${text}" as a negative keyword to ${target.campaignName}? ${CAMPAIGN_NEGATIVE_KEYWORD_PLATFORM_RULES['reddit-ads'].destination} The campaign then stops serving where it matches. This changes a live campaign.${verifyFirst}`,
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
      // Holds are by campaign (`campaignKeywordWriteKey`), not brief: a write in flight keeps its brief.
      const reservations = this.negativeKeywordsService.reservations();
      const negativeWrites = this.negativeKeywordsService.pendingWrites();
      const removalWrites = this.keywordTargetingService.pendingWrites();
      const reads = this.revisionReads();
      const notSent = this.notSent();
      const readId = this.readId();
      return (this.view().data?.keywords ?? []).map((row) => {
        const target = this.targetFor(row.campaignId);
        const key = target === null ? '' : campaignNegativeKeywordsKey(projectSlug, briefId, target.campaignId);
        const writeKey = target === null ? '' : campaignKeywordWriteKey(projectSlug, target.campaignId);
        const reading = target === null ? undefined : reads[target.campaignId];
        const unsent = Object.hasOwn(notSent, row.key) ? notSent[row.key] : null;
        const text = redditNegativeKeywordText(row.keyword);
        const lastOutcome = text !== null && requests[key] && Object.hasOwn(requests[key].keywordOutcomes, text) ? requests[key].keywordOutcomes[text] : null;
        const notSentMessage = unsent !== null && unsent.read === readId && unsent.lastOutcome === lastOutcome ? unsent.message : '';
        return {
          ...row,
          campaignLabel: Object.hasOwn(names, row.campaignId) ? names[row.campaignId] : row.campaignId,
          testIdKey: slugify(row.key),
          negative: redditKeywordNegativeAction(
            row.keyword,
            target,
            requests[key] ?? null,
            {
              campaignReading: reading !== undefined || !!reservations[writeKey],
              rowReading: reading === row.key,
              negativeWritePending: !!negativeWrites[writeKey],
              targetingRemovalPending: !!removalWrites[writeKey],
            },
            notSentMessage
          ),
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
   * the root service exactly as the campaign's editor does. The campaign is RESERVED in that service
   * for the read, so its editor (and any other sender) waits; the hold is released just before the
   * submit, and on every other end of the read (failure, a table destroyed mid-read).
   *
   * Nothing is sent when the page moved to another project or brief (a transient EMPTY brief id on
   * the same project, as during a Proceed save, is not a move: `negativeKeywordsScopesMatch`), or
   * the campaign stopped taking negatives (checked when the operator accepts AND again when the read
   * answers, right before the submit — the table stays mounted across those changes, and leaving the
   * scope also cancels the read); when the read fails or answers no revision; or when the service
   * refuses the submit (another change to the campaign's keywords started first). Every one of those,
   * a cancelled read included, leaves the row saying "Not sent": a confirmed add is never dropped silently.
   */
  private addNegative(projectSlug: string, briefId: string, row: RedditKeywordDisplayRow, target: RedditKeywordNegativeTarget, text: string): void {
    const { campaignId, campaignName } = target;
    const rowKey = row.key;
    const readId = this.readId();
    if (!this.stillTargets(projectSlug, briefId, row.campaignId, campaignId)) {
      this.markNotSent(rowKey, readId, target, text, REDDIT_KEYWORD_NEGATIVE_SCOPE_CHANGED_MESSAGE);
      return;
    }
    if (this.revisionReads()[campaignId] !== undefined || !this.negativeKeywordsService.reserve(projectSlug, campaignId)) {
      this.markNotSent(rowKey, readId, target, text, REDDIT_KEYWORD_NEGATIVE_SUPERSEDED_MESSAGE);
      return;
    }
    this.revisionReads.update((reads) => ({ ...reads, [campaignId]: rowKey }));
    let answered = false;
    this.notSent.update((all) => omitKey(all, rowKey));
    this.campaignService
      .getKeywordTargeting(projectSlug, briefId, campaignId)
      .pipe(
        take(1),
        // Leaving the project or brief abandons the read: nothing is sent for a scope the operator left.
        takeUntil(this.scope$.pipe(filter((scope) => !negativeKeywordsScopesMatch(scope.projectSlug, scope.briefId, projectSlug, briefId)))),
        finalize(() => {
          this.negativeKeywordsService.release(projectSlug, campaignId);
          this.revisionReads.update((reads) => omitKey(reads, campaignId));
          // Abandoned before it answered (the page left the scope): never silently.
          if (!answered && !this.destroyRef.destroyed) {
            this.markNotSent(rowKey, readId, target, text, REDDIT_KEYWORD_NEGATIVE_SCOPE_CHANGED_MESSAGE);
          }
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (targeting) => {
          answered = true;
          this.negativeKeywordsService.release(projectSlug, campaignId);
          this.revisionReads.update((reads) => omitKey(reads, campaignId));
          const revision = typeof targeting?.revision === 'string' && targeting.revision !== '' ? targeting.revision : null;
          if (revision === null) {
            this.markNotSent(rowKey, readId, target, text, REDDIT_KEYWORD_NEGATIVE_REVISION_ERROR);
            return;
          }
          if (!this.stillTargets(projectSlug, briefId, row.campaignId, campaignId)) {
            this.markNotSent(rowKey, readId, target, text, REDDIT_KEYWORD_NEGATIVE_SCOPE_CHANGED_MESSAGE);
            return;
          }
          const sent = this.negativeKeywordsService.submit({
            projectSlug,
            briefId,
            campaignId,
            campaignName,
            platform: 'reddit-ads',
            keywords: [text],
            matchType: CAMPAIGN_NEGATIVE_KEYWORD_PLATFORM_RULES['reddit-ads'].defaultMatchType,
            revision,
          });
          if (!sent) {
            this.markNotSent(rowKey, readId, target, text, REDDIT_KEYWORD_NEGATIVE_SUPERSEDED_MESSAGE);
          }
        },
        error: (err: unknown) => {
          answered = true;
          console.error('Failed to read the Reddit keyword targeting revision for an add-as-negative:', err);
          this.markNotSent(rowKey, readId, target, text, REDDIT_KEYWORD_NEGATIVE_REVISION_ERROR);
        },
      });
  }

  private markNotSent(rowKey: string, read: string, target: RedditKeywordNegativeTarget, text: string, message: string): void {
    const request = this.negativeKeywordsService.requests()[campaignNegativeKeywordsKey(this.projectSlug(), this.briefId(), target.campaignId)];
    const lastOutcome = request && Object.hasOwn(request.keywordOutcomes, text) ? request.keywordOutcomes[text] : null;
    this.notSent.update((all) => ({ ...all, [rowKey]: { read, lastOutcome, message } }));
  }

  /**
   * Whether the page is still in the scope an add was confirmed in (`negativeKeywordsScopesMatch`: a
   * transient empty brief id on the same project still is) and the row's Reddit campaign still maps
   * to the same campaign that takes negatives. The add is always sent under the CONFIRMED brief.
   */
  private stillTargets(projectSlug: string, briefId: string, redditCampaignId: string, campaignId: string): boolean {
    if (!negativeKeywordsScopesMatch(this.projectSlug(), this.briefId(), projectSlug, briefId)) {
      return false;
    }
    const targets = this.negativeTargets();
    return Object.hasOwn(targets, redditCampaignId) && targets[redditCampaignId].campaignId === campaignId;
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
