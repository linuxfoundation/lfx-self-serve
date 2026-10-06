// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Injectable, Signal, signal } from '@angular/core';
import type { CampaignNegativeKeywordOutcomeRow, CampaignNegativeKeywordsRequestState, CampaignNegativeKeywordsSubmission } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import {
  campaignNegativeKeywordsFailureOutcome,
  campaignNegativeKeywordsKey,
  negativeKeywordOutcomeRows,
  summarizeNegativeKeywordOutcomes,
} from '@shared/utils/campaign-negative-keywords.utils';
import { MessageService } from 'primeng/api';
import { take } from 'rxjs';

/**
 * Owns the Optimize tab's negative-keyword requests and their per-keyword outcomes.
 *
 * State is keyed by `campaignNegativeKeywordsKey(projectSlug, briefId, campaignId)`, so one
 * project's or brief's request can never render against another's.
 *
 * WHY `providedIn: 'root'`. `docs/architecture/frontend/component-architecture.md` (tab shells)
 * says state that outlives a tab switch belongs in a component-provided service, never a root one,
 * so it cannot leak across unrelated visits. This is the considered exception: the request outlives
 * not only the editor but the whole Optimize tab and the campaigns page. A tab switch, or a
 * campaign-list re-read (which sets the list to `null` and unmounts every row), destroys the editor
 * mid-flight, and an operator who leaves the page and comes back while the request is still running
 * must still see it as pending — that is what keeps the one-request-per-campaign guard holding, so
 * the same keywords cannot be sent twice. Held in the editor, the outcome was lost (the toast
 * carried only counts, so nobody could tell WHICH keywords were added, refused or unconfirmed) and
 * the parent's pending flag, fed by an output the destroyed editor could no longer emit, stayed
 * `true` forever.
 *
 * The leak the rule guards against is bounded instead: SETTLED entries are dropped by
 * `clearSettled` when the tab switches project or brief and on its Refresh, and by `dismiss` from
 * the row. An entry still in flight is never removed; it settles here and is cleared later.
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

  /** The latest request per `campaignNegativeKeywordsKey`. */
  public readonly requests: Signal<Record<string, CampaignNegativeKeywordsRequestState>> = this.state.asReadonly();

  /**
   * Sends one request, unless one is already in flight for the campaign. `onAllSettled` runs once,
   * and only when every keyword was added or already present, so the caller may clear its input.
   *
   * `take(1)`, never cancelled: aborting would lose the outcome of keywords that may already have
   * been added.
   */
  public submit(submission: CampaignNegativeKeywordsSubmission, onAllSettled?: () => void): void {
    const { projectSlug, briefId, campaignId, campaignName, keywords, matchType } = submission;
    const key = campaignNegativeKeywordsKey(projectSlug, briefId, campaignId);
    if (this.state()[key]?.pending) {
      return;
    }
    this.set(key, { pending: true, outcomeRows: [], batchOutcome: null, batchKeywords: [] });

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
          this.set(key, { pending: false, outcomeRows: rows, batchOutcome: null, batchKeywords: [] });
          if (!rows.some((row) => row.outcome === 'FAILED' || row.outcome === 'UNCONFIRMED')) {
            onAllSettled?.();
          }
          this.announceResult(campaignName, rows);
        },
        error: (err: unknown) => {
          const outcome = campaignNegativeKeywordsFailureOutcome(err);
          this.set(key, { pending: false, outcomeRows: [], batchOutcome: outcome, batchKeywords: keywords });
          this.messageService.add({
            severity: outcome.state === 'unconfirmed' ? 'warn' : 'error',
            summary: outcome.state === 'unconfirmed' ? `Negative keywords not confirmed for ${campaignName}` : `Negative keywords not added to ${campaignName}`,
            detail: outcome.message,
            sticky: true,
          });
        },
      });
  }

  /** Drops every SETTLED request of one (project, brief). Requests still in flight are kept. */
  public clearSettled(projectSlug: string, briefId: string): void {
    const prefix = campaignNegativeKeywordsKey(projectSlug, briefId, '');
    this.state.update((all) => {
      const kept: Record<string, CampaignNegativeKeywordsRequestState> = {};
      for (const [key, request] of Object.entries(all)) {
        if (request.pending || !key.startsWith(prefix)) {
          kept[key] = request;
        }
      }
      return kept;
    });
  }

  /** Drops one campaign's settled request, once the operator has read it. A pending one is kept. */
  public dismiss(projectSlug: string, briefId: string, campaignId: string): void {
    const key = campaignNegativeKeywordsKey(projectSlug, briefId, campaignId);
    if (this.state()[key]?.pending !== false) {
      return;
    }
    this.state.update((all) => {
      const next = { ...all };
      delete next[key];
      return next;
    });
  }

  private set(key: string, request: CampaignNegativeKeywordsRequestState): void {
    this.state.update((all) => ({ ...all, [key]: request }));
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
