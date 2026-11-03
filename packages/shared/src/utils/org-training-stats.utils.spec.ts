// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { ORG_TRAINING_IN_PROGRESS_RULE, ORG_TRAINING_NO_ROSTER_NOTE, ORG_TRAINING_STAT_DEFINITIONS } from '../constants/org-training-stats.constants';
import type { OrgTrainingStats } from '../interfaces/org-training-view.interface';
import {
  buildOrgTrainingStatTiles,
  formatOrgTrainingAsOf,
  orgTrainingRangeWindow,
  orgTrainingStatCaption,
  orgTrainingStatTooltip,
} from './org-training-stats.utils';

const ASOF = '2026-11-02T09:48:21.094Z';
const stats: OrgTrainingStats = {
  range: '730d',
  asOf: ASOF,
  rosterMembers: 100,
  rosterMembersAsOf: '2026-11-01T00:00:00.000Z',
  peopleWithTrainingActivity: 40,
  learnersOutsidePeopleList: 3,
  coursesTaken: 100,
  certifications: 10,
  certifiedPeople: 8,
  trainingsCompleted: 20,
  completionRatePct: 30,
  coursesInProgress: 70,
  peopleInTraining: 25,
};

describe('formatOrgTrainingAsOf', () => {
  it('states the UTC day', () => {
    expect(formatOrgTrainingAsOf('2026-11-02T23:59:59.000Z')).toContain('Nov 2, 2026');
  });

  it('says the date is unavailable instead of inventing one', () => {
    for (const missing of [null, undefined, '', 'not-a-date']) expect(formatOrgTrainingAsOf(missing)).toContain('unavailable');
  });
});

describe('captions and tooltips', () => {
  it('state unit, window and as-of date for every stat', () => {
    for (const stat of Object.values(ORG_TRAINING_STAT_DEFINITIONS)) {
      for (const text of [orgTrainingStatCaption(stat, '730d', ASOF), orgTrainingStatTooltip(stat, '730d', ASOF)]) {
        expect(text.toLowerCase()).toContain(stat.unit.toLowerCase());
        expect(text).toContain(stat.window ?? 'Past 2 years');
        expect(text).toContain('Nov 2, 2026');
      }
    }
  });

  it('names the window of the selected range and "all time"', () => {
    expect(orgTrainingRangeWindow('90d')).toBe('Past 90 days');
    expect(orgTrainingRangeWindow('all')).toBe('all time');
  });

  it('labels the roster as live and unfiltered', () => {
    expect(orgTrainingStatCaption(ORG_TRAINING_STAT_DEFINITIONS.rosterMembers, '30d', ASOF)).toContain('live, not filtered');
  });

  it('states the in-progress rule on both in-progress tiles and denies a snapshot', () => {
    for (const key of ['coursesInProgress', 'peopleInTraining'] as const) {
      const stat = ORG_TRAINING_STAT_DEFINITIONS[key];
      expect(orgTrainingStatCaption(stat, '730d', ASOF)).toContain(ORG_TRAINING_IN_PROGRESS_RULE);
      expect(orgTrainingStatTooltip(stat, '730d', ASOF)).toContain('Not a snapshot');
    }
  });
});

describe('buildOrgTrainingStatTiles', () => {
  it('renders every stat of one OrgTrainingStats, with the rate as a percent', () => {
    const tiles = Object.fromEntries(buildOrgTrainingStatTiles(stats, '730d').map((tile) => [tile.key, tile]));
    expect(tiles['coursesTaken'].display).toBe('100');
    expect(tiles['completionRate'].display).toBe('30%');
    expect(tiles['peopleInTraining'].caption).toContain(ORG_TRAINING_IN_PROGRESS_RULE);
  });

  it('shows em dashes and no as-of sentence before the stats load', () => {
    const tiles = buildOrgTrainingStatTiles(null, '730d');
    expect(tiles.every((tile) => tile.value === null && tile.display === '—')).toBe(true);
    expect(tiles.some((tile) => tile.tooltip.includes('Nov'))).toBe(false);
  });

  it('says there is no program for a null roster', () => {
    const tile = buildOrgTrainingStatTiles({ ...stats, rosterMembers: null }, '730d')[0];
    expect(tile.caption).toBe(ORG_TRAINING_NO_ROSTER_NOTE);
  });

  it('keeps courses taken = certifications + trainings completed + in progress in the fixture', () => {
    expect(stats.certifications + stats.trainingsCompleted + stats.coursesInProgress).toBe(stats.coursesTaken);
  });
});
