// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { ServiceValidationError } from '../errors';
import { parseRollupProjectsPreference, readRollupProjectsPreferenceRequest, setRollupProjectsPreference } from './meeting-rollup-preference.helper';

describe('parseRollupProjectsPreference', () => {
  it('reads a stored map, keeping a saved empty choice', () => {
    expect(parseRollupProjectsPreference(JSON.stringify({ root: ['a', 'b'], all: [] }))).toEqual({ root: ['a', 'b'], all: [] });
  });

  it.each([[null], ['not json'], ['[1,2]'], ['"text"']])('degrades %j to nothing saved', (raw) => {
    expect(parseRollupProjectsPreference(raw)).toEqual({});
  });

  it('drops a root whose list held only invalid UIDs, instead of reading it as all projects', () => {
    expect(parseRollupProjectsPreference(JSON.stringify({ root: ['bad:uid'], all: [] }))).toEqual({ all: [] });
  });

  it('drops unsafe roots, non-list values and unsafe UIDs', () => {
    expect(parseRollupProjectsPreference(JSON.stringify({ 'bad:root': ['a'], root: ['ok', 'b*d', 3], other: 'x' }))).toEqual({ root: ['ok'] });
  });
});

describe('readRollupProjectsPreferenceRequest', () => {
  it('dedupes the projects', () => {
    expect(readRollupProjectsPreferenceRequest({ root_project_uid: 'root', project_uids: ['a', 'a'] }, 'op')).toEqual({
      root_project_uid: 'root',
      project_uids: ['a'],
    });
  });

  it.each([
    [{ project_uids: [] }],
    [{ root_project_uid: 'root', project_uids: Array.from({ length: 201 }, (_, i) => `p${i}`) }],
    [{ root_project_uid: 'root', project_uids: [1] }],
  ])('rejects %j', (body) => {
    expect(() => readRollupProjectsPreferenceRequest(body, 'op')).toThrow(ServiceValidationError);
  });
});

describe('setRollupProjectsPreference', () => {
  it('moves the saved root to the most recent position and keeps an empty choice', () => {
    expect(Object.keys(setRollupProjectsPreference({ a: ['1'], b: ['2'] }, 'a', []))).toEqual(['b', 'a']);
  });

  it('keeps at most 25 roots, dropping the oldest', () => {
    const map = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`r${i}`, ['x']]));

    const result = setRollupProjectsPreference(map, 'new', ['y']);

    expect(Object.keys(result)).toHaveLength(25);
    expect(result).not.toHaveProperty('r0');
    expect(result['new']).toEqual(['y']);
  });

  it('drops the oldest roots until the stored value fits its size budget', () => {
    const uids = Array.from({ length: 200 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`);
    const map = { old1: uids, old2: uids };

    const result = setRollupProjectsPreference(map, 'new', uids);

    // Each root's 200 UUIDs take about 7.8 KB, so two fit the 16 KB budget and only the oldest goes.
    expect(Object.keys(result)).toEqual(['old2', 'new']);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(16_000);
  });
});
