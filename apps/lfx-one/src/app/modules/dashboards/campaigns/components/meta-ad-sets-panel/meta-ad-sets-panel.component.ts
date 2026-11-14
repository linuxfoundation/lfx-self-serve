// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, inject, input, output, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  LIVE_REGION_MOUNT_DELAY_MS,
  META_AD_SET_CLEAR_RECORD_LABEL,
  META_AD_SET_DELIBERATE_PAUSE_ADVICE,
  META_AD_SET_DELIBERATE_RESUME_ADVICE,
  META_AD_SET_RECORD_PAUSE_LABEL,
} from '@lfx-one/shared/constants';
import type {
  CampaignServiceMetaAdSets,
  MetaAdSetActionKind,
  MetaAdSetCampaignEligibility,
  MetaAdSetDisplayRow,
  MetaAdSetPanelRow,
  MetaAdSetPendingChange,
  MetaAdSetRecordCheck,
  MetaAdSetStatus,
  MetaAdSetToggleOutcome,
  MetaAdSetToggleRequest,
} from '@lfx-one/shared/interfaces';
import { metaAdSetCampaignEligibility, toMetaAdSetDisplayRow } from '@lfx-one/shared/utils';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import { CampaignService } from '@services/campaign.service';
import { extractErrorMessage } from '@shared/utils/http-error.utils';
import { catchError, EMPTY, map, of, switchMap } from 'rxjs';

import { MetaAdSetAdsComponent } from '../meta-ad-set-ads/meta-ad-set-ads.component';

/**
 * A Meta campaign's ad sets on the Optimize tab, with a pause/resume per ad set.
 *
 * Owns its READ (`GET /api/campaigns/:id/meta-ad-sets`) and re-reads whenever the parent bumps
 * `reloadToken`. The WRITE stays with the parent, as the budget and bid writes do: it needs the
 * campaign row's freshest validator, it bumps that validator, and it must hold off the row's other
 * writes while it is out — all state the parent already owns. This panel only asks for a change
 * (`toggleAdSet`) and renders the outcome the parent hands back; it never retries one.
 *
 * Every action is disabled while any change to the campaign is in flight (`pending`) or the parent
 * has a reason to block it (`blockedReason`: a stale or unknown validator, another write). Only the
 * button whose action is actually running carries the spinner and `aria-busy`.
 *
 * Each ad set also expands into a read-only Ads section (`lfx-meta-ad-set-ads`), mounted only while
 * expanded so its ads are read lazily, and re-read on the same `reloadToken`.
 */
@Component({
  selector: 'lfx-meta-ad-sets-panel',
  imports: [ButtonComponent, DatePipe, MetaAdSetAdsComponent, TagComponent],
  templateUrl: './meta-ad-sets-panel.component.html',
  styleUrl: './meta-ad-sets-panel.component.scss',
})
export class MetaAdSetsPanelComponent {
  private readonly campaignService = inject(CampaignService);

  public readonly projectSlug = input.required<string>();
  public readonly briefId = input.required<string>();
  public readonly campaignId = input.required<string>();
  public readonly campaignName = input.required<string>();
  /** The ad-set change in flight on this campaign (which ad set, which action), or `null`. */
  public readonly pending = input<MetaAdSetPendingChange | null>(null);
  /** Why no ad set can be changed right now, or `''`. */
  public readonly blockedReason = input('');
  /** How the campaign's last ad-set change ended, or `null`. */
  public readonly outcome = input<MetaAdSetToggleOutcome | null>(null);
  /** Bumped by the parent after every change, confirmed or not, to re-read the ad sets. */
  public readonly reloadToken = input(0);
  /**
   * Which directions the CAMPAIGN's state allows (`metaAdSetCampaignEligibility`, from the Optimize
   * row). Defaults to refusing both, so a caller that forgets it fails closed; the read stays available.
   */
  public readonly eligibility = input<MetaAdSetCampaignEligibility>(metaAdSetCampaignEligibility(undefined));

  public readonly toggleAdSet = output<MetaAdSetToggleRequest>();
  public readonly closePanel = output<void>();

  protected readonly state = signal<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  protected readonly data = signal<CampaignServiceMetaAdSets | null>(null);
  protected readonly errorMessage = signal('');
  /** Bumped by the in-panel Retry; combined with the parent's reloadToken. */
  protected readonly retryToken = signal(0);
  /**
   * The `reloadToken` the last COMPLETED read was made for, and whether it succeeded. The follow-up
   * check reads this, so it decides only from the re-read for the change it follows, never from
   * the list that was on screen before it.
   */
  protected readonly lastRead = signal<{ token: number; ok: boolean } | null>(null);
  /** The ad sets whose Ads section is expanded. */
  protected readonly expandedAdSets = signal<ReadonlySet<string>>(new Set());

