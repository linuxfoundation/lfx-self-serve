// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import {
  BID_WRITABLE_CAMPAIGN_PLATFORMS,
  BUDGET_WRITABLE_CAMPAIGN_PLATFORMS,
  CAMPAIGN_ACT_AMBIGUOUS_MESSAGE,
  CAMPAIGN_ACT_META_RESUME_NOTE,
  CAMPAIGN_ACT_NO_ETAG_MESSAGE,
  CAMPAIGN_ACT_RECORD_FAILED_MESSAGE,
  CAMPAIGN_ACT_RESOLVE_UNEXPECTED_MESSAGE,
  CAMPAIGN_ACT_RESUME_ADOPTED_NOTE,
  CAMPAIGN_ACT_UNOWNED_MESSAGE,
  CAMPAIGN_BID_BLOCKED_BUSY_REASON,
  CAMPAIGN_BID_BLOCKED_STALE_REASON,
  CAMPAIGN_BID_UNAVAILABLE_PLATFORM_REASON,
  CAMPAIGN_BID_UNAVAILABLE_UNPROVISIONED_REASON,
  CAMPAIGN_BUDGET_BLOCKED_STALE_REASON,
  CAMPAIGN_BUDGET_BLOCKED_TOGGLE_REASON,
  CAMPAIGN_BUDGET_UNAVAILABLE_PLATFORM_REASON,
  CAMPAIGN_BUDGET_UNAVAILABLE_UNPROVISIONED_REASON,
  CAMPAIGN_ETAG_STALE_MESSAGE,
  CAMPAIGN_PLATFORMS,
  CAMPAIGN_TOGGLE_DONE_VERBS,
  CAMPAIGN_TOGGLE_FAILURE_MESSAGES,
  CAMPAIGN_TOGGLE_LABELS,
  CAMPAIGN_TOGGLE_UNCONFIRMED_MESSAGES,
  CAMPAIGN_UNAVAILABLE_DEFAULT_REASON,
  CAMPAIGN_UNAVAILABLE_DEPLOYMENT_REASON,
  CAMPAIGN_UNAVAILABLE_PLATFORM_REASON,
  CAMPAIGN_UNAVAILABLE_REASONS,
  DEFAULT_CAMPAIGN_BID_TYPE,
  TOGGLEABLE_CAMPAIGN_PLATFORMS,
  campaignToggleAction,
  normalizeCampaignStatus,
} from '@lfx-one/shared/constants';
import type {
  CampaignActDialogData,
  CampaignActDialogResult,
  CampaignActDialogState,
  CampaignBidChange,
  CampaignBidOutcome,
  CampaignBudgetChange,
  CampaignBudgetOutcome,
  CampaignPlatform,
  CampaignServiceCampaign,
  CampaignServiceCampaignRef,
  CampaignToggleAction,
} from '@lfx-one/shared/interfaces';
import { readCampaignRefResolution } from '@lfx-one/shared/utils';
import { CampaignService } from '@services/campaign.service';
import { campaignBidFailureOutcome } from '@shared/utils/campaign-bid-error.utils';
import { campaignBudgetFailureOutcome } from '@shared/utils/campaign-budget-error.utils';
import { campaignActResolveErrorMessage } from '@shared/utils/campaign-optimize-error.utils';
import { classifyCampaignWriteFailure } from '@shared/utils/campaign-write-error.utils';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { take } from 'rxjs';

import { CampaignBidFormComponent } from '../campaign-bid-form/campaign-bid-form.component';
import { CampaignBudgetFormComponent } from '../campaign-budget-form/campaign-budget-form.component';

