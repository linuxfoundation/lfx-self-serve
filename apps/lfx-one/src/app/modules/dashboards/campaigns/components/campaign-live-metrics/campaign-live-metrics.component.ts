// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, linkedSignal, Signal, untracked } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import type { BriefMetricsRow, CampaignLiveMetricsOwnRead, CampaignLiveMetricsState } from '@lfx-one/shared/interfaces';
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
 * counters say which one they cover. Cost carries no currency symbol; its label says USD on
 * LinkedIn (which reports `costInUsd`) and "ad account currency" elsewhere, where the read names none.
 *
 * Which answer is shown: an in-flight own read always (its spinner); then whichever SETTLED last of
 * the row's own read and the brief-wide row. A tab Refresh that lands after a row's Refresh therefore
 * replaces that row's counters (or error) with the fresh brief-wide ones, and asks nothing itself;
 * while the tab's read is reloading, or if it fails, the row keeps its own settled answer.
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

  /**
   * Bumped each time a NEW, non-null brief-wide row arrives (the input's identity changes — the tab's
   * Refresh replaces the whole brief-wide result). Clearing the input to `null` is NOT newer: the tab
   * does that at the start of every Refresh and leaves it there when the brief-wide read fails, and
   * neither is a measurement. An own read remembers the generation it settled against, so only a
   * brief-wide row that actually arrived after it outranks it.
   */
  private readonly briefGeneration = linkedSignal<BriefMetricsRow | null, number>({
    source: () => this.briefRow(),
    computation: (row, previous) => (previous?.value ?? 0) + (row === null ? 0 : 1),
  });

  private readonly ownRead: Signal<CampaignLiveMetricsOwnRead> = this.initOwnRead();
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
  private initOwnRead(): Signal<CampaignLiveMetricsOwnRead> {
    const idle: CampaignLiveMetricsOwnRead = { state: { status: 'idle', counters: null, message: '' }, generation: 0 };
    const request = computed(() => ({
      projectSlug: this.projectSlug(),
      briefId: this.briefId(),
      campaignId: this.campaignId(),
      attempt: this.attempts(),
    }));
    // The generation is read when the answer SETTLES, not when the request starts: a brief-wide row
    // that landed while this read was in flight is older than this answer and must not outrank it.
    const settled = (state: CampaignLiveMetricsState): CampaignLiveMetricsOwnRead => ({ state, generation: untracked(this.briefGeneration) });
    return toSignal(
      toObservable(request).pipe(
        switchMap((target) => {
          if (target.attempt === 0) {
            return of(idle);
          }
          return this.campaignService.getCampaignMetrics(target.projectSlug, target.briefId, target.campaignId).pipe(
            map((metrics) => settled({ status: 'ready', counters: buildCampaignLiveCounters(metrics, untracked(this.platform)), message: '' })),
            catchError((error: unknown) => of(settled(campaignLiveMetricsFailureState(error)))),
            startWith<CampaignLiveMetricsOwnRead>({ state: { status: 'loading', counters: null, message: '' }, generation: 0 })
          );
        })
      ),
      { initialValue: idle }
    );
  }

  /**
   * An in-flight own read wins; a settled one wins until a newer brief-wide row arrives; otherwise
   * the brief-wide row's measurement when it has one.
   */
  private initState(): Signal<CampaignLiveMetricsState> {
    const idle: CampaignLiveMetricsState = { status: 'idle', counters: null, message: '' };
    return computed(() => {
      const own = this.ownRead();
      if (own.state.status === 'loading') {
        return own.state;
      }
      if (own.state.status !== 'idle' && own.generation === this.briefGeneration()) {
        return own.state;
      }
      const row = this.briefRow();
      if (row?.status === 'ok' && row.metrics) {
        return { status: 'ready', counters: buildCampaignLiveCounters(row.metrics, this.platform()), message: '' };
      }
      return idle;
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
