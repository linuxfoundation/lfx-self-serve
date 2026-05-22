// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';

import { MEMBERSHIP_TIER_ORDER } from '@lfx-one/shared/constants';
import type { OrgLensFoundationsStatStrip } from '@lfx-one/shared/interfaces';

/** Foundations / Projects / Governance / Meetings stat strip; zero-bucket entries suppressed, single em-dash detail when a tile is fully zero. */
@Component({
  selector: 'lfx-foundations-stat-strip',
  imports: [],
  templateUrl: './foundations-stat-strip.component.html',
})
export class FoundationsStatStripComponent {
  public readonly strip = input.required<OrgLensFoundationsStatStrip>();

  private static readonly emptyDetail = '—';

  protected readonly foundationsTotal = computed(() => this.strip().foundations.total);
  protected readonly projectsTotal = computed(() => this.strip().projects.total);
  protected readonly governanceTotal = computed(() => this.strip().governanceRoles.total);
  protected readonly meetingsTotal = computed(() => this.strip().meetingsThisWeek.total);

  protected readonly foundationsDetail = computed<string>(() => this.initFoundationsDetail());
  protected readonly projectsDetail = computed<string>(() => this.initProjectsDetail());
  protected readonly governanceDetail = computed<string>(() => this.initGovernanceDetail());
  protected readonly meetingsDetail = computed<string>(() => this.initMeetingsDetail());

  private initFoundationsDetail(): string {
    const breakdown = this.strip().foundations.breakdown;
    const parts: string[] = [];
    for (const tier of MEMBERSHIP_TIER_ORDER) {
      const count = breakdown[tier];
      if (count && count > 0) {
        parts.push(`${tier} (${count})`);
      }
    }
    return parts.length > 0 ? parts.join(', ') : FoundationsStatStripComponent.emptyDetail;
  }

  private initProjectsDetail(): string {
    const p = this.strip().projects;
    const parts: string[] = [];
    if (p.leading > 0) parts.push(`Leading (${p.leading})`);
    if (p.contributing > 0) parts.push(`Contributing (${p.contributing})`);
    if (p.participating > 0) parts.push(`Participating (${p.participating})`);
    if (p.silent > 0) parts.push(`Silent (${p.silent})`);
    return parts.length > 0 ? parts.join(', ') : FoundationsStatStripComponent.emptyDetail;
  }

  private initGovernanceDetail(): string {
    const g = this.strip().governanceRoles;
    const parts: string[] = [];
    if (g.boardMembers > 0) parts.push(`Board members (${g.boardMembers})`);
    if (g.committeeMembers > 0) parts.push(`Committee members (${g.committeeMembers})`);
    return parts.length > 0 ? parts.join('\u00A0\u00A0\u00A0') : FoundationsStatStripComponent.emptyDetail;
  }

  private initMeetingsDetail(): string {
    const m = this.strip().meetingsThisWeek;
    const parts: string[] = [];
    if (m.board > 0) parts.push(`Board (${m.board})`);
    if (m.technical > 0) parts.push(`Technical (${m.technical})`);
    if (m.marketing > 0) parts.push(`Marketing (${m.marketing})`);
    if (m.workingGroup > 0) parts.push(`Working Group (${m.workingGroup})`);
    if (m.other > 0) parts.push(`Other (${m.other})`);
    return parts.length > 0 ? parts.join(', ') : FoundationsStatStripComponent.emptyDetail;
  }
}
