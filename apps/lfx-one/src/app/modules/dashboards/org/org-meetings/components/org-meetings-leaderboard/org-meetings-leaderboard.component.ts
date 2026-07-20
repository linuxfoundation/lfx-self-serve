// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { DEMO_ORG_LEADERBOARD, ORG_LEADERBOARD_PRIVATE_MEETING_LABEL, ORG_LEADERBOARD_VISIBLE_PILL_COUNT } from '@lfx-one/shared/constants';
import type {
  OrgLeaderboardDisplayRow,
  OrgLeaderboardMaskedValue,
  OrgLeaderboardPillGroup,
  OrgLeaderboardPillValue,
  OrgMeetingsTimeRange,
} from '@lfx-one/shared/interfaces';
import { slugify } from '@lfx-one/shared/utils';

import { CardComponent } from '@components/card/card.component';
import { PersonAvatarComponent } from '@components/person-avatar/person-avatar.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';

@Component({
  selector: 'lfx-org-meetings-leaderboard',
  imports: [CardComponent, TableComponent, PersonAvatarComponent, TagComponent],
  templateUrl: './org-meetings-leaderboard.component.html',
  styleUrl: './org-meetings-leaderboard.component.scss',
})
export class OrgMeetingsLeaderboardComponent {
  // Public fields from inputs
  public readonly timeRange = input.required<OrgMeetingsTimeRange>();

  // Complex computed via init function
  protected readonly rows: Signal<OrgLeaderboardDisplayRow[]> = this.initRows();

  private initRows(): Signal<OrgLeaderboardDisplayRow[]> {
    return computed(() =>
      DEMO_ORG_LEADERBOARD.map((row) => ({
        ...row,
        identitySlug: slugify(row.identity),
        foundationsGroup: this.toPillGroup(this.maskPrivateValues(row.foundationMeetings)),
        typeGroup: this.toPillGroup(this.maskPrivateValues(row.typeMeetings)),
        roleGroup: this.toPillGroup(this.maskPrivateValues(row.roleMeetings)),
      }))
    );
  }

  // A value's public meetings and private meetings render as separate chips — if an employee has
  // both a public and a private meeting for the same foundation, that foundation shows one chip
  // with its real name (for the public meetings) AND one "Private" chip (for the private ones).
  // Each distinct raw value keeps its own chip(s) even when masked, so e.g. six different
  // private-only foundations render as six separate "Private" chips, not one. Chips are sorted by
  // meeting count (descending) so the busiest lead and the "+N" overflow collapses the
  // least-attended values first.
  private maskPrivateValues(meetings: OrgLeaderboardMaskedValue[]): OrgLeaderboardPillValue[] {
    const publicCountByValue = new Map<string, number>();
    const privateCountByValue = new Map<string, number>();
    for (const meeting of meetings) {
      const counts = meeting.isPrivate ? privateCountByValue : publicCountByValue;
      counts.set(meeting.value, (counts.get(meeting.value) ?? 0) + 1);
    }

    const pills: (OrgLeaderboardPillValue & { count: number })[] = [];
    for (const [value, count] of publicCountByValue) {
      pills.push({ label: value, isPrivate: false, count });
    }
    for (const [, count] of privateCountByValue) {
      pills.push({ label: ORG_LEADERBOARD_PRIVATE_MEETING_LABEL, isPrivate: true, count });
    }

    return pills.sort((a, b) => b.count - a.count).map(({ label, isPrivate }) => ({ label, isPrivate }));
  }

  private toPillGroup(values: OrgLeaderboardPillValue[]): OrgLeaderboardPillGroup {
    return {
      visible: values.slice(0, ORG_LEADERBOARD_VISIBLE_PILL_COUNT),
      overflowCount: Math.max(0, values.length - ORG_LEADERBOARD_VISIBLE_PILL_COUNT),
      all: values,
    };
  }
}
