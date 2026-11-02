// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { ORG_TRAINEES_STAT_DEFINITIONS, ORG_TRAINING_NO_ROSTER_NOTE, ORG_TRAINING_STAT_DEFINITIONS } from '../constants/org-training-stats.constants';
import type { OrgTrainingStats, OrgTrainingStatTileVm } from '../interfaces/training.interface';
import { buildOrgTrainingStatTiles, formatOrgTrainingAsOf, orgTrainingStatCaption, orgTrainingStatTooltip } from './org-training-stats.utils';

describe('formatOrgTrainingAsOf', () => {
  it('states the UTC day, so a late-evening build does not show the next or previous day by viewer timezone', () => {
    expect(formatOrgTrainingAsOf('2026-11-02T23:59:59.000Z')).toContain('Nov 2, 2026');
    expect(formatOrgTrainingAsOf('2026-11-03T00:00:00.000Z')).toContain('Nov 3, 2026');
  });

  it('says the date is unavailable instead of inventing one', () => {
    for (const missing of [null, undefined, '', 'not-a-date']) {
      const text = formatOrgTrainingAsOf(missing);
      expect(text).not.toMatch(/\d{4}/);
      expect(text).toContain('unavailable');
    }
  });
});

describe('orgTrainingStatCaption / orgTrainingStatTooltip', () => {
  const asOf = '2026-11-02T09:48:21.094Z';

  it('states unit, the fixed window and the as-of date of every strip stat', () => {
    for (const stat of Object.values(ORG_TRAINING_STAT_DEFINITIONS)) {
      for (const text of [orgTrainingStatCaption(stat, asOf), orgTrainingStatTooltip(stat, asOf)]) {
        expect(text.toLowerCase()).toContain(stat.unit.toLowerCase());
        expect(text).toContain(stat.window as string);
        expect(text).toContain('Nov 2, 2026');
      }
    }
  });

  it('marks the in-progress stats as a snapshot and the cumulative ones as not', () => {
    const { peopleInTraining, trainingCoursesInProgress, peopleWithTrainingActivity, rosterMembers } = ORG_TRAINING_STAT_DEFINITIONS;
    expect(orgTrainingStatCaption(peopleInTraining, asOf)).toContain('snapshot');
    expect(orgTrainingStatCaption(trainingCoursesInProgress, asOf)).toContain('snapshot');
    expect(orgTrainingStatCaption(peopleWithTrainingActivity, asOf)).not.toContain('snapshot');
    expect(orgTrainingStatCaption(rosterMembers, asOf)).not.toContain('snapshot');
  });

  it('uses the surface window for Trainees stats, which have no fixed one', () => {
    for (const stat of Object.values(ORG_TRAINEES_STAT_DEFINITIONS)) {
      expect(orgTrainingStatCaption(stat, asOf, 'Past 2 years')).toContain('Past 2 years');
      expect(orgTrainingStatTooltip(stat, asOf, 'All time')).toContain('All time');
    }
  });

  it('labels Trainees people the same as the strip, so one definition carries one name', () => {
    expect(ORG_TRAINEES_STAT_DEFINITIONS.trainees.label).toBe(ORG_TRAINING_STAT_DEFINITIONS.peopleWithTrainingActivity.label);
  });
});

describe('buildOrgTrainingStatTiles', () => {
  const stats: OrgTrainingStats = {
    rosterMembers: 40,
    rosterMembersAsOf: '2026-10-29T23:00:00.000Z',
    peopleWithTrainingActivity: 12,
    trainingActivityAsOf: '2026-10-30T09:48:21.094Z',
    certifiedEmployees: 4,
    certificationsEarned: 6,
    employeesInTraining: 3,
    trainingCoursesEnrolled: 5,
    inProgressAsOf: '2026-11-01T10:15:00.000Z',
  };

  const byKey = (tiles: OrgTrainingStatTileVm[]): Record<string, OrgTrainingStatTileVm> => Object.fromEntries(tiles.map((tile) => [tile.key, tile]));

  it('shows each number with the as-of date of the table it comes from', () => {
    const tiles = byKey(buildOrgTrainingStatTiles(stats));

    expect(tiles['rosterMembers']).toMatchObject({ value: 40 });
    expect(tiles['rosterMembers'].caption).toContain('Oct 29, 2026');
    for (const key of ['peopleWithTrainingActivity', 'certifiedPeople', 'certificationsEarned']) {
      expect(tiles[key].caption).toContain('Oct 30, 2026');
    }
    expect(tiles['peopleWithTrainingActivity'].value).toBe(12);
    expect(tiles['certifiedPeople'].value).toBe(4);
    expect(tiles['certificationsEarned'].value).toBe(6);
    expect(tiles['peopleInTraining']).toMatchObject({ value: 3 });
    expect(tiles['trainingCoursesInProgress']).toMatchObject({ value: 5 });
    expect(tiles['peopleInTraining'].caption).toContain('Nov 1, 2026');
  });

  it('keeps the in-progress snapshot apart from the cumulative numbers', () => {
    const tiles = buildOrgTrainingStatTiles(stats);

    expect(tiles.map((tile) => [tile.key, tile.group])).toEqual([
      ['rosterMembers', 'cumulative'],
      ['peopleWithTrainingActivity', 'cumulative'],
      ['certifiedPeople', 'cumulative'],
      ['certificationsEarned', 'cumulative'],
      ['peopleInTraining', 'snapshot'],
      ['trainingCoursesInProgress', 'snapshot'],
    ]);
  });

  it('says the org has no training program instead of showing a roster of zero', () => {
    const tiles = byKey(buildOrgTrainingStatTiles({ ...stats, rosterMembers: null, rosterMembersAsOf: null }));

    expect(tiles['rosterMembers'].value).toBeNull();
    expect(tiles['rosterMembers'].caption).toBe(ORG_TRAINING_NO_ROSTER_NOTE);
    expect(tiles['peopleWithTrainingActivity'].value).toBe(12);
  });

  it('shows a training program with no members as zero', () => {
    expect(byKey(buildOrgTrainingStatTiles({ ...stats, rosterMembers: 0 }))['rosterMembers'].value).toBe(0);
  });

  it('has no numbers before the stats load, without claiming the org has no training program', () => {
    const tiles = buildOrgTrainingStatTiles(null);

    expect(tiles.every((tile) => tile.value === null)).toBe(true);
    expect(tiles.some((tile) => tile.caption === ORG_TRAINING_NO_ROSTER_NOTE)).toBe(false);
  });

  it('shows no value, not an empty one, for a field an older response lacks', () => {
    const olderShape: OrgTrainingStats = { ...stats };
    // @ts-expect-error an older response shape has no roster field
    delete olderShape.rosterMembers;
    // @ts-expect-error an older response shape has no activity field
    delete olderShape.peopleWithTrainingActivity;
    const tiles = byKey(buildOrgTrainingStatTiles(olderShape));

    expect(tiles['rosterMembers'].caption).not.toBe(ORG_TRAINING_NO_ROSTER_NOTE);
    expect(tiles['rosterMembers'].ariaLabel).toContain(': —. ');

    expect(tiles['rosterMembers'].value).toBeNull();
    expect(tiles['peopleWithTrainingActivity'].value).toBeNull();
    expect(tiles['certifiedPeople'].value).toBe(stats.certifiedEmployees);
  });
});
