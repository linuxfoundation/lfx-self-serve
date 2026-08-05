// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, input, model, Signal } from '@angular/core';
import {
  ORG_LEADERBOARD_DETAIL_ECOSYSTEM_CATEGORIES,
  ORG_LEADERBOARD_DETAIL_ECOSYSTEM_COMPANIES,
  ORG_LEADERBOARD_DETAIL_METHODOLOGY,
  ORG_LEADERBOARD_DETAIL_TECHNICAL_CATEGORIES,
  ORG_LEADERBOARD_DETAIL_TECHNICAL_COMPANIES,
} from '@lfx-one/shared/constants';
import type {
  LeaderboardDimension,
  OrgLeaderboardDetailCategoryRow,
  OrgLeaderboardDetailCompany,
  OrgLeaderboardDetailLevel,
  OrgLensProjectBand,
} from '@lfx-one/shared/interfaces';
import { orgLeaderboardDetailCategoryRows, orgLeaderboardDetailLevelFor } from '@lfx-one/shared/utils';
import { DrawerModule } from 'primeng/drawer';

/**
 * Score-breakdown drawer opened by clicking an Org Lens Project Detail leaderboard row (LFXV2-2934).
 * Category points/counts are DEMO/PLACEHOLDER data (see `org-leaderboard-detail-drawer.constants.ts`)
 * pending a real Snowflake-backed data source — the drawer renders a graceful empty state for any
 * org not present in the demo lookup, since the real leaderboards cover far more organizations.
 */
@Component({
  selector: 'lfx-org-leaderboard-detail-drawer',
  imports: [DecimalPipe, DrawerModule],
  templateUrl: './org-leaderboard-detail-drawer.component.html',
})
export class OrgLeaderboardDetailDrawerComponent {
  // === Public fields from inputs (readonly) ===
  public readonly dimension = input.required<LeaderboardDimension>();
  public readonly orgName = input.required<string>();
  public readonly projectName = input.required<string>();

  // === Model signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === Complex computed signals (via private init functions) ===
  protected readonly subtitleLabel: Signal<string> = computed(() => (this.dimension() === 'technical' ? 'Technical Influence' : 'Ecosystem Influence'));
  protected readonly methodology = computed(() => ORG_LEADERBOARD_DETAIL_METHODOLOGY[this.dimension()]);
  protected readonly company: Signal<OrgLeaderboardDetailCompany | null> = this.initCompany();
  protected readonly hasData: Signal<boolean> = computed(() => this.company() !== null);
  protected readonly totalCompanies: Signal<number> = this.initTotalCompanies();
  protected readonly level: Signal<OrgLeaderboardDetailLevel | null> = this.initLevel();
  protected readonly levelTextClass: Signal<string> = computed(() => {
    const band = this.level()?.toLowerCase() as OrgLensProjectBand | undefined;
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
  private initCompany(): Signal<OrgLeaderboardDetailCompany | null> {
    return computed(() => {
      const companies = this.dimension() === 'technical' ? ORG_LEADERBOARD_DETAIL_TECHNICAL_COMPANIES : ORG_LEADERBOARD_DETAIL_ECOSYSTEM_COMPANIES;
      return companies[this.orgName()] ?? null;
    });
  }

  private initTotalCompanies(): Signal<number> {
    return computed(() => {
      const companies = this.dimension() === 'technical' ? ORG_LEADERBOARD_DETAIL_TECHNICAL_COMPANIES : ORG_LEADERBOARD_DETAIL_ECOSYSTEM_COMPANIES;
      return Object.keys(companies).length;
    });
  }

  private initLevel(): Signal<OrgLeaderboardDetailLevel | null> {
    return computed(() => {
      const company = this.company();
      return company ? orgLeaderboardDetailLevelFor(this.dimension(), company.score) : null;
    });
  }

  private initCategoryRows(): Signal<OrgLeaderboardDetailCategoryRow[]> {
    return computed(() => {
      const company = this.company();
      if (!company) return [];
      const categories = this.dimension() === 'technical' ? ORG_LEADERBOARD_DETAIL_TECHNICAL_CATEGORIES : ORG_LEADERBOARD_DETAIL_ECOSYSTEM_CATEGORIES;
      return orgLeaderboardDetailCategoryRows(categories, company.points, company.counts, company.score);
    });
  }
}
