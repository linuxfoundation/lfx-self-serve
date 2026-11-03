// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { OrgTrainingViewState } from '../interfaces/org-training-view.interface';
import {
  hasOrgTrainingCourseFilter,
  matchesOrgTrainingFilters,
  orgTrainingCompletionRatePct,
  orgTrainingFiltersSignature,
  parseOrgTrainingViewState,
  serializeOrgTrainingViewState,
} from './org-training-view-state.utils';

const fromQuery = (query: Record<string, string>) => parseOrgTrainingViewState((name) => query[name] ?? null);
const toQuery = (params: Record<string, string | null>) =>
  Object.fromEntries(Object.entries(params).filter(([, value]) => value !== null)) as Record<string, string>;

describe('parseOrgTrainingViewState', () => {
  it('defaults to Past 2 years, no filters and group-by course', () => {
    expect(fromQuery({})).toEqual({ range: '730d', foundation: null, project: null, course: null, level: null, format: null, groupBy: 'course' });
  });

  it('trims, drops empty values and caps length', () => {
    const state = fromQuery({ course: '  Intro  ', level: '   ', format: 'x'.repeat(500) });
    expect(state.course).toBe('Intro');
    expect(state.level).toBeNull();
    expect(state.format).toHaveLength(200);
  });

  it('falls back to defaults for unknown range and groupBy, and reads the legacy 12mo as 365d', () => {
    expect(fromQuery({ range: 'bogus', groupBy: 'bogus' })).toMatchObject({ range: '730d', groupBy: 'course' });
    expect(fromQuery({ range: '12mo' }).range).toBe('365d');
  });
});

describe('serializeOrgTrainingViewState', () => {
  it('writes nothing at the defaults', () => {
    expect(toQuery(serializeOrgTrainingViewState(fromQuery({})))).toEqual({});
  });

  it('round-trips every non-default value', () => {
    const state: OrgTrainingViewState = {
      range: 'all',
      foundation: 'f1',
      project: 'p1',
      course: 'Intro to X',
      level: 'Beginner',
      format: 'E-Learning',
      groupBy: 'format',
    };
    expect(fromQuery(toQuery(serializeOrgTrainingViewState(state)))).toEqual(state);
  });
});

describe('orgTrainingFiltersSignature', () => {
  const base = { range: '730d', foundation: null, project: null, course: null, level: null, format: null } as const;

  it('is key-safe and changes with the range and with every filter', () => {
    const signatures = [
      base,
      { ...base, range: 'all' as const },
      { ...base, foundation: 'a' },
      { ...base, project: 'a' },
      { ...base, course: 'a/b+c é' },
      { ...base, level: 'a' },
      { ...base, format: 'a' },
    ].map(orgTrainingFiltersSignature);
    expect(new Set(signatures).size).toBe(signatures.length);
    for (const signature of signatures) expect(signature).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('filter helpers', () => {
  const none = { foundation: null, project: null, course: null, level: null, format: null };

  it('detects a course-level filter', () => {
    expect(hasOrgTrainingCourseFilter(none)).toBe(false);
    expect(hasOrgTrainingCourseFilter({ ...none, format: 'E-Learning' })).toBe(true);
  });

  it('matches row attributes against every set filter', () => {
    const row = { foundationId: 'f', projectId: 'p', courseName: 'C', courseLevel: 'Beginner', courseFormat: 'E-Learning' };
    expect(matchesOrgTrainingFilters(row, none)).toBe(true);
    expect(matchesOrgTrainingFilters(row, { ...none, foundation: 'f', level: 'Beginner' })).toBe(true);
    expect(matchesOrgTrainingFilters(row, { ...none, course: 'D' })).toBe(false);
    expect(matchesOrgTrainingFilters({ ...row, courseFormat: null }, { ...none, format: 'E-Learning' })).toBe(false);
  });

  it('computes the completion rate over courses taken', () => {
    expect(orgTrainingCompletionRatePct({ coursesTaken: 0, certifications: 0, trainingsCompleted: 0 })).toBe(0);
    expect(orgTrainingCompletionRatePct({ coursesTaken: 9660, certifications: 1134, trainingsCompleted: 2373 })).toBe(36);
  });
});
