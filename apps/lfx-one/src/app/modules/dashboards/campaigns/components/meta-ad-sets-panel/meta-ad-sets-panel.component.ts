// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, output, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { META_AD_SET_DELIBERATE_PAUSE_ADVICE, META_AD_SET_RECORD_PAUSE_LABEL } from '@lfx-one/shared/constants';
import type {
  CampaignServiceMetaAdSets,
  MetaAdSetDisplayRow,
  MetaAdSetStatus,
  MetaAdSetToggleOutcome,
  MetaAdSetToggleRequest,
} from '@lfx-one/shared/interfaces';
import { toMetaAdSetDisplayRow } from '@lfx-one/shared/utils';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import { CampaignService } from '@services/campaign.service';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { catchError, EMPTY, map, of, switchMap } from 'rxjs';

/**
 * A Meta campaign's ad sets on the Optimize tab, with a pause/resume per ad set.
 *
 * Owns its READ (`GET /api/campaigns/:id/meta-ad-sets`) and re-reads whenever the parent bumps
 * `reloadToken`. The WRITE stays with the parent, as the budget and bid writes do: it needs the
 * campaign row's freshest validator, it bumps that validator, and it must hold off the row's other
 * writes while it is out — all state the parent already owns. This panel only asks for a change
 * (`toggleAdSet`) and renders the outcome the parent hands back; it never retries one.
 *
 * Every toggle is disabled while any change to the campaign is in flight (`pendingAdSetId`) or the
 * parent has a reason to block it (`blockedReason`: a stale validator, another write).
 */
@Component({
  selector: 'lfx-meta-ad-sets-panel',
  imports: [ButtonComponent, DatePipe, TagComponent],
  templateUrl: './meta-ad-sets-panel.component.html',
  styleUrl: './meta-ad-sets-panel.component.scss',
})
export class MetaAdSetsPanelComponent {
  private readonly campaignService = inject(CampaignService);

  public readonly projectSlug = input.required<string>();
  public readonly briefId = input.required<string>();
  public readonly campaignId = input.required<string>();
  public readonly campaignName = input.required<string>();
  /** The ad set whose status change is in flight on this campaign, or `null`. */
  public readonly pendingAdSetId = input<string | null>(null);
  /** Why no ad set can be changed right now, or `''`. */
  public readonly blockedReason = input('');
  /** How the campaign's last ad-set change ended, or `null`. */
  public readonly outcome = input<MetaAdSetToggleOutcome | null>(null);
  /** Bumped by the parent after every change, confirmed or not, to re-read the ad sets. */
  public readonly reloadToken = input(0);

  public readonly toggleAdSet = output<MetaAdSetToggleRequest>();
  public readonly closePanel = output<void>();

  protected readonly state = signal<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  protected readonly data = signal<CampaignServiceMetaAdSets | null>(null);
  protected readonly errorMessage = signal('');
  /** Bumped by the in-panel Retry; combined with the parent's reloadToken. */
  protected readonly retryToken = signal(0);

  protected readonly deliberatePauseAdvice = META_AD_SET_DELIBERATE_PAUSE_ADVICE;
  protected readonly recordPauseLabel = META_AD_SET_RECORD_PAUSE_LABEL;

  protected readonly rows: Signal<MetaAdSetDisplayRow[]> = this.initRows();
  /** Whether no toggle may be pressed right now. */
  protected readonly locked: Signal<boolean> = computed(() => this.pendingAdSetId() !== null || this.blockedReason() !== '' || this.state() === 'loading');
  /** The outcome's own tone, as a class string, so the template does not branch three ways. */
  protected readonly outcomeClass: Signal<string> = computed(() => {
    const state = this.outcome()?.state;
    if (state === 'applied' || state === 'already') {
      return 'text-emerald-700';
    }
    return state === 'failed' ? 'text-red-600' : 'text-amber-700';
  });
  /**
   * After a PAUSE whose outcome was unconfirmed: the campaign-service advice, and what the re-read
   * now shows for that ad set's `deliberately_paused` (`null` until the re-read lands, or when the
   * ad set is not the recorded one, whose pause is never recorded).
   */
  protected readonly pauseCheck: Signal<{ advice: boolean; shown: boolean | null }> = this.initPauseCheck();

  public constructor() {
    this.initLoad();
  }

  protected toggle(row: MetaAdSetDisplayRow): void {
    if (this.locked() || row.action === null) {
      return;
    }
    this.request(row, row.action);
  }

  /**
   * "Pause again (record)": re-sends PAUSED for the created ad set Meta already reports paused, so
   * campaign-service records the deliberate pause (`ALREADY_IN_STATE`, nothing activated). Asked of
   * the parent like any other change, so it carries the same If-Match, lock and no-retry rules.
   */
  protected recordPause(row: MetaAdSetDisplayRow): void {
    if (this.locked() || !row.recordPause) {
      return;
    }
    this.request(row, 'PAUSED');
  }

  protected retry(): void {
    this.retryToken.update((n) => n + 1);
  }

  /** One read per (campaign, reload). `switchMap`, so a superseded read never lands over a newer one. */
  private initLoad(): void {
    toObservable(
      computed(() => ({
        projectSlug: this.projectSlug(),
        briefId: this.briefId(),
        campaignId: this.campaignId(),
        reload: this.reloadToken(),
        retry: this.retryToken(),
      }))
    )
      .pipe(
        switchMap(({ projectSlug, briefId, campaignId }) => {
          this.errorMessage.set('');
          if (projectSlug === '' || briefId === '' || campaignId === '') {
            this.data.set(null);
            this.state.set('idle');
            return EMPTY;
          }
          // The previous list stays on screen while it is re-read, so a re-read after a change
          // does not blank the rows the operator is checking.
          this.state.set('loading');
          return this.campaignService.listMetaAdSets(projectSlug, briefId, campaignId).pipe(
            map((data) => ({ data, error: '' })),
            catchError((err: unknown) => of({ data: null, error: extractErrorMessage(err, "This campaign's ad sets could not be read from Meta.") }))
          );
        }),
        takeUntilDestroyed()
      )
      .subscribe(({ data, error }) => {
        this.data.set(data);
        this.errorMessage.set(error);
        this.state.set(data !== null ? 'loaded' : 'error');
      });
  }

  private initRows(): Signal<MetaAdSetDisplayRow[]> {
    return computed(() => {
      const data = this.data();
      if (data === null) {
        return [];
      }
      const currency = typeof data.currency === 'string' ? data.currency : '';
      return (Array.isArray(data.ad_sets) ? data.ad_sets : []).map((adSet) => toMetaAdSetDisplayRow(adSet, currency));
    });
  }

  private initPauseCheck(): Signal<{ advice: boolean; shown: boolean | null }> {
    return computed(() => {
      const outcome = this.outcome();
      if (outcome === null || outcome.state !== 'unconfirmed' || outcome.requestedStatus !== 'PAUSED') {
        return { advice: false, shown: null };
      }
      const adSet = this.data()?.ad_sets?.find((candidate) => candidate.id === outcome.adSetId);
      // Only the recorded ad set's pause is recorded: for any other the advice does not apply.
      if (adSet !== undefined && !adSet.recorded) {
        return { advice: false, shown: null };
      }
      const settled = this.state() === 'loaded' && adSet !== undefined;
      return { advice: true, shown: settled ? adSet.deliberately_paused === true : null };
    });
  }

  private request(row: MetaAdSetDisplayRow, status: MetaAdSetStatus): void {
    this.toggleAdSet.emit({ adSetId: row.adSet.id, adSetName: row.name, status });
  }
}
