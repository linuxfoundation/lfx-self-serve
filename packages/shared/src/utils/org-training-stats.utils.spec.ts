// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  ORG_TRAINING_IN_PROGRESS_RULE,
  ORG_TRAINING_NO_ROSTER_NOTE,
  ORG_TRAINING_OUTSIDE_NOT_COUNTED_NOTE,
  ORG_TRAINING_STAT_DEFINITIONS,
  ORG_TRAINING_STAT_TILES,
} from '../constants/org-training-stats.constants';
import type { OrgTrainingStats } from '../interfaces/org-training-view.interface';
import {
  buildOrgTrainingStatTiles,
  formatOrgTrainingAsOf,
  orgTrainingRangeWindow,
  orgTrainingStatCaption,
  orgTrainingStatCaptionParts,
  orgTrainingStatTooltip,
  orgTrainingTableNote,
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

  it('exposes the unit, window and as-of date as parts that join into the caption', () => {
    const stat = ORG_TRAINING_STAT_DEFINITIONS.certifiedPeople;
    const parts = orgTrainingStatCaptionParts(stat, '730d', ASOF);

    expect(parts).toEqual({ unit: 'People', window: 'Past 2 years', asOf: 'as of Nov 2, 2026' });
    expect([parts.unit, parts.window, parts.asOf].join(' · ')).toBe(orgTrainingStatCaption(stat, '730d', ASOF));
    expect(orgTrainingStatCaptionParts(stat, '90d').asOf).toBeNull();
    expect(orgTrainingStatCaptionParts(stat, '90d').window).toBe('Past 90 days');
  });

  it('folds a stat note into the window part', () => {
    const parts = orgTrainingStatCaptionParts(ORG_TRAINING_STAT_DEFINITIONS.rosterMembers, '30d', ASOF);

    expect(parts.window).toContain('live, not filtered');
    expect(orgTrainingStatCaption(ORG_TRAINING_STAT_DEFINITIONS.rosterMembers, '30d', ASOF)).toBe(`${parts.unit} · ${parts.window} · ${parts.asOf}`);
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

  it('places the learners-outside tile right after people with training activity, with its own value and caption', () => {
    const tiles = buildOrgTrainingStatTiles(stats, '730d');
    expect(tiles.map((tile) => tile.key)).toEqual([
      'rosterMembers',
      'peopleWithTrainingActivity',
      'learnersOutsidePeopleList',
      'coursesTaken',
      'certifications',
      'certifiedPeople',
      'trainingsCompleted',
      'completionRate',
      'coursesInProgress',
      'peopleInTraining',
    ]);
    expect(tiles).toHaveLength(ORG_TRAINING_STAT_TILES.length);

    const people = tiles.find((tile) => tile.key === 'peopleWithTrainingActivity')!;
    const outside = tiles.find((tile) => tile.key === 'learnersOutsidePeopleList')!;
    expect(people.display).toBe('40');
    expect(outside.display).toBe('3');
    expect(outside.label).toBe('Learners not on the people list');
    expect(outside.testId).toBe('org-training-stat-learners-outside-people-list');
    expect(outside.caption).toBe('People · Past 2 years · as of Nov 2, 2026');
    expect(outside.tooltip).toContain('not on its people list');
    expect(people.tooltip).toContain('people list');
    expect(people.tooltip).not.toContain('Includes learners');
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

  it('shows an em dash, not a zero, and says why for an outside-learners count left uncounted by a filter', () => {
    const tile = buildOrgTrainingStatTiles({ ...stats, learnersOutsidePeopleList: null }, '730d').find((t) => t.key === 'learnersOutsidePeopleList')!;
    expect(tile.display).toBe('—');
    expect(tile.caption).toBe(ORG_TRAINING_OUTSIDE_NOT_COUNTED_NOTE);
    expect(tile.tooltip).toContain(ORG_TRAINING_OUTSIDE_NOT_COUNTED_NOTE);
  });

  it('keeps courses taken = certifications + trainings completed + in progress in the fixture', () => {
    expect(stats.certifications + stats.trainingsCompleted + stats.coursesInProgress).toBe(stats.coursesTaken);
  });
});

describe('orgTrainingTableNote', () => {
  it('names the selected range and denies the 12-month rule and a snapshot', () => {
    const note = orgTrainingTableNote('90d');
    expect(note).toContain('Past 90 days');
    expect(note).toContain('no certificate in that range');
    expect(note).toContain('not a snapshot');
    expect(note).not.toContain('12 months');
  });

  it('says "at any time" for all time', () => {
    expect(orgTrainingTableNote('all')).toContain('at any time');
  });
});

describe('buildOrgTrainingStatTiles with a legacy-shaped payload (rolling deployment)', () => {
  // The previous release's /training/stats payload: none of the newer fields, and the old names.
  const legacy = { range: '730d', peopleWithTrainingActivity: 40, certifiedEmployees: 8 } as unknown as OrgTrainingStats;

  it('shows missing readings as unavailable (an em dash) and never throws', () => {
    const tiles = Object.fromEntries(buildOrgTrainingStatTiles(legacy, '730d').map((tile) => [tile.key, tile]));

    expect(tiles['peopleWithTrainingActivity'].display).toBe('40');
    for (const key of [
      'rosterMembers',
      'learnersOutsidePeopleList',
      'coursesTaken',
      'certifications',
      'certifiedPeople',
      'trainingsCompleted',
      'completionRate',
      'coursesInProgress',
      'peopleInTraining',
    ]) {
      expect(tiles[key].value, key).toBeNull();
      expect(tiles[key].display, key).toBe('—');
    }
  });

  it('keeps the "no LF Education training program" note for an explicit null roster only', () => {
    const roster = buildOrgTrainingStatTiles(legacy, '730d')[0];
    expect(roster.caption).not.toBe(ORG_TRAINING_NO_ROSTER_NOTE);
    expect(roster.tooltip).not.toContain(ORG_TRAINING_NO_ROSTER_NOTE);

    const noProgram = buildOrgTrainingStatTiles({ ...legacy, rosterMembers: null }, '730d')[0];
    expect(noProgram.caption).toBe(ORG_TRAINING_NO_ROSTER_NOTE);
  });

  it('treats a non-finite reading as unavailable', () => {
    const tile = buildOrgTrainingStatTiles({ ...stats, coursesTaken: Number.NaN }, '730d').find((entry) => entry.key === 'coursesTaken')!;
    expect(tile.display).toBe('—');
  });
});
