// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DecimalPipe, PercentPipe } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, inject, input, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  CAMPAIGN_METRICS_WINDOW_LABELS,
  LIVE_REGION_MOUNT_DELAY_MS,
  META_AD_UNLISTED_NOTE,
  META_ADS_READ_FAILED_MESSAGE,
  META_ADS_TRUNCATED_NOTE,
} from '@lfx-one/shared/constants';
import type { CampaignServiceMetaAds, MetaAdDisplayRow } from '@lfx-one/shared/interfaces';
import { toMetaAdDisplayRow } from '@lfx-one/shared/utils';
import { ButtonComponent } from '@components/button/button.component';
import { CampaignService } from '@services/campaign.service';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { catchError, EMPTY, map, of, switchMap } from 'rxjs';

/**
 * The ads under ONE Meta ad set, inside the Optimize tab's ad-set panel. STRICTLY READ-ONLY: it
 * shows each ad's name, status, creative and delivery, and offers no per-ad lever.
 *
 * The panel mounts it only when its ad set is expanded, so the read (`GET
 * /api/campaigns/:id/meta-ad-sets/:adSetId/ads`) is lazy: one per expansion, then one per bump of
 * `reloadToken` (the panel's, after an ad-set change) or in-section Retry.
 */
@Component({
  selector: 'lfx-meta-ad-set-ads',
  imports: [ButtonComponent, DatePipe, DecimalPipe, PercentPipe],
  templateUrl: './meta-ad-set-ads.component.html',
  styleUrl: './meta-ad-set-ads.component.scss',
})
export class MetaAdSetAdsComponent {
  private readonly campaignService = inject(CampaignService);

  public readonly projectSlug = input.required<string>();
  public readonly briefId = input.required<string>();
  public readonly campaignId = input.required<string>();
  public readonly adSetId = input.required<string>();
  public readonly adSetName = input.required<string>();
  /** Bumped by the panel to re-read, as it re-reads the ad sets. */
  public readonly reloadToken = input(0);

  protected readonly truncatedNote = META_ADS_TRUNCATED_NOTE;
  protected readonly unlistedNote = META_AD_UNLISTED_NOTE;

  protected readonly state = signal<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  protected readonly data = signal<CampaignServiceMetaAds | null>(null);
  protected readonly errorMessage = signal('');
  /** Bumped by the in-section Retry; combined with the panel's reloadToken. */
  protected readonly retryToken = signal(0);
  /** Persistent and empty until after first render, so its text is announced (see the ad-set panel's region). */
  private readonly liveRegionMounted = signal(false);

  protected readonly rows: Signal<MetaAdDisplayRow[]> = this.initRows();
  /** The reporting window the counters cover, as the read names it ("Last 30 days"), or `''` before a read. */
  protected readonly windowLabel: Signal<string> = this.initWindowLabel();
  protected readonly loadingAnnouncement: Signal<string> = computed(() => (this.liveRegionMounted() && this.state() === 'loading' ? 'Loading ads' : ''));

  public constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const handle = setTimeout(() => this.liveRegionMounted.set(true), LIVE_REGION_MOUNT_DELAY_MS);
      destroyRef.onDestroy(() => clearTimeout(handle));
    });
    this.initLoad();
  }

  protected retry(): void {
    this.retryToken.update((n) => n + 1);
  }

  /** One read per (ad set, reload). `switchMap`, so a superseded read never lands over a newer one. */
  private initLoad(): void {
    toObservable(
      computed(() => ({
        projectSlug: this.projectSlug(),
        briefId: this.briefId(),
        campaignId: this.campaignId(),
        adSetId: this.adSetId(),
        reload: this.reloadToken(),
        retry: this.retryToken(),
      }))
    )
      .pipe(
        switchMap(({ projectSlug, briefId, campaignId, adSetId }) => {
          this.errorMessage.set('');
          if (projectSlug === '' || briefId === '' || campaignId === '' || adSetId === '') {
            this.data.set(null);
            this.state.set('idle');
            return EMPTY;
          }
          // The previous list stays on screen while it is re-read, as the ad-set list does.
          this.state.set('loading');
          return this.campaignService.listMetaAds(projectSlug, briefId, campaignId, adSetId).pipe(
            map((data) => ({ data, error: '' })),
            catchError((err: unknown) => of({ data: null, error: extractErrorMessage(err, META_ADS_READ_FAILED_MESSAGE) }))
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

  /** An unknown window is shown verbatim rather than hidden: the counters still cover it. */
  private initWindowLabel(): Signal<string> {
    return computed(() => {
      const window: unknown = this.data()?.window;
      if (typeof window !== 'string' || window === '') {
        return '';
      }
      return Object.hasOwn(CAMPAIGN_METRICS_WINDOW_LABELS, window)
        ? CAMPAIGN_METRICS_WINDOW_LABELS[window as keyof typeof CAMPAIGN_METRICS_WINDOW_LABELS]
        : window;
    });
  }

  private initRows(): Signal<MetaAdDisplayRow[]> {
    return computed(() => {
      const ads = this.data()?.ads;
      return Array.isArray(ads) ? ads.map(toMetaAdDisplayRow) : [];
    });
  }
}
