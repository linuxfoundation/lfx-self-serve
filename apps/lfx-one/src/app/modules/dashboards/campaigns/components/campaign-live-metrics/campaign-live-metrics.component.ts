// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, linkedSignal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import type { BriefMetricsRow, CampaignLiveMetricsState } from '@lfx-one/shared/interfaces';
import { buildCampaignLiveCounters } from '@lfx-one/shared/utils';
import { AdsPctPipe } from '@pipes/campaign-optimization.pipe';
import { CampaignService } from '@services/campaign.service';
import { campaignLiveMetricsFailureState } from '@shared/utils/campaign-optimize-error.utils';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

/**
 * One Optimize-tab campaign row's live counters — impressions (opens on the email channel), clicks,
 * cost and CTR — from campaign-service (lfx-self-serve#3299).
 *
 * The counters come FIRST from the brief-wide read the tab already makes on open (`briefRow`): an
 * `ok` row's `metrics` is the same measurement `get-campaign-metrics` returns, so it is shown with no
 * call of its own. This row's own `get-campaign-metrics` read fires only when the operator asks —
 * Refresh on a shown row, or a click on a row the brief-wide read could not measure, whose answer
 * carries the precise reason (a 400 for an unsupported platform, a 409's own sentence). Each such
 * read reaches an ad platform whose rate budget is shared across foundations. A pure read: nothing
 * is written or cached.
 *
 * No window is sent, so campaign-service picks the platform's default (30 days, 7 on X Ads) and the
 * counters say which one they cover. Cost carries no currency symbol: the read names none.
 */
@Component({
  selector: 'lfx-campaign-live-metrics',
  imports: [AdsPctPipe, DecimalPipe],
  templateUrl: './campaign-live-metrics.component.html',
  styleUrl: './campaign-live-metrics.component.scss',
})
export class CampaignLiveMetricsComponent {
  private readonly campaignService = inject(CampaignService);

  public readonly projectSlug = input.required<string>();
  public readonly briefId = input.required<string>();
  public readonly campaignId = input.required<string>();
  public readonly campaignName = input('');
  /** The row's platform token; `hubspot` (the email channel) reads its first counter as opens. */
  public readonly platform = input('');
  /** This campaign's row in the tab's brief-wide metrics read, or `null` when there is none (yet). */
  public readonly briefRow = input<BriefMetricsRow | null>(null);

  /** Whether the row is addressable at all: the route refuses an empty project or brief. */
  protected readonly canRead: Signal<boolean> = computed(() => this.projectSlug() !== '' && this.briefId() !== '');

  /**
   * How many times the operator has asked THIS campaign for its own read; 0 means never. Reset to 0
   * whenever the project, brief or campaign changes, so moving to another campaign and back does not
   * replay a request nobody made for the campaign now shown.
   */
  private readonly attempts = linkedSignal<string, number>({
    source: () => JSON.stringify([this.projectSlug(), this.briefId(), this.campaignId()]),
    computation: () => 0,
  });

  private readonly ownRead: Signal<CampaignLiveMetricsState> = this.initOwnRead();
  protected readonly state: Signal<CampaignLiveMetricsState> = this.initState();
  protected readonly buttonLabel: Signal<string> = this.initButtonLabel();
  /** The brief-wide read's reason for a row it could not measure, shown until the operator asks. */
  protected readonly briefReason: Signal<string> = this.initBriefReason();

  /** Reads (or re-reads) this row's counters. Ignored while a read is in flight or the row is not addressable. */
  public load(): void {
    if (!this.canRead() || this.state().status === 'loading') {
      return;
    }
    this.attempts.update((n) => n + 1);
  }

  /**
   * This row's own reads, one per request. `switchMap` drops an answer the operator has moved past
   * (another campaign in this slot), so a slow read cannot paint over the current one.
   */
  private initOwnRead(): Signal<CampaignLiveMetricsState> {
    const idle: CampaignLiveMetricsState = { status: 'idle', counters: null, message: '' };
    const request = computed(() => ({
      projectSlug: this.projectSlug(),
      briefId: this.briefId(),
      campaignId: this.campaignId(),
      attempt: this.attempts(),
    }));
    return toSignal(
      toObservable(request).pipe(
        switchMap((target) => {
          if (target.attempt === 0) {
            return of(idle);
          }
          return this.campaignService.getCampaignMetrics(target.projectSlug, target.briefId, target.campaignId).pipe(
            map((metrics): CampaignLiveMetricsState => ({ status: 'ready', counters: buildCampaignLiveCounters(metrics, this.platform()), message: '' })),
            catchError((error: unknown) => of(campaignLiveMetricsFailureState(error))),
            startWith<CampaignLiveMetricsState>({ status: 'loading', counters: null, message: '' })
          );
        })
      ),
      { initialValue: idle }
    );
  }

  /** The row's own read once asked for; until then, the brief-wide row's measurement when it has one. */
  private initState(): Signal<CampaignLiveMetricsState> {
    return computed(() => {
      const own = this.ownRead();
      if (own.status !== 'idle') {
        return own;
      }
      const row = this.briefRow();
      if (row?.status === 'ok' && row.metrics) {
        return { status: 'ready', counters: buildCampaignLiveCounters(row.metrics, this.platform()), message: '' };
      }
      return own;
    });
  }

  /** The visible action word; the accessible name adds the campaign so rows can be told apart. */
  private initButtonLabel(): Signal<string> {
    return computed(() => {
      switch (this.state().status) {
        case 'ready':
          return 'Refresh live counters';
        case 'error':
          return 'Try again';
        default:
          return 'Live counters';
      }
    });
  }

  private initBriefReason(): Signal<string> {
    return computed(() => {
      const row = this.briefRow();
      return this.state().status === 'idle' && row && row.status !== 'ok' ? (row.reason ?? '') : '';
    });
  }
}
