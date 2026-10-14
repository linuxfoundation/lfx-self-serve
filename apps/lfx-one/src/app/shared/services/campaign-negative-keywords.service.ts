// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Injectable, Signal, signal } from '@angular/core';
import { CAMPAIGN_NEGATIVE_KEYWORD_PLATFORM_RULES } from '@lfx-one/shared/constants';
import type {
  CampaignNegativeKeywordOutcomeRow,
  CampaignNegativeKeywordsRequestState,
  CampaignNegativeKeywordsSubmission,
  NegativeKeywordCampaignPlatform,
} from '@lfx-one/shared/interfaces';
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
 * The leak the rule guards against is bounded instead, by an owner that stays mounted: the
 * campaigns page (`CampaignsComponent`, the tab shell) reports its (project, brief) through
 * `setScope` and calls `releaseScope` when it is destroyed. A scope change drops every SETTLED entry
 * outside the new scope, leaving the page drops every settled entry, and a request that settles
 * outside the active scope (or with none active) is dropped as it settles — its toast still
 * announces it. The Optimize tab's Refresh (`clearSettled`) and the row's `dismiss` drop more. An
 * entry still in flight is never removed. Until `setScope` is first called nothing is scoped, so the
 * service is usable on its own.
 *
 * Sign-out needs no reset here: `/logout` is a full-page navigation to a server redirect
 * (`LogoutLinkDirective`), which tears down the whole application and this root instance with it.
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
  /**
   * The key prefix of the campaigns page's (project, brief): `undefined` until `setScope` is first
   * called (nothing scoped), `null` once the page has released it.
   */
  private activeScope: string | null | undefined = undefined;

  /** The latest request per `campaignNegativeKeywordsKey`. */
  public readonly requests: Signal<Record<string, CampaignNegativeKeywordsRequestState>> = this.state.asReadonly();

  /**
   * Sends one request, unless one is already in flight for the campaign. `onAllSettled` runs once,
   * and only when every keyword was added or already present, so the caller may clear its input.
   *
   * `revision` is sent for a REDDIT campaign only, and the request is refused here without one:
   * Reddit requires it, and Microsoft Advertising and X answer a present revision (even an empty
   * one) with 400, so a stray one must never reach them.
   *
   * `take(1)`, never cancelled and never retried: aborting would lose the outcome of keywords that
   * may already have been added, and a resend could add them twice.
   */
  public submit(submission: CampaignNegativeKeywordsSubmission, onAllSettled?: () => void): void {
    const { projectSlug, briefId, campaignId, campaignName, platform, keywords, matchType } = submission;
    const key = campaignNegativeKeywordsKey(projectSlug, briefId, campaignId);
    if (this.state()[key]?.pending) {
      return;
    }
    const revision = CAMPAIGN_NEGATIVE_KEYWORD_PLATFORM_RULES[platform].requiresRevision ? submission.revision : undefined;
    if (CAMPAIGN_NEGATIVE_KEYWORD_PLATFORM_RULES[platform].requiresRevision && !revision) {
      return;
    }
    const settleCount = this.state()[key]?.settleCount ?? 0;
    const base = { sent: keywords, matchType, platform };
    this.set(key, { pending: true, outcomeRows: [], batchOutcome: null, batchKeywords: [], ...base, settleCount });

    this.campaignService
      .addNegativeKeywords(
        projectSlug,
        briefId,
        campaignId,
        keywords.map((text) => ({ text, matchType })),
        revision
      )
      .pipe(take(1))
      .subscribe({
        next: (result) => {
          const rows = negativeKeywordOutcomeRows(keywords, matchType, result, platform);
          this.settle(key, { pending: false, outcomeRows: rows, batchOutcome: null, batchKeywords: [], ...base, settleCount: settleCount + 1 });
          if (!rows.some((row) => row.outcome === 'FAILED' || row.outcome === 'UNCONFIRMED')) {
            onAllSettled?.();
          }
          this.announceResult(campaignName, rows, platform);
        },
        error: (err: unknown) => {
          const outcome = campaignNegativeKeywordsFailureOutcome(err);
          this.settle(key, { pending: false, outcomeRows: [], batchOutcome: outcome, batchKeywords: keywords, ...base, settleCount: settleCount + 1 });
          this.messageService.add({
            severity: outcome.state === 'unconfirmed' ? 'warn' : 'error',
            summary: outcome.state === 'unconfirmed' ? `Negative keywords not confirmed for ${campaignName}` : `Negative keywords not added to ${campaignName}`,
            detail: outcome.message,
            sticky: true,
          });
        },
      });
  }

  /**
   * The campaigns page's current (project, brief). Drops every settled request outside it; a
   * request still in flight is kept until it settles.
   */
  public setScope(projectSlug: string, briefId: string): void {
    const scope = campaignNegativeKeywordsKey(projectSlug, briefId, '');
    if (scope === this.activeScope) {
      return;
    }
    this.activeScope = scope;
    this.dropSettled((key) => !this.inScope(key));
  }

  /** The campaigns page is gone: drops every settled request. Ones in flight are dropped as they settle. */
  public releaseScope(): void {
    this.activeScope = null;
    this.dropSettled(() => true);
  }

  /** Drops every SETTLED request of one (project, brief). Requests still in flight are kept. */
  public clearSettled(projectSlug: string, briefId: string): void {
    const prefix = campaignNegativeKeywordsKey(projectSlug, briefId, '');
    this.dropSettled((key) => key.startsWith(prefix));
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

  /**
   * Whether a request key belongs to the active scope. An EMPTY brief id on either side matches any
   * brief of the same project: the page's brief id goes empty while a Proceed save runs, and stays
   * empty after a failed one, and neither is a switch to another brief — so they must not drop the
   * brief's results, nor a request the tab sent meanwhile under the empty id. Only a different
   * project, or a different real brief id, is out of scope.
   */
  private inScope(key: string): boolean {
    const scope = this.activeScope;
    if (scope === undefined) {
      return true;
    }
    if (scope === null) {
      return false;
    }
    const [activeProject, activeBrief] = scope.split('|');
    const [project, brief] = key.split('|');
    return project === activeProject && (activeBrief === '' || brief === '' || brief === activeBrief);
  }

  private set(key: string, request: CampaignNegativeKeywordsRequestState): void {
    this.state.update((all) => ({ ...all, [key]: request }));
  }

  /** Records a settled request, unless it settled outside the page's active scope. */
  private settle(key: string, request: CampaignNegativeKeywordsRequestState): void {
    if (!this.inScope(key)) {
      this.state.update((all) => {
        const next = { ...all };
        delete next[key];
        return next;
      });
      return;
    }
    this.set(key, request);
  }

  private dropSettled(matches: (key: string) => boolean): void {
    this.state.update((all) => {
      const kept: Record<string, CampaignNegativeKeywordsRequestState> = {};
      for (const [key, request] of Object.entries(all)) {
        if (request.pending || !matches(key)) {
          kept[key] = request;
        }
      }
      return kept;
    });
  }

  /** One toast for the whole request; the per-keyword detail stays with the editor. */
  private announceResult(campaignName: string, rows: CampaignNegativeKeywordOutcomeRow[], platform: NegativeKeywordCampaignPlatform): void {
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
        ? `${summarizeNegativeKeywordOutcomes(rows, platform)} Open the campaign's negative keywords on the Optimize tab to see which.`
        : summarizeNegativeKeywordOutcomes(rows, platform),
      ...(unsettled ? { sticky: true } : { life: 5000 }),
    });
  }
}
