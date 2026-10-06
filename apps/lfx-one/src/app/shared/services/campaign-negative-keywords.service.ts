// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, Signal, signal } from '@angular/core';
import type { CampaignNegativeKeywordOutcomeRow, CampaignNegativeKeywordsRequestState, CampaignNegativeKeywordsSubmission } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import {
  campaignNegativeKeywordsFailureOutcome,
  negativeKeywordOutcomeRows,
  summarizeNegativeKeywordOutcomes,
} from '@shared/utils/campaign-negative-keywords.utils';
import { MessageService } from 'primeng/api';
import { take } from 'rxjs';

/**
 * Owns the Optimize tab's negative-keyword requests and their per-keyword outcomes, per campaign.
 *
 * Root-provided because the request outlives the editor that started it: a tab switch, or a
 * campaign-list re-read (which sets the list to `null` and so unmounts every row), destroys the
 * editor mid-flight. Held in the editor, the outcome was lost — the toast carried only counts, so
 * the operator could not tell WHICH keywords were added, refused or unconfirmed — and the parent's
 * pending flag, fed by an output the destroyed editor could no longer emit, stayed `true` forever.
 * Here both survive, and a remounted editor shows exactly what the request answered.
 *
 * The response is NOT atomic and is POSITIONAL: `results[i]` answers the i-th keyword sent, so the
 * outcomes are zipped onto the exact list that was sent and kept in that order — never matched by
 * text, filtered or re-sorted. UNCONFIRMED is never shown as a failure: that keyword may already be
 * on the campaign, and the operator verifies first.
 */
@Injectable({ providedIn: 'root' })
export class CampaignNegativeKeywordsService {
  private readonly campaignService = inject(CampaignService);
  // App-root, like this service: the toast is what announces an outcome wherever the operator is.
  private readonly messageService = inject(MessageService);

  private readonly state = signal<Record<string, CampaignNegativeKeywordsRequestState>>({});

  /** The latest request per campaign id. */
  public readonly requests: Signal<Record<string, CampaignNegativeKeywordsRequestState>> = this.state.asReadonly();
  /** Which campaigns have a request in flight. */
  public readonly pendingByCampaign: Signal<Record<string, boolean>> = computed(() => {
    const pending: Record<string, boolean> = {};
    for (const [campaignId, request] of Object.entries(this.state())) {
      if (request.pending) {
        pending[campaignId] = true;
      }
    }
    return pending;
  });

  /**
   * Sends one request, unless one is already in flight for the campaign. `onAllSettled` runs only
   * when every keyword was added or already present, so the caller may clear its input.
   *
   * `take(1)`, never cancelled: aborting would lose the outcome of keywords that may already have
   * been added.
   */
  public submit(submission: CampaignNegativeKeywordsSubmission, onAllSettled?: () => void): void {
    const { projectSlug, briefId, campaignId, campaignName, keywords, matchType } = submission;
    if (this.state()[campaignId]?.pending) {
      return;
    }
    this.set(campaignId, { pending: true, outcomeRows: [], batchOutcome: null, batchKeywords: [] });

    this.campaignService
      .addNegativeKeywords(
        projectSlug,
        briefId,
        campaignId,
        keywords.map((text) => ({ text, matchType }))
      )
      .pipe(take(1))
      .subscribe({
        next: (result) => {
          const rows = negativeKeywordOutcomeRows(keywords, matchType, result);
          this.set(campaignId, { pending: false, outcomeRows: rows, batchOutcome: null, batchKeywords: [] });
          if (!rows.some((row) => row.outcome === 'FAILED' || row.outcome === 'UNCONFIRMED')) {
            onAllSettled?.();
          }
          this.announceResult(campaignName, rows);
        },
        error: (err: unknown) => {
          const outcome = campaignNegativeKeywordsFailureOutcome(err);
          this.set(campaignId, { pending: false, outcomeRows: [], batchOutcome: outcome, batchKeywords: keywords });
          this.messageService.add({
            severity: outcome.state === 'unconfirmed' ? 'warn' : 'error',
            summary: outcome.state === 'unconfirmed' ? `Negative keywords not confirmed for ${campaignName}` : `Negative keywords not added to ${campaignName}`,
            detail: outcome.message,
            sticky: true,
          });
        },
      });
  }

  private set(campaignId: string, request: CampaignNegativeKeywordsRequestState): void {
    this.state.update((all) => ({ ...all, [campaignId]: request }));
  }

  /** One toast for the whole request; the per-keyword detail stays with the editor. */
  private announceResult(campaignName: string, rows: CampaignNegativeKeywordOutcomeRow[]): void {
    const unsettled = rows.some((row) => row.outcome === 'FAILED' || row.outcome === 'UNCONFIRMED');
    const unconfirmed = rows.some((row) => row.outcome === 'UNCONFIRMED');
    let severity: 'success' | 'warn' | 'error' = 'success';
    if (unconfirmed) {
      severity = 'warn';
    } else if (unsettled) {
      severity = 'error';
    }
    this.messageService.add({
      severity,
      summary: `Negative keywords for ${campaignName}`,
      detail: unsettled
        ? `${summarizeNegativeKeywordOutcomes(rows)} Open the campaign's negative keywords on the Optimize tab to see which.`
        : summarizeNegativeKeywordOutcomes(rows),
      ...(unsettled ? { sticky: true } : { life: 5000 }),
    });
  }
}
