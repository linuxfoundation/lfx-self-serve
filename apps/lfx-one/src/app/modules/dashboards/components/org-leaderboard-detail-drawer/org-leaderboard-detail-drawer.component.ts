// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, model, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  ORG_LEADERBOARD_DETAIL_ECOSYSTEM_CATEGORIES,
  ORG_LEADERBOARD_DETAIL_METHODOLOGY,
  ORG_LEADERBOARD_DETAIL_TECHNICAL_CATEGORIES,
} from '@lfx-one/shared/constants';
import type {
  BlockState,
  LeaderboardDimension,
  OrgLeaderboardDetailBreakdown,
  OrgLeaderboardDetailCategoryRow,
  OrgLensLeaderboardTimeRange,
  OrgLensProjectBand,
} from '@lfx-one/shared/interfaces';
import { orgLeaderboardDetailCategoryRows } from '@lfx-one/shared/utils';
import { OrgLensProjectDetailService } from '@services/org-lens-project-detail.service';
import { DrawerModule } from 'primeng/drawer';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, combineLatest, map, Observable, of, startWith, switchMap } from 'rxjs';

/**
 * Score-breakdown drawer opened by clicking an Org Lens Project Detail leaderboard row: the clicked
 * organization's per-category points, counts, and shares for one influence dimension.
 *
 * The total score, the level, and the rank all come from the response rather than being derived here,
 * so the drawer cannot disagree with the board row that opened it. Categories the caller may not see
 * are absent from the response and rendered as name-only rows — this component has no copy of the
 * privacy rule to enforce, which is the point: the figures never reach the browser.
 */
@Component({
  selector: 'lfx-org-leaderboard-detail-drawer',
  imports: [DecimalPipe, DrawerModule, TooltipModule],
  templateUrl: './org-leaderboard-detail-drawer.component.html',
})
export class OrgLeaderboardDetailDrawerComponent {
  private readonly detailService = inject(OrgLensProjectDetailService);

  // === Public fields from inputs (readonly) ===
  public readonly dimension = input.required<LeaderboardDimension>();
  /** The clicked row's crowd.dev organization — what the breakdown is keyed by. */
  public readonly organizationId = input.required<string>();
  public readonly orgName = input.required<string>();
  public readonly projectName = input.required<string>();
  public readonly projectSlug = input.required<string>();
  /** The viewing organization, which the server uses to decide what it may serve. */
  public readonly orgUid = input.required<string>();
  public readonly range = input.required<OrgLensLeaderboardTimeRange>();

  // === Model signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Complex computed signals (via private init functions) ===
  protected readonly state: Signal<BlockState<OrgLeaderboardDetailBreakdown>> = this.initState();
  protected readonly breakdown: Signal<OrgLeaderboardDetailBreakdown | null> = computed(() => this.state().data);
  protected readonly subtitleLabel: Signal<string> = computed(() => (this.dimension() === 'technical' ? 'Technical Influence' : 'Ecosystem Influence'));
  /**
   * What the served activity share actually measures. The server reads one activity board per
   * dimension — contributions for technical, collaborations for ecosystem — so the share covers that
   * activity alone, not everything the dimension scores.
   */
  protected readonly activityShareLabel: Signal<string> = computed(() => (this.dimension() === 'technical' ? 'contribution' : 'collaboration'));
  protected readonly methodology = computed(() => ORG_LEADERBOARD_DETAIL_METHODOLOGY[this.dimension()]);
  protected readonly levelTextClass: Signal<string> = computed(() => {
    const band = this.breakdown()?.level.toLowerCase() as OrgLensProjectBand | undefined;
    const classByBand: Record<OrgLensProjectBand, string> = {
      leading: 'text-emerald-600',
      contributing: 'text-blue-600',
      participating: 'text-amber-600',
      silent: 'text-gray-600',
    };
    return band ? classByBand[band] : 'text-gray-600';
  });
  protected readonly categoryRows: Signal<OrgLeaderboardDetailCategoryRow[]> = this.initCategoryRows();

  // === Protected methods ===
  protected onClose(): void {
    this.visible.set(false);
  }

  // === Private initializer functions ===
  private initState(): Signal<BlockState<OrgLeaderboardDetailBreakdown>> {
    const requests$: Observable<BlockState<OrgLeaderboardDetailBreakdown>> = combineLatest([
      toObservable(this.visible),
      toObservable(this.orgUid),
      toObservable(this.projectSlug),
      toObservable(this.dimension),
      toObservable(this.organizationId),
      toObservable(this.range),
    ]).pipe(
      // Only fetch while open: a range change with the drawer closed should not spend a request, and
      // one made while open re-fetches so the drawer can never show figures from another range.
      // Closing discards the payload rather than merely pausing, so reopening on a different row
      // cannot render the previous organization's figures under the new row's name.
      switchMap(([visible, orgUid, projectSlug, dimension, organizationId, range]) => {
        if (!visible || !orgUid || !projectSlug || !organizationId) {
          return of<BlockState<OrgLeaderboardDetailBreakdown>>({ status: 'loading', data: null });
        }
        return this.detailService.getLeaderboardBreakdown(orgUid, projectSlug, dimension, organizationId, range).pipe(
          map((breakdown): BlockState<OrgLeaderboardDetailBreakdown> => ({ status: breakdown === null ? 'empty' : 'ready', data: breakdown })),
          catchError(() => of<BlockState<OrgLeaderboardDetailBreakdown>>({ status: 'error', data: null })),
          startWith<BlockState<OrgLeaderboardDetailBreakdown>>({ status: 'loading', data: null })
        );
      })
    );
    return toSignal(requests$, { initialValue: { status: 'loading', data: null } });
  }

  private initCategoryRows(): Signal<OrgLeaderboardDetailCategoryRow[]> {
    return computed(() => {
      const breakdown = this.breakdown();
      if (breakdown === null) return [];
      const categories = this.dimension() === 'technical' ? ORG_LEADERBOARD_DETAIL_TECHNICAL_CATEGORIES : ORG_LEADERBOARD_DETAIL_ECOSYSTEM_CATEGORIES;
      return orgLeaderboardDetailCategoryRows(categories, breakdown);
    });
  }
}
