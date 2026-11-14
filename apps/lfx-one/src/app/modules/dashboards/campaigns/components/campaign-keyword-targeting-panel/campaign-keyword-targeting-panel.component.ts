// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, output, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import {
  CAMPAIGN_NEGATIVE_KEYWORD_NOT_SENT_LABEL,
  KEYWORD_TARGETING_PLATFORM_LABELS,
  KEYWORD_TARGETING_REMOVAL_IN_PROGRESS_REASON,
  KEYWORD_TARGETING_REMOVAL_NOT_SENT_MESSAGES,
  KEYWORD_TARGETING_REMOVE_ALL_REASON,
  KEYWORD_TARGETING_REVISION_PLATFORMS,
  MAX_KEYWORD_TARGETING_REMOVALS,
} from '@lfx-one/shared/constants';
import type {
  CampaignServiceKeywordTargeting,
  KeywordTargetingListItem,
  KeywordTargetingPlatform,
  KeywordTargetingReadState,
  KeywordTargetingRemovalBatchOutcome,
  KeywordTargetingRemovalItem,
  KeywordTargetingRemovalOutcomeRow,
  KeywordTargetingRemovalsRequest,
  KeywordTargetingRemovalState,
} from '@lfx-one/shared/interfaces';
import { CampaignKeywordTargetingService } from '@services/campaign-keyword-targeting.service';
import { CampaignNegativeKeywordsService } from '@services/campaign-negative-keywords.service';
import { CampaignService } from '@services/campaign.service';
import { keywordTargetingListItems, keywordTargetingReadErrorMessage, summarizeKeywordTargetingRemovals } from '@shared/utils/campaign-keyword-targeting.utils';
import { campaignKeywordWriteKey, campaignNegativeKeywordsKey } from '@shared/utils/campaign-negative-keywords.utils';
import { ConfirmationService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

/**
 * The keyword TARGETING of one Reddit or X campaign, from the Optimize tab: the positive keywords on
 * the ONE ad group (Reddit) or line item (X) campaign-service created, read live, with removal of
 * selected ones. On these platforms a keyword cannot be paused, only removed.
 *
 * - A removal is confirmed first and sent ONCE: never retried, never cancelled (a cancel would lose
 *   the outcome of keywords that may already be gone). It runs in the root
 *   `CampaignKeywordTargetingService`, not here, so closing or unmounting the panel mid-removal loses
 *   nothing: a reopened panel shows it still running, then its outcome, and cannot start another.
 * - The confirmation dialog has its own `ConfirmationService` instance, so no other page dialog can
 *   answer it. Reddit names each keyword by its text and
 *   sends the read's `revision`; X names each by its criterion id and sends no revision, which X's
 *   upstream refuses.
 * - The answer is POSITIONAL: `results[i]` answers the i-th keyword sent, so outcomes are zipped
 *   onto the list sent and kept in that order. UNCONFIRMED is "may or may not have been removed",
 *   never a failure.
 * - Every settled removal, and every settled negative-keyword request of the campaign (Reddit's
 *   revision covers its excluded keywords too), re-reads the targeting (also in a panel reopened
 *   after it), so the list (and Reddit's revision) is what the platform now holds; the outcomes stay
 *   on screen beside it.
 * - Every message is a fixed sentence keyed by outcome, code or status. Upstream text is never shown.
 * - Removing every keyword is held back: upstream refuses it (409), because the campaign would then
 *   serve on its other targeting alone.
 */
@Component({
  selector: 'lfx-campaign-keyword-targeting-panel',
  imports: [ButtonComponent, ConfirmDialogModule],
  providers: [ConfirmationService],
  templateUrl: './campaign-keyword-targeting-panel.component.html',
  styleUrl: './campaign-keyword-targeting-panel.component.scss',
})
export class CampaignKeywordTargetingPanelComponent {
  private readonly campaignService = inject(CampaignService);
  private readonly targetingService = inject(CampaignKeywordTargetingService);
  private readonly negativeKeywordsService = inject(CampaignNegativeKeywordsService);
  private readonly confirmationService = inject(ConfirmationService);

  public readonly projectSlug = input.required<string>();
  public readonly briefId = input.required<string>();
  public readonly campaignId = input.required<string>();
  public readonly campaignName = input.required<string>();
  /** The row's platform, for wording until the read answers; the read's own `platform` decides what is sent. */
  public readonly platform = input.required<KeywordTargetingPlatform>();

  public readonly closePanel = output<void>();

  protected readonly maxRemovals = MAX_KEYWORD_TARGETING_REMOVALS;
  protected readonly notSentLabel = CAMPAIGN_NEGATIVE_KEYWORD_NOT_SENT_LABEL;

  /** Keys (`KeywordTargetingListItem.key`) of the keywords ticked for removal. */
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  /** Bumped by Reload to read the targeting again. A settled removal re-reads on its own. */
  private readonly reload = signal(0);
  /** Why the last CONFIRMED removal was not sent, or `''`. Cleared by the next confirmation or a Reload. */
  protected readonly notSentReason = signal('');
  /** Whether this campaign's platform fingerprints its whole targeting (Reddit), so a negatives add touches it too. */
  private readonly sharesTargetingWithNegatives: Signal<boolean> = computed(() => KEYWORD_TARGETING_REVISION_PLATFORMS.has(this.platform()));

  /** The brief-independent key this campaign's keyword writes are serialized under. */
  private readonly writeKey: Signal<string> = computed(() => campaignKeywordWriteKey(this.projectSlug(), this.campaignId()));
  /** This campaign's latest removal, which outlives this panel. `null` before the first one. */
  private readonly removal: Signal<KeywordTargetingRemovalState | null> = computed(
    () => this.targetingService.removals()[campaignNegativeKeywordsKey(this.projectSlug(), this.briefId(), this.campaignId())] ?? null
  );
  /**
   * Bumped by every settled NEGATIVE-keyword request of this campaign (from its editor or the Reddit
   * keyword table) — on Reddit only. There the revision fingerprints the ad group's WHOLE targeting,
   * excluded keywords included, so an add makes the revision this panel read stale: it reads again.
   * X's negatives are separate criteria with no revision, so they never invalidate X's read.
   */
  private readonly negativesSettleCount: Signal<number> = computed(() =>
    this.sharesTargetingWithNegatives() ? (this.negativeKeywordsService.settledWrites()[this.writeKey()] ?? 0) : 0
  );
  /**
   * Bumped by every settled removal of this campaign under ANY brief key (the page's brief id can
   * change under one), even one that settled while the panel was closed.
   */
  private readonly removalsSettleCount: Signal<number> = computed(() => this.targetingService.settledWrites()[this.writeKey()] ?? 0);
  protected readonly removing: Signal<boolean> = computed(() => this.removal()?.pending ?? false);
  /** Per-keyword outcomes of the last removal, in the order the keywords were SENT. */
  protected readonly outcomeRows: Signal<KeywordTargetingRemovalOutcomeRow[]> = computed(() => this.removal()?.outcomeRows ?? []);
  /** The last removal's outcome when it produced no per-keyword results at all. */
  protected readonly batchOutcome: Signal<KeywordTargetingRemovalBatchOutcome | null> = computed(() => this.removal()?.batchOutcome ?? null);

  protected readonly readState: Signal<KeywordTargetingReadState> = this.initReadState();
  protected readonly items: Signal<KeywordTargetingListItem[]> = computed(() => keywordTargetingListItems(this.readState().targeting));
  protected readonly platformLabel: Signal<string> = computed(() => KEYWORD_TARGETING_PLATFORM_LABELS[this.readState().targeting?.platform ?? this.platform()]);
  /** The ticked keywords still in the list, in list order: what Remove would send. */
  protected readonly selectedItems: Signal<KeywordTargetingListItem[]> = computed(() => {
    const keys = this.selected();
    return this.items().filter((item) => item.removalItem !== null && keys.has(item.key));
  });
  /** Why Remove is held back although something is ticked, or `''`. */
  protected readonly blockedReason: Signal<string> = this.initBlockedReason();
  /**
   * Why no removal can start now, whatever is ticked, or `''`: on Reddit, a negative-keyword add to
   * the same campaign is in flight or about to be sent (reserved). Both rewrite the ad group's one
   * targeting object, so they are serialized here as well as by the revision check upstream. X's
   * negatives do not touch its keyword criteria, so they hold nothing there.
   */
  protected readonly heldReason: Signal<string> = computed(() => {
    const writeKey = this.writeKey();
    // A removal of this campaign sent under another brief key (the page's brief id changed under it).
    if (this.targetingService.pendingWrites()[writeKey] && !this.removing()) {
      return KEYWORD_TARGETING_REMOVAL_IN_PROGRESS_REASON;
    }
    if (!this.sharesTargetingWithNegatives()) {
      return '';
    }
    const busy = !!this.negativeKeywordsService.pendingWrites()[writeKey] || !!this.negativeKeywordsService.reservations()[writeKey];
    return busy ? 'Negative keywords are being added to this campaign. Wait for that to finish before removing keywords.' : '';
  });
  protected readonly canRemove: Signal<boolean> = computed(
    () => !this.removing() && this.selectedItems().length > 0 && this.blockedReason() === '' && this.heldReason() === ''
  );
  protected readonly outcomeSummary: Signal<string> = computed(() => summarizeKeywordTargetingRemovals(this.outcomeRows()));
  protected readonly batchKeywordsText: Signal<string> = computed(() => (this.removal()?.sent ?? []).join(', '));
  protected readonly removingAnnouncement: Signal<string> = computed(() => (this.removing() ? `Removing keywords from ${this.campaignName()}` : ''));
  protected readonly confirmKey: Signal<string> = computed(() => `keyword-targeting-${this.campaignId()}`);
  protected readonly isX: Signal<boolean> = computed(() => (this.readState().targeting?.platform ?? this.platform()) === 'twitter-ads');

  protected toggle(item: KeywordTargetingListItem): void {
    if (item.removalItem === null || this.removing()) {
      return;
    }
    this.selected.update((keys) => {
      const next = new Set(keys);
      if (next.has(item.key)) {
        next.delete(item.key);
      } else {
        next.add(item.key);
      }
      return next;
    });
  }

  protected reloadTargeting(): void {
    if (this.removing()) {
      return;
    }
    this.selected.set(new Set());
    this.notSentReason.set('');
    this.reload.update((n) => n + 1);
  }

  protected close(): void {
    if (!this.removing()) {
      this.closePanel.emit();
    }
  }

  /**
   * Asks before removing. What is sent is fixed HERE, from the list and revision the operator is
   * looking at, so a re-read landing while the dialog is open cannot change it.
   */
  protected confirmRemove(): void {
    const targeting = this.readState().targeting;
    const items = this.selectedItems();
    if (!this.canRemove() || !targeting) {
      return;
    }
    this.notSentReason.set('');
    const names = items.map((item) => `"${item.keyword}"`).join(', ');
    const count = items.length === 1 ? '1 keyword' : `${items.length} keywords`;
    this.confirmationService.confirm({
      key: this.confirmKey(),
      header: `Remove ${count}?`,
      message: `Remove ${names} from the keyword targeting of ${this.campaignName()} on ${this.platformLabel()}? This changes a live campaign.`,
      acceptLabel: 'Remove',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-outlined p-button-sm',
      accept: () => this.remove(targeting, items),
    });
  }

  /** Hands the removal to the root service, which sends it once and keeps its outcome past this panel. */
  private remove(targeting: CampaignServiceKeywordTargeting, items: KeywordTargetingListItem[]): void {
    // Re-checked on accept: a removal or (on Reddit) an add may have started while the dialog was
    // open, or the targeting been read again since (its list, and on Reddit its revision, is then
    // newer than what this removal was confirmed against). A confirmed removal that is not sent says
    // why; it is never dropped silently.
    const notSent = this.removalNotSentReason(targeting);
    if (notSent !== '') {
      this.notSentReason.set(notSent);
      return;
    }
    const keywords: KeywordTargetingRemovalItem[] = items.map((item) => item.removalItem).filter((item): item is KeywordTargetingRemovalItem => item !== null);
    const isReddit = targeting.platform === 'reddit-ads';
    const request: KeywordTargetingRemovalsRequest = {
      briefId: this.briefId(),
      keywords,
      ...(isReddit && { revision: targeting.revision }),
    };
    this.selected.set(new Set());
    this.targetingService.remove({
      projectSlug: this.projectSlug(),
      briefId: this.briefId(),
      campaignId: this.campaignId(),
      campaignName: this.campaignName(),
      platform: targeting.platform,
      request,
      sent: items.map((item) => item.keyword),
    });
  }

  /** Why a confirmed removal cannot be sent now, or `''`. */
  private removalNotSentReason(targeting: CampaignServiceKeywordTargeting): string {
    if (this.removing()) {
      return KEYWORD_TARGETING_REMOVAL_NOT_SENT_MESSAGES.busy;
    }
    if (this.heldReason() !== '') {
      return KEYWORD_TARGETING_REMOVAL_NOT_SENT_MESSAGES.held;
    }
    if (this.readState().targeting !== targeting) {
      return KEYWORD_TARGETING_REMOVAL_NOT_SENT_MESSAGES.reread;
    }
    // Reddit requires the read's revision; X refuses one whenever it is present, even empty.
    if (targeting.platform === 'reddit-ads' && !targeting.revision) {
      return KEYWORD_TARGETING_REMOVAL_NOT_SENT_MESSAGES.noRevision;
    }
    return '';
  }

  /**
   * The live targeting, read again on Reload and whenever a removal or (on Reddit) a negative-keyword
   * request of this campaign settles (including one that settled while the panel was closed). While it is read
   * again the list is empty, so nothing can be removed against the old revision. Errors are worded by status, never by
   * upstream text.
   */
  private initReadState(): Signal<KeywordTargetingReadState> {
    const loading: KeywordTargetingReadState = { status: 'loading', targeting: null, message: '' };
    const request = computed(() => ({
      projectSlug: this.projectSlug(),
      briefId: this.briefId(),
      campaignId: this.campaignId(),
      reload: this.reload(),
      settled: this.removalsSettleCount(),
      negativesSettled: this.negativesSettleCount(),
    }));
    return toSignal(
      toObservable(request).pipe(
        switchMap(({ projectSlug, briefId, campaignId }) =>
          this.campaignService.getKeywordTargeting(projectSlug, briefId, campaignId).pipe(
            map((targeting): KeywordTargetingReadState => ({ status: 'loaded', targeting, message: '' })),
            catchError((err: unknown) => of<KeywordTargetingReadState>({ status: 'error', targeting: null, message: keywordTargetingReadErrorMessage(err) })),
            startWith(loading)
          )
        )
      ),
      { initialValue: loading }
    );
  }

  private initBlockedReason(): Signal<string> {
    return computed(() => {
      const count = this.selectedItems().length;
      if (count === 0) {
        return '';
      }
      if (count > this.maxRemovals) {
        return `Select at most ${this.maxRemovals} keywords per removal (${count} selected).`;
      }
      if (count >= this.items().length) {
        return KEYWORD_TARGETING_REMOVE_ALL_REASON;
      }
      const targeting = this.readState().targeting;
      if (targeting?.platform === 'reddit-ads' && !targeting.revision) {
        return 'Reload the keyword targeting before removing: the read did not include the version Reddit needs.';
      }
      return '';
    });
  }
}
