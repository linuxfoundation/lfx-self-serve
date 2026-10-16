// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { afterNextRender, Component, computed, DestroyRef, inject, input, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import {
  DEFAULT_REDDIT_KEYWORDS_WINDOW,
  LIVE_REGION_MOUNT_DELAY_MS,
  REDDIT_KEYWORDS_ERROR_MESSAGES,
  REDDIT_KEYWORDS_WINDOW_OPTIONS,
} from '@lfx-one/shared/constants';
import type { RedditKeywordDisplayRow, RedditKeywordsView, RedditKeywordsWindow } from '@lfx-one/shared/interfaces';
import { AdsPctPipe } from '@pipes/campaign-optimization.pipe';
import { CampaignService } from '@services/campaign.service';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

/**
 * The Reddit keyword performance table on the Optimize tab, from campaign-service's
 * `get-reddit-ads-keywords` (#331): the top 50 (campaign, keyword) rows by impressions across the
 * project's own Reddit campaigns, read live.
 *
 * READ-ONLY. Reddit's keyword report carries no keyword id, match type or status, so a row cannot
 * address an action; keywords are removed from a campaign's Keyword targeting panel instead. No
 * conversions (the read requests none). Amounts are in the ad account's own currency: no `$`.
 * Every failure is worded by status in fixed text.
 */
@Component({
  selector: 'lfx-reddit-keywords-table',
  imports: [AdsPctPipe, ButtonComponent, DecimalPipe],
  templateUrl: './reddit-keywords-table.component.html',
  styleUrl: './reddit-keywords-table.component.scss',
})
export class RedditKeywordsTableComponent {
  private readonly campaignService = inject(CampaignService);

  public readonly projectSlug = input.required<string>();
  /** Bumped by the parent's Refresh to re-read the current window. */
  public readonly reloadToken = input(0);
  /** Campaign names by Reddit campaign id, from the brief's campaigns; a row whose id is not here shows the id. */
  public readonly campaignNames = input<Record<string, string>>({});

  protected readonly windowOptions = REDDIT_KEYWORDS_WINDOW_OPTIONS;
  protected readonly selectedWindow = signal<RedditKeywordsWindow>(DEFAULT_REDDIT_KEYWORDS_WINDOW);
  /** Bumped by the in-panel Retry. */
  private readonly retryToken = signal(0);

  protected readonly view: Signal<RedditKeywordsView> = this.initView();
  /** The rows with their campaign label precomputed, so the template calls no method. */
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
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      // Deferred past this render's own task, so the region is in the DOM, empty, before its text.
      const handle = setTimeout(() => this.liveRegionMounted.set(true), LIVE_REGION_MOUNT_DELAY_MS);
      destroyRef.onDestroy(() => clearTimeout(handle));
    });
  }

  protected selectWindow(window: RedditKeywordsWindow): void {
    this.selectedWindow.set(window);
  }

  protected retry(): void {
    this.retryToken.update((n) => n + 1);
  }

  private initRows(): Signal<RedditKeywordDisplayRow[]> {
    return computed(() => {
      const names = this.campaignNames();
      return (this.view().data?.keywords ?? []).map((row) => ({
        ...row,
        campaignLabel: Object.hasOwn(names, row.campaignId) ? names[row.campaignId] : row.campaignId,
      }));
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