  protected readonly rows: Signal<MetaAdSetPanelRow[]> = this.initRows();
  /** Whether no action may be pressed right now. */
  protected readonly locked: Signal<boolean> = computed(() => this.pending() !== null || this.blockedReason() !== '' || this.state() === 'loading');
  /** The outcome's own tone, as a class string, so the template does not branch three ways. */
  protected readonly outcomeClass: Signal<string> = computed(() => {
    const state = this.outcome()?.state;
    if (state === 'applied' || state === 'already') {
      return 'text-emerald-700';
    }
    return state === 'failed' ? 'text-red-600' : 'text-amber-700';
  });
  /** After an unconfirmed change to the created ad set: what its re-read shows for `deliberately_paused`. */
  protected readonly recordCheck: Signal<MetaAdSetRecordCheck | null> = this.initRecordCheck();
  /** The check as the panel words it: campaign-service's advice for the direction, and the verdict. */
  protected readonly recordCheckView: Signal<{ advice: string; text: string; tone: string } | null> = this.initRecordCheckView();

  /**
   * Set LIVE_REGION_MOUNT_DELAY_MS after this component's first render, so the live region below
   * exists, EMPTY, before any loading text reaches it. A role="status" element inserted with its text already
   * present is not reliably announced — the parent mounts this panel conditionally, and the old
   * loading block was itself inserted pre-filled — so the region is persistent and only its
   * contents change, as the monitoring tab's own read-status region does.
   */
  private readonly liveRegionMounted = signal(false);
  /** What the persistent live region says: the read in flight, and nothing otherwise. */
  protected readonly loadingAnnouncement: Signal<string> = computed(() => (this.liveRegionMounted() && this.state() === 'loading' ? 'Loading ad sets' : ''));

