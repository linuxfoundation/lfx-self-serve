// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { OrgTrainingViewState } from '../interfaces/org-training-view.interface';
import {
  hasOrgTrainingFilter,
  matchesOrgTrainingFilters,
  normalizeOrgTrainingFilterValue,
  orgTrainingCompletionRatePct,
  orgTrainingFiltersSignature,
  parseOrgTrainingViewState,
  serializeOrgTrainingViewState,
  trimOrgTrainingSpaces,
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

  it('trims spaces only, as Snowflake TRIM does: a value surrounded by non-breaking spaces or holding tabs is kept as is and round-trips', () => {
    const nbsp = '\u00a0Kubernetes Basics\u00a0';
    const tabbed = '\tKubernetes\tBasics\t';

    const state = fromQuery({ course: nbsp, level: tabbed, format: ' \u00a0E-Learning\u00a0 ' });

    expect(state.course).toBe(nbsp);
    expect(state.level).toBe(tabbed);
    expect(state.format).toBe('\u00a0E-Learning\u00a0');
    const serialized = serializeOrgTrainingViewState(state);
    expect(serialized['course']).toBe(nbsp);
    expect(serialized['level']).toBe(tabbed);
    expect(fromQuery(toQuery(serialized))).toEqual(state);
  });

  it('keeps a value made only of non-breaking spaces or a tab, which Snowflake TRIM does not blank', () => {
    expect(fromQuery({ course: '\u00a0', level: '\t' })).toMatchObject({ course: '\u00a0', level: '\t' });
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
    expect(hasOrgTrainingFilter(none)).toBe(false);
    expect(hasOrgTrainingFilter({ ...none, format: 'E-Learning' })).toBe(true);
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

describe('trimOrgTrainingSpaces / normalizeOrgTrainingFilterValue', () => {
  // The regular expression the index scan replaced (quadratic on long space runs, hence CodeQL js/polynomial-redos).
  const legacyTrim = (value: string): string => value.replace(/^ +| +$/g, '');
  const legacyNormalize = (value: string): string | null => {
    const normalized = legacyTrim(value).slice(0, 200);
    return normalized === '' ? null : normalized;
  };

  const inputs: [string, string][] = [
    ['empty', ''],
    ['spaces only', '     '],
    ['leading and trailing spaces', '  Course A  '],
    ['trailing spaces', 'Course A   '],
    ['internal spaces kept', ' Intro  to   Linux '],
    ['a tab stays at the ends', '\tCourse\t'],
    ['spaces around a tab', ' \t Course \t '],
    ['a non-breaking space stays', '\u00a0Course\u00a0'],
    ['no spaces', 'Course'],
  ];

  it.each(inputs)('matches the old regular expression: %s', (_label, input) => {
    expect(trimOrgTrainingSpaces(input)).toBe(legacyTrim(input));
    expect(normalizeOrgTrainingFilterValue(input)).toBe(legacyNormalize(input));
  });

  it('strips only U+0020: a tab stays, and internal spaces are kept', () => {
    expect(trimOrgTrainingSpaces('\t a  b \t')).toBe('\t a  b \t');
    expect(trimOrgTrainingSpaces('  a  b  ')).toBe('a  b');
  });

  it('is linear on 100k spaces: spaces only, spaces then text, text then spaces', () => {
    const spaces = ' '.repeat(100_000);
    const started = Date.now();
    expect(trimOrgTrainingSpaces(spaces)).toBe('');
    expect(trimOrgTrainingSpaces(`${spaces}x`)).toBe('x');
    expect(trimOrgTrainingSpaces(`x${spaces}`)).toBe('x');
    expect(trimOrgTrainingSpaces(`${spaces}x${spaces}`)).toBe('x');
    expect(trimOrgTrainingSpaces(`${spaces}x${spaces}y`)).toBe(`x${spaces}y`);
    expect(normalizeOrgTrainingFilterValue(spaces)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('caps at 200 characters after the trim, and maps blank and non-strings to null', () => {
    expect(normalizeOrgTrainingFilterValue(`  ${'x'.repeat(250)}  `)).toBe('x'.repeat(200));
    expect(normalizeOrgTrainingFilterValue(`${' '.repeat(10)}${'y'.repeat(200)}`)).toBe('y'.repeat(200));
    expect(normalizeOrgTrainingFilterValue('   ')).toBeNull();
    expect(normalizeOrgTrainingFilterValue(null)).toBeNull();
    expect(normalizeOrgTrainingFilterValue(undefined)).toBeNull();
  });
});

describe('normalizeOrgTrainingFilterValue is idempotent at the 200-character cutoff', () => {
  const cut = `${'x'.repeat(199)} suffix`;

  it('trims again after the cut, so normalizing an offered value returns it unchanged', () => {
    const once = normalizeOrgTrainingFilterValue(cut);
    expect(once).toBe('x'.repeat(199));
    expect(normalizeOrgTrainingFilterValue(once)).toBe(once);
  });

  it('is idempotent for padded, long and mixed inputs', () => {
    for (const value of [`  ${'y'.repeat(198)}  tail`, `${'z'.repeat(200)}  `, `${' '.repeat(5)}${'a'.repeat(199)} b`, ` ${'c '.repeat(150)}`]) {
      const once = normalizeOrgTrainingFilterValue(value);
      expect(normalizeOrgTrainingFilterValue(once)).toBe(once);
      expect(once === null || (once.length <= 200 && once === once.replace(/^ +| +$/g, ''))).toBe(true);
    }
  });
});
