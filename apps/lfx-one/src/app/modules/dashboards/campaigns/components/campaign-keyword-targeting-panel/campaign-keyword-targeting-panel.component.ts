// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, output, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { KEYWORD_TARGETING_PLATFORM_LABELS, KEYWORD_TARGETING_REMOVE_ALL_REASON, MAX_KEYWORD_TARGETING_REMOVALS } from '@lfx-one/shared/constants';
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
import { CampaignService } from '@services/campaign.service';
import { keywordTargetingListItems, keywordTargetingReadErrorMessage, summarizeKeywordTargetingRemovals } from '@shared/utils/campaign-keyword-targeting.utils';
import { campaignNegativeKeywordsKey } from '@shared/utils/campaign-negative-keywords.utils';
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
 * - Every settled removal re-reads the targeting (also in a panel reopened after it), so the list
 *   (and Reddit's revision) is what the platform now holds; the outcomes stay on screen beside it.
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
  private readonly confirmationService = inject(ConfirmationService);

  public readonly projectSlug = input.required<string>();
  public readonly briefId = input.required<string>();
  public readonly campaignId = input.required<string>();
  public readonly campaignName = input.required<string>();
  /** The row's platform, for wording until the read answers; the read's own `platform` decides what is sent. */
  public readonly platform = input.required<KeywordTargetingPlatform>();

  public readonly closePanel = output<void>();

  protected readonly maxRemovals = MAX_KEYWORD_TARGETING_REMOVALS;

  /** Keys (`KeywordTargetingListItem.key`) of the keywords ticked for removal. */
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  /** Bumped by Reload to read the targeting again. A settled removal re-reads on its own. */
  private readonly reload = signal(0);

  /** This campaign's latest removal, which outlives this panel. `null` before the first one. */
  private readonly removal: Signal<KeywordTargetingRemovalState | null> = computed(
    () => this.targetingService.removals()[campaignNegativeKeywordsKey(this.projectSlug(), this.briefId(), this.campaignId())] ?? null
  );
  /** Bumped by every settled removal of this campaign, even one that settled while the panel was closed. */
  private readonly settleCount: Signal<number> = computed(() => this.removal()?.settleCount ?? 0);
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
  protected readonly canRemove: Signal<boolean> = computed(() => !this.removing() && this.selectedItems().length > 0 && this.blockedReason() === '');
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
    if (this.removing()) {
      return;
    }
    const keywords: KeywordTargetingRemovalItem[] = items.map((item) => item.removalItem).filter((item): item is KeywordTargetingRemovalItem => item !== null);
    const isReddit = targeting.platform === 'reddit-ads';
    // Reddit requires the read's revision; X refuses one whenever it is present, even empty.
    if (isReddit && !targeting.revision) {
      return;
    }
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

  /**
   * The live targeting, read again on Reload and whenever a removal of this campaign settles
   * (including one that settled while the panel was closed). Errors are worded by status, never by
   * upstream text.
   */
  private initReadState(): Signal<KeywordTargetingReadState> {
    const loading: KeywordTargetingReadState = { status: 'loading', targeting: null, message: '' };
    const request = computed(() => ({
      projectSlug: this.projectSlug(),
      briefId: this.briefId(),
      campaignId: this.campaignId(),
      reload: this.reload(),
      settled: this.settleCount(),
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
