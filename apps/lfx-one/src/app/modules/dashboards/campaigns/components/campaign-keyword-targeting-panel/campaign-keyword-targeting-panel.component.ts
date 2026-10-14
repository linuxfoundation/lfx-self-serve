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
} from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import {
  classifyKeywordTargetingRemovalFailure,
  keywordTargetingListItems,
  keywordTargetingReadErrorMessage,
  keywordTargetingRemovalOutcomeRows,
  summarizeKeywordTargetingRemovals,
} from '@shared/utils/campaign-keyword-targeting.utils';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { catchError, map, of, startWith, switchMap, take } from 'rxjs';

/**
 * The keyword TARGETING of one Reddit or X campaign, from the Optimize tab: the positive keywords on
 * the ONE ad group (Reddit) or line item (X) campaign-service created, read live, with removal of
 * selected ones. On these platforms a keyword cannot be paused, only removed.
 *
 * - A removal is confirmed first and sent ONCE: never retried, never cancelled (a cancel would lose
 *   the outcome of keywords that may already be gone). Reddit names each keyword by its text and
 *   sends the read's `revision`; X names each by its criterion id and sends no revision, which X's
 *   upstream refuses.
 * - The answer is POSITIONAL: `results[i]` answers the i-th keyword sent, so outcomes are zipped
 *   onto the list sent and kept in that order. UNCONFIRMED is "may or may not have been removed",
 *   never a failure.
 * - Every settled removal re-reads the targeting, so the list (and Reddit's revision) is what the
 *   platform now holds; the outcomes stay on screen beside it.
 * - Every message is a fixed sentence keyed by outcome, code or status. Upstream text is never shown.
 * - Removing every keyword is held back: upstream refuses it (409), because the campaign would then
 *   serve on its other targeting alone.
 */
@Component({
  selector: 'lfx-campaign-keyword-targeting-panel',
  imports: [ButtonComponent, ConfirmDialogModule],
  templateUrl: './campaign-keyword-targeting-panel.component.html',
  styleUrl: './campaign-keyword-targeting-panel.component.scss',
})
export class CampaignKeywordTargetingPanelComponent {
  private readonly campaignService = inject(CampaignService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);

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
  protected readonly removing = signal(false);
  /** Per-keyword outcomes of the last removal, in the order the keywords were SENT. */
  protected readonly outcomeRows = signal<KeywordTargetingRemovalOutcomeRow[]>([]);
  /** The last removal's outcome when it produced no per-keyword results at all. */
  protected readonly batchOutcome = signal<KeywordTargetingRemovalBatchOutcome | null>(null);
  /** The keywords that batch outcome is about. */
  protected readonly batchKeywords = signal<string[]>([]);
  /** Bumped to read the targeting again: Reload, and after every settled removal. */
  private readonly reload = signal(0);

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
  protected readonly batchKeywordsText: Signal<string> = computed(() => this.batchKeywords().join(', '));
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

  /** Sends the removal once. Positional outcomes, then a re-read of the targeting whatever happened. */
  private remove(targeting: CampaignServiceKeywordTargeting, items: KeywordTargetingListItem[]): void {
    if (this.removing()) {
      return;
    }
    const keywords: KeywordTargetingRemovalItem[] = items.map((item) => item.removalItem).filter((item): item is KeywordTargetingRemovalItem => item !== null);
    const sent = items.map((item) => item.keyword);
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

    this.removing.set(true);
    this.outcomeRows.set([]);
    this.batchOutcome.set(null);
    this.batchKeywords.set([]);
    const campaignName = this.campaignName();

    this.campaignService
      .removeKeywordTargeting(this.projectSlug(), this.campaignId(), request)
      .pipe(take(1))
      .subscribe({
        next: (result) => {
          const rows = keywordTargetingRemovalOutcomeRows(sent, result);
          this.outcomeRows.set(rows);
          this.announce(campaignName, rows);
          this.settle();
        },
        error: (err: unknown) => {
          const outcome = classifyKeywordTargetingRemovalFailure(err, targeting.platform);
          this.batchOutcome.set(outcome);
          this.batchKeywords.set(sent);
          this.messageService.add({
            severity: outcome.state === 'unconfirmed' ? 'warn' : 'error',
            summary: outcome.state === 'unconfirmed' ? `Keyword removal not confirmed for ${campaignName}` : `Keywords not removed from ${campaignName}`,
            detail: outcome.message,
            sticky: true,
          });
          this.settle();
        },
      });
  }

  /** Re-reads the targeting after a removal settles, so the list shows what the platform now holds. */
  private settle(): void {
    this.removing.set(false);
    this.selected.set(new Set());
    this.reload.update((n) => n + 1);
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

  /** The live targeting, read again whenever `reload` is bumped. Errors are worded by status, never by upstream text. */
  private initReadState(): Signal<KeywordTargetingReadState> {
    const loading: KeywordTargetingReadState = { status: 'loading', targeting: null, message: '' };
    const request = computed(() => ({
      projectSlug: this.projectSlug(),
      briefId: this.briefId(),
      campaignId: this.campaignId(),
      reload: this.reload(),
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
