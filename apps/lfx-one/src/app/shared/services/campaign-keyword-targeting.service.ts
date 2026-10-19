// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Injectable, Signal, signal } from '@angular/core';
import type { KeywordTargetingRemovalOutcomeRow, KeywordTargetingRemovalState, KeywordTargetingRemovalSubmission } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import {
  classifyKeywordTargetingRemovalFailure,
  keywordTargetingRemovalOutcomeRows,
  summarizeKeywordTargetingRemovals,
} from '@shared/utils/campaign-keyword-targeting.utils';
import { campaignNegativeKeywordsKey } from '@shared/utils/campaign-negative-keywords.utils';
import { MessageService } from 'primeng/api';
import { take } from 'rxjs';

/**
 * Owns the Optimize tab's keyword-targeting removals and their per-keyword outcomes, keyed by
 * (project, brief, campaign).
 *
 * Root-provided for the reason `CampaignNegativeKeywordsService` gives: a removal is irreversible and
 * outlives the panel that sent it. Closing the panel (the row's toggle), a campaign-list re-read or a
 * tab switch destroys it mid-flight; held there, the per-keyword outcome was lost and a remounted
 * panel could start a second removal while the first still ran. Here one removal per campaign is in
 * flight at most, and a reopened panel shows it running and then its outcome.
 *
 * Bounded like that service: the campaigns page reports its (project, brief) through `setScope`
 * and calls `releaseScope` when destroyed; settled entries outside the scope are dropped, an entry in
 * flight never is, and one that settles outside the scope is dropped as it settles (its toast still
 * announces it). The Optimize tab's Refresh drops the scope's settled entries (`clearSettled`).
 */
@Injectable({ providedIn: 'root' })
export class CampaignKeywordTargetingService {
  private readonly campaignService = inject(CampaignService);
  private readonly messageService = inject(MessageService);

  private readonly state = signal<Record<string, KeywordTargetingRemovalState>>({});
  /** `undefined` until `setScope` is first called (nothing scoped), `null` once released. */
  private activeScope: string | null | undefined = undefined;

  /** The latest removal per (project, brief, campaign) key. */
  public readonly removals: Signal<Record<string, KeywordTargetingRemovalState>> = this.state.asReadonly();

  /** Sends one removal, unless one is already in flight for the campaign. Sent once: never retried, never cancelled. */
  public remove(submission: KeywordTargetingRemovalSubmission): void {
    const { projectSlug, briefId, campaignId, campaignName, platform, request, sent } = submission;
    const key = campaignNegativeKeywordsKey(projectSlug, briefId, campaignId);
    if (this.state()[key]?.pending) {
      return;
    }
    const settleCount = this.state()[key]?.settleCount ?? 0;
    this.set(key, { pending: true, outcomeRows: [], batchOutcome: null, sent, settleCount });

    this.campaignService
      .removeKeywordTargeting(projectSlug, campaignId, request)
      .pipe(take(1))
      .subscribe({
        next: (result) => {
          const rows = keywordTargetingRemovalOutcomeRows(sent, result);
          this.settle(key, { pending: false, outcomeRows: rows, batchOutcome: null, sent, settleCount: settleCount + 1 });
          this.announce(campaignName, rows);
        },
        error: (err: unknown) => {
          const outcome = classifyKeywordTargetingRemovalFailure(err, platform);
          this.settle(key, { pending: false, outcomeRows: [], batchOutcome: outcome, sent, settleCount: settleCount + 1 });
          this.messageService.add({
            severity: outcome.state === 'unconfirmed' ? 'warn' : 'error',
            summary: outcome.state === 'unconfirmed' ? `Keyword removal not confirmed for ${campaignName}` : `Keywords not removed from ${campaignName}`,
            detail: outcome.message,
            sticky: true,
          });
        },
      });
  }

  public setScope(projectSlug: string, briefId: string): void {
    const scope = campaignNegativeKeywordsKey(projectSlug, briefId, '');
    if (scope === this.activeScope) {
      return;
    }
    this.activeScope = scope;
    this.dropSettled((key) => !this.inScope(key));
  }

  public releaseScope(): void {
    this.activeScope = null;
    this.dropSettled(() => true);
  }

  /** Drops every SETTLED removal of one (project, brief). Removals in flight are kept. */
  public clearSettled(projectSlug: string, briefId: string): void {
    const prefix = campaignNegativeKeywordsKey(projectSlug, briefId, '');
    this.dropSettled((key) => key.startsWith(prefix));
  }

  /** Same rule as `CampaignNegativeKeywordsService`: an empty brief id on either side matches any brief of the project. */
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

  private set(key: string, removal: KeywordTargetingRemovalState): void {
    this.state.update((all) => ({ ...all, [key]: removal }));
  }

  private settle(key: string, removal: KeywordTargetingRemovalState): void {
    if (!this.inScope(key)) {
      this.dropSettled((k) => k === key, true);
      return;
    }
    this.set(key, removal);
  }

  private dropSettled(matches: (key: string) => boolean, includePending = false): void {
    this.state.update((all) => {
      const kept: Record<string, KeywordTargetingRemovalState> = {};
      for (const [key, removal] of Object.entries(all)) {
        if ((removal.pending && !includePending) || !matches(key)) {
          kept[key] = removal;
        }
      }
      return kept;
    });
  }

  private announce(campaignName: string, rows: KeywordTargetingRemovalOutcomeRow[]): void {
    const unconfirmed = rows.some((row) => row.outcome === 'UNCONFIRMED');
    const failed = rows.some((row) => row.outcome === 'FAILED');
    let severity: 'success' | 'warn' | 'error' = 'success';
    if (unconfirmed) {
      severity = 'warn';
    } else if (failed) {
      severity = 'error';
    }
    this.messageService.add({
      severity,
      summary: `Keyword targeting of ${campaignName}`,
      detail: summarizeKeywordTargetingRemovals(rows),
      ...(unconfirmed || failed ? { sticky: true } : { life: 5000 }),
    });
  }
}