/**
 * Act on a Monitor row's campaign (lfx-self-serve#3299), opened with `DialogService.open()`.
 *
 * A Monitor row carries the PLATFORM's campaign id, while every lever is keyed by campaign-service's
 * campaign UUID under its brief. So the dialog first resolves the id through campaign-ref:
 *
 * - **one match** reads that campaign's row from campaign-service (its status and CURRENT ETag) and
 *   shows the same lever controls the Optimize tab uses — the toggle, `lfx-campaign-budget-form`
 *   or `lfx-campaign-bid-form`;
 * - **no match** says LFX One does not manage it and offers to adopt it (closes with `{ adopt: true }`);
 * - **several matches** refuses: picking one would change a campaign nobody named.
 *
 * Writes follow the Optimize tab's rules: `If-Match` from the row just read, the fresh ETag kept for
 * the next write, one write at a time, a 412 blocks further writes until the row is reloaded, and
 * nothing is retried automatically. Writes use `take(1)`, not the dialog's lifetime, so closing the
 * dialog never aborts a change in flight; its outcome still reaches the toast.
 */
@Component({
  selector: 'lfx-campaign-act-dialog',
  imports: [ButtonComponent, CampaignBidFormComponent, CampaignBudgetFormComponent],
  templateUrl: './campaign-act-dialog.component.html',
  styleUrl: './campaign-act-dialog.component.scss',
})
export class CampaignActDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly dialogConfig = inject(DynamicDialogConfig<CampaignActDialogData>);
  private readonly campaignService = inject(CampaignService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly data = this.dialogConfig.data as CampaignActDialogData;

  protected readonly state = signal<CampaignActDialogState>('resolving');
  /** The refusal or failure shown for `resolve-failed` and `record-failed`. */
  protected readonly failureMessage = signal('');
  protected readonly matchCount = signal(0);
  protected readonly record = signal<CampaignServiceCampaign | null>(null);
  protected readonly statusToggleEnabled = signal(false);
  /** A write is in flight; every lever waits for it, since all of them need the same ETag. */
  protected readonly pending = signal(false);
  /** A 412 proved the ETag stale: no write is sent until the row is reloaded. */
  protected readonly conflicted = signal(false);
  protected readonly toggleOutcome = signal<CampaignBudgetOutcome | null>(null);
  protected readonly budgetOutcome = signal<CampaignBudgetOutcome | null>(null);
  protected readonly bidOutcome = signal<CampaignBidOutcome | null>(null);
  protected readonly confirmedBudget = signal<CampaignBudgetChange | null>(null);
  protected readonly confirmedBid = signal<CampaignBidChange | null>(null);

  protected readonly unownedMessage = CAMPAIGN_ACT_UNOWNED_MESSAGE;
  protected readonly ambiguousMessage = CAMPAIGN_ACT_AMBIGUOUS_MESSAGE;
  protected readonly platformLabel = CAMPAIGN_PLATFORMS.find((p) => p.id === this.data.platform)?.label ?? this.data.platform;

  /** The row's status, normalized once (the wire value is unvalidated). */
  protected readonly status: Signal<string> = computed(() => normalizeCampaignStatus(this.record()?.status ?? ''));
  protected readonly toggleAction: Signal<CampaignToggleAction> = this.initToggleAction();
  protected readonly toggleLabel = computed(() => CAMPAIGN_TOGGLE_LABELS[this.toggleAction()]);
  protected readonly toggleUnavailableReason: Signal<string> = this.initToggleUnavailableReason();
  /** Notes stated before a Resume: adopted campaigns are refused, and Meta keeps a deliberately paused ad set paused. */
  protected readonly resumeNotes: Signal<string[]> = computed(() => {
    if (this.toggleAction() !== 'resume') {
      return [];
    }
    return this.data.platform === 'meta-ads' ? [CAMPAIGN_ACT_RESUME_ADOPTED_NOTE, CAMPAIGN_ACT_META_RESUME_NOTE] : [CAMPAIGN_ACT_RESUME_ADOPTED_NOTE];
  });
  protected readonly budgetUnavailableReason: Signal<string> = computed(() =>
    this.leverUnavailableReason(
      BUDGET_WRITABLE_CAMPAIGN_PLATFORMS,
      CAMPAIGN_BUDGET_UNAVAILABLE_PLATFORM_REASON,
      CAMPAIGN_BUDGET_UNAVAILABLE_UNPROVISIONED_REASON
    )
  );
  protected readonly bidUnavailableReason: Signal<string> = computed(() =>
    this.leverUnavailableReason(BID_WRITABLE_CAMPAIGN_PLATFORMS, CAMPAIGN_BID_UNAVAILABLE_PLATFORM_REASON, CAMPAIGN_BID_UNAVAILABLE_UNPROVISIONED_REASON)
  );
  protected readonly budgetBlockedReason = computed(() => this.blockedReason(CAMPAIGN_BUDGET_BLOCKED_STALE_REASON, CAMPAIGN_BUDGET_BLOCKED_TOGGLE_REASON));
  protected readonly bidBlockedReason = computed(() => this.blockedReason(CAMPAIGN_BID_BLOCKED_STALE_REASON, CAMPAIGN_BID_BLOCKED_BUSY_REASON));

  private match: CampaignServiceCampaignRef | null = null;

  public constructor() {
    this.resolve();
  }

  /** Re-runs the lookup after a failed one. */
  protected resolve(): void {
    this.state.set('resolving');
    this.campaignService
      .resolvePlatformCampaign(this.data.projectSlug, this.data.platform, this.data.platformCampaignId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resolution) => {
          // One shared reading with the adopt check: a self-contradicting answer is never acted on.
          const verdict = readCampaignRefResolution(resolution, this.data.platformCampaignId);
          switch (verdict.kind) {
            case 'unexpected':
              this.failureMessage.set(CAMPAIGN_ACT_RESOLVE_UNEXPECTED_MESSAGE);
              this.state.set('resolve-failed');
              return;
            case 'none':
              this.matchCount.set(0);
              this.state.set('unowned');
              return;
            case 'several':
              this.matchCount.set(verdict.count);
              this.state.set('ambiguous');
              return;
            case 'one':
              this.matchCount.set(1);
              this.match = verdict.match;
              this.loadRecord();
              return;
          }
        },
        error: (error: unknown) => {
          this.failureMessage.set(campaignActResolveErrorMessage(error));
          this.state.set('resolve-failed');
        },
      });
  }

  /** Reads the matched campaign's row: its status and the ETag the next write must send. Also clears a 412. */
  protected loadRecord(): void {
    const match = this.match;
    if (!match || this.pending()) {
      return;
    }
    this.state.set('loading-record');
    this.campaignService
      .getCampaignRecord(this.data.projectSlug, match.brief_id, match.campaign_id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.record.set(result.campaign);
          this.statusToggleEnabled.set(result.statusToggleEnabled === true);
          this.conflicted.set(false);
          this.toggleOutcome.set(null);
          this.budgetOutcome.set(null);
          this.bidOutcome.set(null);
          this.state.set('ready');
        },
        error: () => {
          this.failureMessage.set(CAMPAIGN_ACT_RECORD_FAILED_MESSAGE);
          this.state.set('record-failed');
        },
      });
  }

  protected adopt(): void {
    const result: CampaignActDialogResult = { adopt: true };
    this.dialogRef.close(result);
  }

  protected close(): void {
    this.dialogRef.close();
  }

  /** Pause or resume the campaign, in the direction its row status offers. */
  protected toggle(): void {
    const campaign = this.record();
    const action = this.toggleAction();
    if (!campaign || this.pending() || this.conflicted() || action === 'unavailable') {
      return;
    }
    const etag = this.etagOrRefuse((message) => this.toggleOutcome.set({ state: 'failed', message }));
    if (etag === null) {
      return;
    }

    this.pending.set(true);
    this.toggleOutcome.set(null);
    const name = campaign.campaign_name;
    this.campaignService
      .updateCampaignStatus({
        projectSlug: this.data.projectSlug,
        briefId: campaign.brief_id,
        campaignId: campaign.id,
        platform: campaign.platform as CampaignPlatform,
        status: action === 'pause' ? 'PAUSED' : 'ACTIVE',
        etag,
      })
      .pipe(take(1))
      .subscribe({
        next: (result) => {
          this.pending.set(false);
          const reported = result.serviceStatus ?? result.newStatus;
          this.record.update((r) => (r ? { ...r, status: reported, etag: result.etag ?? r.etag } : r));
          this.messageService.add({
            severity: 'success',
            summary: `${CAMPAIGN_TOGGLE_DONE_VERBS[action]} ${name}`,
            detail: `Campaign status is now ${normalizeCampaignStatus(reported)}.`,
            life: 5000,
          });
        },
        error: (error: unknown) => {
          this.pending.set(false);
          // A definite refusal keeps campaign-service's own sentence: it is what says an adopted
          // campaign cannot be activated, or that a Meta ad set paused on purpose is running again.
          const outcome = classifyCampaignWriteFailure(error, {
            conflict: CAMPAIGN_ETAG_STALE_MESSAGE,
            unconfirmed: CAMPAIGN_TOGGLE_UNCONFIRMED_MESSAGES[action],
            failureFallback: CAMPAIGN_TOGGLE_FAILURE_MESSAGES[action],
          });
          this.recordFailure(outcome, this.toggleOutcome, name, `${CAMPAIGN_TOGGLE_LABELS[action]} failed`);
        },
      });
  }

  protected changeBudget(change: CampaignBudgetChange): void {
    const campaign = this.record();
    if (!campaign || this.pending() || this.conflicted() || this.budgetUnavailableReason() !== '') {
      return;
    }
    const etag = this.etagOrRefuse((message) => this.budgetOutcome.set({ state: 'failed', message }));
    if (etag === null) {
      return;
    }

    this.pending.set(true);
    this.budgetOutcome.set(null);
    const name = campaign.campaign_name;
    this.campaignService
      .updateCampaignBudget({
        projectSlug: this.data.projectSlug,
        briefId: campaign.brief_id,
        campaignId: campaign.id,
        budget: change.budget,
        budgetType: change.budgetType,
        etag,
      })
      .pipe(take(1))
      .subscribe({
        next: (result) => {
          this.pending.set(false);
          this.confirmedBudget.set({ budget: result.budget, budgetType: result.budgetType });
          this.record.update((r) => (r ? { ...r, etag: result.etag ?? r.etag } : r));
          this.messageService.add({
            severity: 'success',
            summary: `Budget changed for ${name}`,
            detail: `New ${result.budgetType} budget: ${result.budget} in the ad account's currency.`,
            life: 5000,
          });
        },
        error: (error: unknown) => {
          this.pending.set(false);
          this.recordFailure(campaignBudgetFailureOutcome(error), this.budgetOutcome, name, 'Budget not changed');
        },
      });
  }

  protected changeBid(change: CampaignBidChange): void {
    const campaign = this.record();
    if (!campaign || this.pending() || this.conflicted() || this.bidUnavailableReason() !== '') {
      return;
    }
    const etag = this.etagOrRefuse((message) => this.bidOutcome.set({ state: 'failed', message }));
    if (etag === null) {
      return;
    }

    this.pending.set(true);
    this.bidOutcome.set(null);
    const name = campaign.campaign_name;
    this.campaignService
      .updateCampaignBid({
        projectSlug: this.data.projectSlug,
        briefId: campaign.brief_id,
        campaignId: campaign.id,
        bid: change.bid,
        bidType: DEFAULT_CAMPAIGN_BID_TYPE,
        etag,
      })
      .pipe(take(1))
      .subscribe({
        next: (result) => {
          this.pending.set(false);
          this.confirmedBid.set({ bid: result.bid });
          this.record.update((r) => (r ? { ...r, etag: result.etag ?? r.etag } : r));
          this.messageService.add({
            severity: 'success',
            summary: `Bid changed for ${name}`,
            detail: `New max cost-per-click bid: ${result.bid} in the ad account's currency.`,
            life: 5000,
          });
        },
        error: (error: unknown) => {
          this.pending.set(false);
          this.recordFailure(campaignBidFailureOutcome(error), this.bidOutcome, name, 'Bid not changed');
        },
      });
  }

  /** The row's ETag, or `null` after reporting why no write can be sent without one (upstream 428). */
  private etagOrRefuse(report: (message: string) => void): string | null {
    const etag = this.record()?.etag ?? '';
    if (etag === '') {
      report(CAMPAIGN_ACT_NO_ETAG_MESSAGE);
      return null;
    }
    return etag;
  }

  /**
   * Shows a failed write on its lever and in a sticky toast. A 412 is restated as "reload" and blocks
   * every lever until `loadRecord` reads a fresh ETag; an unconfirmed outcome is a warning, because
   * the change may already be live.
   */
  private recordFailure(
    outcome: CampaignBudgetOutcome,
    target: { set: (value: CampaignBudgetOutcome | null) => void },
    campaignName: string,
    failedSummary: string
  ): void {
    if (outcome.state === 'conflict') {
      this.conflicted.set(true);
      target.set({ state: 'conflict', message: CAMPAIGN_ETAG_STALE_MESSAGE });
      this.messageService.add({ severity: 'error', summary: campaignName, detail: CAMPAIGN_ETAG_STALE_MESSAGE, sticky: true });
      return;
    }
    target.set(outcome);
    if (outcome.state === 'unconfirmed') {
      this.messageService.add({
        severity: 'warn',
        summary: `Not confirmed for ${campaignName}`,
        detail: `It may already be applied. ${outcome.message}`,
        sticky: true,
      });
      return;
    }
    this.messageService.add({ severity: 'error', summary: `${failedSummary}: ${campaignName}`, detail: outcome.message, sticky: true });
  }

  private blockedReason(stale: string, busy: string): string {
    if (this.conflicted()) {
      return stale;
    }
    return this.pending() ? busy : '';
  }

  private leverUnavailableReason(platforms: ReadonlySet<string>, platformReason: string, unprovisionedReason: string): string {
    const campaign = this.record();
    if (!campaign || !platforms.has(campaign.platform)) {
      return platformReason;
    }
    if (typeof campaign.platform_campaign_id !== 'string' || campaign.platform_campaign_id.trim() === '') {
      return unprovisionedReason;
    }
    return this.status() === 'deleted' ? CAMPAIGN_UNAVAILABLE_REASONS['deleted'] : '';
  }

  /** Deployment, then platform, then status: the Optimize tab's refusal order. */
  private initToggleAction(): Signal<CampaignToggleAction> {
    return computed(() => {
      const campaign = this.record();
      if (!campaign || !this.statusToggleEnabled() || !TOGGLEABLE_CAMPAIGN_PLATFORMS.has(campaign.platform)) {
        return 'unavailable';
      }
      return campaignToggleAction(this.status(), campaign.platform);
    });
  }

  private initToggleUnavailableReason(): Signal<string> {
    return computed(() => {
      if (this.toggleAction() !== 'unavailable') {
        return '';
      }
      const campaign = this.record();
      if (!this.statusToggleEnabled()) {
        return CAMPAIGN_UNAVAILABLE_DEPLOYMENT_REASON;
      }
      if (!campaign || !TOGGLEABLE_CAMPAIGN_PLATFORMS.has(campaign.platform)) {
        return CAMPAIGN_UNAVAILABLE_PLATFORM_REASON;
      }
      const status = this.status();
      return Object.prototype.hasOwnProperty.call(CAMPAIGN_UNAVAILABLE_REASONS, status)
        ? CAMPAIGN_UNAVAILABLE_REASONS[status]
        : CAMPAIGN_UNAVAILABLE_DEFAULT_REASON;
    });
  }
}
