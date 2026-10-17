// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import type { CampaignLiveMetricsState } from '@lfx-one/shared/interfaces';
import { buildCampaignLiveCounters } from '@lfx-one/shared/utils';
import { AdsPctPipe } from '@pipes/campaign-optimization.pipe';
import { CampaignService } from '@services/campaign.service';
import { campaignLiveMetricsFailureState } from '@shared/utils/campaign-optimize-error.utils';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

/**
 * One Optimize-tab campaign row's live counters — impressions, clicks, cost and CTR — read from the
 * campaign's platform through campaign-service's `get-campaign-metrics` (lfx-self-serve#3299).
 *
 * ON DEMAND: nothing is read until the operator asks, and only for this row. Every read reaches an
 * ad platform whose rate budget is shared across foundations, so the tab never fans out over its
 * rows. A pure read: nothing is written or cached, and every Refresh reads the platform again.
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

  /**
   * The operator's last request, tagged with the campaign it was made for. A request for another
   * project, brief or campaign is not this one's, so a changed input drops back to idle instead of
   * reading the new campaign unasked.
   */
  private readonly requested = signal<{ target: string; attempt: number } | null>(null);

  protected readonly state: Signal<CampaignLiveMetricsState> = this.initState();
  protected readonly buttonLabel: Signal<string> = this.initButtonLabel();

  /** Reads (or re-reads) this row's counters. Ignored while a read is in flight. */
  public load(): void {
    if (this.state().status === 'loading') {
      return;
    }
    this.requested.update((asked) => ({ target: this.targetKey(), attempt: (asked?.attempt ?? 0) + 1 }));
  }

  /**
   * One read per request. `switchMap` drops an answer the operator has moved past (another
   * campaign in this slot), so a slow read cannot paint over the current one.
   */
  private initState(): Signal<CampaignLiveMetricsState> {
    const idle: CampaignLiveMetricsState = { status: 'idle', counters: null, message: '' };
    const request = computed(() => {
      const asked = this.requested();
      if (!asked || asked.target !== this.targetKey()) {
        return null;
      }
      return { projectSlug: this.projectSlug(), briefId: this.briefId(), campaignId: this.campaignId(), attempt: asked.attempt };
    });
    return toSignal(
      toObservable(request).pipe(
        switchMap((target) => {
          if (!target) {
            return of(idle);
          }
          return this.campaignService.getCampaignMetrics(target.projectSlug, target.briefId, target.campaignId).pipe(
            map((metrics): CampaignLiveMetricsState => ({ status: 'ready', counters: buildCampaignLiveCounters(metrics), message: '' })),
            catchError((error: unknown) => of(campaignLiveMetricsFailureState(error))),
            startWith<CampaignLiveMetricsState>({ status: 'loading', counters: null, message: '' })
          );
        })
      ),
      { initialValue: idle }
    );
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

  private targetKey(): string {
    return JSON.stringify([this.projectSlug(), this.briefId(), this.campaignId()]);
  }
}