  public constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      // Deferred past this render's own task, so the region is in the DOM, empty, before its text.
      const handle = setTimeout(() => this.liveRegionMounted.set(true), LIVE_REGION_MOUNT_DELAY_MS);
      destroyRef.onDestroy(() => clearTimeout(handle));
    });
    this.initLoad();
  }

  protected toggle(row: MetaAdSetPanelRow): void {
    if (this.locked() || row.action === null || row.actionBlockedReason !== '') {
      return;
    }
    this.request(row, row.action, 'toggle');
  }

  /**
   * "Pause again (record)" / "Resume again (clear record)": re-sends the status Meta already reports
   * so campaign-service records or clears the deliberate pause (`ALREADY_IN_STATE`, nothing else
   * changes on Meta). Asked of the parent like any other change: same If-Match, lock and no retry.
   */
  protected recordAction(row: MetaAdSetPanelRow): void {
    if (this.locked() || row.recordAction === null || row.recordActionBlockedReason !== '') {
      return;
    }
    this.request(row, row.recordAction, 'record');
  }

  /** Expands or collapses one ad set's read-only Ads section; expanding mounts it, which reads its ads. */
  protected toggleAds(adSetId: string): void {
    this.expandedAdSets.update((current) => {
      const next = new Set(current);
      if (!next.delete(adSetId)) {
        next.add(adSetId);
      }
      return next;
    });
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
        switchMap(({ projectSlug, briefId, campaignId, reload }) => {
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
            map((data) => ({ data, error: '', reload })),
            catchError((err: unknown) => of({ data: null, error: extractErrorMessage(err, "This campaign's ad sets could not be read from Meta."), reload }))
          );
        }),
        takeUntilDestroyed()
      )
      .subscribe(({ data, error, reload }) => {
        this.data.set(data);
        this.errorMessage.set(error);
        this.state.set(data !== null ? 'loaded' : 'error');
        this.lastRead.set({ token: reload, ok: data !== null });
        if (data !== null) {
          this.pruneExpandedAdSets(data);
        }
      });
  }

  private initRows(): Signal<MetaAdSetPanelRow[]> {
    return computed(() => {
      const data = this.data();
      if (data === null) {
        return [];
      }
      const currency = typeof data.currency === 'string' ? data.currency : '';
      const eligibility = this.eligibility();
      const stateNoteId = `meta-ad-sets-campaign-state-${this.campaignId()}`;
      const blockedNoteId = this.blockedReason() !== '' ? `meta-ad-sets-blocked-${this.campaignId()}` : null;
      const expanded = this.expandedAdSets();
      return (Array.isArray(data.ad_sets) ? data.ad_sets : []).map((adSet) => {
        const row = toMetaAdSetDisplayRow(adSet, currency, eligibility);
        // The campaign-state reason first: it is why THIS action is refused; else the row-wide block.
        return {
          ...row,
          actionDescribedBy: row.actionBlockedReason !== '' ? stateNoteId : blockedNoteId,
          recordActionDescribedBy: row.recordActionBlockedReason !== '' ? stateNoteId : blockedNoteId,
          adsExpanded: expanded.has(adSet.id),
        };
      });
    });
  }

  /**
   * Run after ANY unconfirmed change (status unconfirmed, or only its record), in the direction
   * requested: after a PAUSE the record should be `true`, after a RESUME `false`. Decided only from
   * the re-read made for the current `reloadToken`; a read that failed or does not list the ad set
   * is `missing`, never fine. An ad set this service did not create has no record: no check.
   */
  private initRecordCheck(): Signal<MetaAdSetRecordCheck | null> {
    return computed(() => {
      const outcome = this.outcome();
      if (outcome === null || outcome.state !== 'unconfirmed') {
        return null;
      }
      const direction = outcome.requestedStatus;
      const read = this.lastRead();
      if (read === null || read.token !== this.reloadToken()) {
        return { direction, state: 'pending', reason: null };
      }
      if (!read.ok) {
        return { direction, state: 'missing', reason: 'read-failed' };
      }
      const adSet = this.data()?.ad_sets?.find((candidate) => candidate.id === outcome.adSetId);
      if (adSet === undefined) {
        return { direction, state: 'missing', reason: 'absent' };
      }
      if (adSet.recorded !== true) {
        return null;
      }
      // Three-valued, as `toMetaAdSetDisplayRow` reads it: only an explicit true or false is evidence.
      const recorded: unknown = adSet.deliberately_paused;
      if (recorded !== true && recorded !== false) {
        return { direction, state: 'unknown', reason: null };
      }
      const expected = direction === 'PAUSED';
      return recorded === expected ? { direction, state: 'confirmed', reason: null } : { direction, state: 'missing', reason: 'not-shown' };
    });
  }

  private initRecordCheckView(): Signal<{ advice: string; text: string; tone: string } | null> {
    return computed(() => {
      const check = this.recordCheck();
      const name = this.outcome()?.adSetName ?? '';
      if (check === null) {
        return null;
      }
      const paused = check.direction === 'PAUSED';
      const advice = paused ? META_AD_SET_DELIBERATE_PAUSE_ADVICE : META_AD_SET_DELIBERATE_RESUME_ADVICE;
      const fix = paused ? META_AD_SET_RECORD_PAUSE_LABEL : `Resume (or ${META_AD_SET_CLEAR_RECORD_LABEL})`;
      if (check.state === 'pending') {
        return { advice, text: 'Re-reading the ad sets to check Deliberately paused…', tone: 'text-gray-500' };
      }
      if (check.state === 'unknown') {
        return {
          advice,
          text: `The re-read does not say whether ${name}'s deliberate pause is recorded. Check Deliberately paused again before resuming the campaign.`,
          tone: 'text-gray-600',
        };
      }
      if (check.state === 'confirmed') {
        const text = paused ? `The re-read shows ${name} as deliberately paused.` : `The re-read shows ${name}'s deliberate pause cleared.`;
        return { advice, text, tone: 'text-emerald-700' };
      }
      if (check.reason === 'read-failed') {
        return {
          advice,
          text: `The ad sets could not be re-read, so whether ${name}'s deliberate pause is recorded is unknown. Treat it as wrong: retry the read, then use ${fix} before resuming the campaign.`,
          tone: 'font-medium text-red-600',
        };
      }
      if (check.reason === 'absent') {
        return {
          advice,
          text: `The re-read does not list ${name}, so whether its deliberate pause is recorded is unknown. Check it in Meta Ads Manager before resuming the campaign.`,
          tone: 'font-medium text-red-600',
        };
      }
      const text = paused
        ? `The re-read does not show ${name} as deliberately paused. Use ${fix} before resuming the campaign.`
        : `The re-read still shows ${name} as deliberately paused. Use ${fix} before resuming the campaign, or it will stay paused.`;
      return { advice, text, tone: 'font-medium text-red-600' };
    });
  }

  /** Forgets an expansion whose ad set the latest read no longer lists, so it cannot reopen if the id returns. */
  private pruneExpandedAdSets(data: CampaignServiceMetaAdSets): void {
    const ids = new Set((Array.isArray(data.ad_sets) ? data.ad_sets : []).map((adSet) => adSet.id));
    this.expandedAdSets.update((current) => {
      const kept = [...current].filter((id) => ids.has(id));
      return kept.length === current.size ? current : new Set(kept);
    });
  }

  private request(row: MetaAdSetDisplayRow, status: MetaAdSetStatus, kind: MetaAdSetActionKind): void {
    this.toggleAdSet.emit({ adSetId: row.adSet.id, adSetName: row.name, status, kind });
  }
}
