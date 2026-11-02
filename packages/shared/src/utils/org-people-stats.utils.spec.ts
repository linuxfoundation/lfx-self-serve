// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { OrgAllEmployeeRow } from '../interfaces';
import { computeOrgAllEmployeeStats } from './org-people-stats.utils';

function row(personKey: string, over: Partial<OrgAllEmployeeRow> = {}): OrgAllEmployeeRow {
  return {
    personKey,
    lfid: null,
    lfUsername: null,
    cdpMemberId: null,
    name: personKey,
    firstName: null,
    lastName: null,
    title: null,
    email: null,
    avatarUrl: null,
    sources: ['snowflake'],
    seatsCount: 0,
    boardSeatsCount: 0,
    committeeSeatsCount: 0,
    commitsCount: 0,
    codeActivitiesCount: 0,
    eventsCount: 0,
    coursesCount: 0,
    engagedFoundationIds: [],
    ...over,
  };
}

describe('computeOrgAllEmployeeStats', () => {
  // lfx-self-serve#4160 — the code tile counts Code Contributors whatever count the table shows.
  it('counts people with any code contribution on the code tile, not only the ones with a commit', () => {
    const stats = computeOrgAllEmployeeStats([
      row('committer', { commitsCount: 3, codeActivitiesCount: 5 }),
      // Reviews only: the commits measure shows 0 for them, yet they are a code contributor.
      row('reviewer', { commitsCount: 0, codeActivitiesCount: 2 }),
      row('attendee', { eventsCount: 1 }),
    ]);

    expect(stats).toEqual({ activeInOss: 3, inGovernance: 0, codeContributors: 2, eventAttendees: 1, trainees: 0 });
  });
});
