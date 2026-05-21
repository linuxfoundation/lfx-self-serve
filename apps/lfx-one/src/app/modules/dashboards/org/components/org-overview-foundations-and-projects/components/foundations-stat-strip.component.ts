// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';

import type { MembershipTierClass, OrgLensFoundationsStatStrip } from '@lfx-one/shared/interfaces';

/**
 * Canonical 13-class tier order. Used to order the foundations tile's
 * detail line. Zero-bucket entries are suppressed at render time.
 */
const TIER_ORDER: MembershipTierClass[] = [
  'Platinum',
  'Premier',
  'Founding',
  'Strategic',
  'Gold',
  'Steering',
  'Silver',
  'General',
  'Associate',
  'End User',
  'Academic',
  'Contributor',
  'Other',
];

/**
 * 4-tile stat strip presented above the foundations table:
 * - Foundations
 * - Projects (Leading / Contributing / Participating / Silent)
 * - Governance Roles (Board members / Committee members)
 * - Meetings This Week (Board / Technical / Marketing / WG / Other)
 *
 * Every colour resolves through `lfxColors`. Zero-bucket entries are
 * suppressed. When a tile's total is zero, the big number still renders
 * as `0` (so users see the truthful count, not a "data missing" hint);
 * only the detail line collapses to a single em-dash placeholder.
 */
@Component({
  selector: 'lfx-foundations-stat-strip',
  imports: [],
  templateUrl: './foundations-stat-strip.component.html',
})
export class FoundationsStatStripComponent {
  public readonly strip = input.required<OrgLensFoundationsStatStrip>();

  /**
   * Detail-line placeholder. Any empty `parts` array — every sub-bucket
   * of the tile is zero — collapses to a single em-dash so the tile
   * never renders a list of zeros.
   */
  private static readonly emptyDetail = '—';

  /**
   * Foundations tile — ordered by the canonical 13-class ladder, zero
   * suppressed. Design format: "Platinum (2), Gold (1), …".
   */
  protected readonly foundationsDetail = computed<string>(() => {
    const breakdown = this.strip().foundations.breakdown;
    const parts: string[] = [];
    for (const tier of TIER_ORDER) {
      const count = breakdown[tier];
      if (count && count > 0) {
        parts.push(`${tier} (${count})`);
      }
    }
    return parts.length > 0 ? parts.join(', ') : FoundationsStatStripComponent.emptyDetail;
  });

  /**
   * Projects tile — Leading / Contributing / Participating / Silent.
   * Design format: "Leading (3), Contributing (1), …".
   */
  protected readonly projectsDetail = computed<string>(() => {
    const p = this.strip().projects;
    const parts: string[] = [];
    if (p.leading > 0) parts.push(`Leading (${p.leading})`);
    if (p.contributing > 0) parts.push(`Contributing (${p.contributing})`);
    if (p.participating > 0) parts.push(`Participating (${p.participating})`);
    if (p.silent > 0) parts.push(`Silent (${p.silent})`);
    return parts.length > 0 ? parts.join(', ') : FoundationsStatStripComponent.emptyDetail;
  });

  /**
   * Governance roles tile — design format:
   * "Board members (B)   Committee members (C)" (space-separated, plural
   * always, matching the `mfp-governance-sub` renderer in the design).
   */
  protected readonly governanceDetail = computed<string>(() => {
    const g = this.strip().governanceRoles;
    const parts: string[] = [];
    if (g.boardMembers > 0) parts.push(`Board members (${g.boardMembers})`);
    if (g.committeeMembers > 0) parts.push(`Committee members (${g.committeeMembers})`);
    return parts.length > 0 ? parts.join('\u00A0\u00A0\u00A0') : FoundationsStatStripComponent.emptyDetail;
  });

  /**
   * Meetings this week tile — 5-way category split. Design format:
   * "Board (3), Technical (6), Working Group (10), Other (5)".
   */
  protected readonly meetingsDetail = computed<string>(() => {
    const m = this.strip().meetingsThisWeek;
    const parts: string[] = [];
    if (m.board > 0) parts.push(`Board (${m.board})`);
    if (m.technical > 0) parts.push(`Technical (${m.technical})`);
    if (m.marketing > 0) parts.push(`Marketing (${m.marketing})`);
    if (m.workingGroup > 0) parts.push(`Working Group (${m.workingGroup})`);
    if (m.other > 0) parts.push(`Other (${m.other})`);
    return parts.length > 0 ? parts.join(', ') : FoundationsStatStripComponent.emptyDetail;
  });

  protected readonly foundationsTotal = computed(() => this.strip().foundations.total);
  protected readonly projectsTotal = computed(() => this.strip().projects.total);
  protected readonly governanceTotal = computed(() => this.strip().governanceRoles.total);
  protected readonly meetingsTotal = computed(() => this.strip().meetingsThisWeek.total);
}
