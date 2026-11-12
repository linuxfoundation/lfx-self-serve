// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { ServiceValidationError } from '../errors';
import { buildRollupScopedQuery, isRollupScope, narrowRollupScope, readRollupFilters, readRollupRootUid } from './meeting-rollup.helper';

const ROOT = '0a1b2c3d-1111-2222-3333-444455556666';

describe('readRollupRootUid', () => {
  it('returns undefined when the param is absent', () => {
    expect(readRollupRootUid({ tags: 'project_uid:x' }, 'get_meetings')).toBeUndefined();
  });

  it('returns a filter-safe project UID', () => {
    expect(readRollupRootUid({ root_project_uid: ROOT }, 'get_meetings')).toBe(ROOT);
  });

  it('rejects a caller filters_or, which the roll-up scope would otherwise replace', () => {
    expect(() => readRollupRootUid({ root_project_uid: ROOT, filters_or: ['meeting_type:Board'] }, 'get_meetings')).toThrow(ServiceValidationError);
  });

  it.each([[[ROOT, ROOT]], ['a:b'], ['*'], ['']])('rejects %j', (value) => {
    expect(() => readRollupRootUid({ root_project_uid: value }, 'get_meetings')).toThrow(ServiceValidationError);
  });
});

describe('buildRollupScopedQuery', () => {
  it('ORs every scope UID and drops the roll-up param', () => {
    const result = buildRollupScopedQuery({ root_project_uid: ROOT, page_token: 't', filters: ['meeting_type:Technical'], name: 'sync' }, [ROOT, 'child-1']);

    expect(result).toEqual({
      page_token: 't',
      filters: ['meeting_type:Technical'],
      name: 'sync',
      filters_or: [`project_uid:${ROOT}`, 'project_uid:child-1'],
    });
  });

  it('drops caller project_uid tags so the scope cannot be widened, keeping other tags', () => {
    const result = buildRollupScopedQuery({ root_project_uid: ROOT, tags: ['project_uid:other', 'committee_uid:c1'] }, [ROOT]);

    expect(result['tags']).toEqual(['committee_uid:c1']);
    expect(result['filters_or']).toEqual([`project_uid:${ROOT}`]);
  });

  it('omits tags entirely when only project tags were sent', () => {
    const result = buildRollupScopedQuery({ root_project_uid: ROOT, tags: 'project_uid:other' }, [ROOT]);

    expect(result).not.toHaveProperty('tags');
  });
});

describe('isRollupScope', () => {
  it('accepts a list of UIDs and refuses anything else from the cache', () => {
    expect(isRollupScope(['a', 'b'])).toBe(true);
    expect(isRollupScope([])).toBe(true);
    expect(isRollupScope('a')).toBe(false);
    expect(isRollupScope([1])).toBe(false);
    expect(isRollupScope(null)).toBe(false);
  });
});

describe('readRollupFilters', () => {
  it('returns no filters when none are sent', () => {
    expect(readRollupFilters({ root_project_uid: ROOT }, 'get_meetings')).toEqual({});
  });

  it('reads the project subset, group and group type', () => {
    expect(readRollupFilters({ project_uids: 'p-1, p-2,p-1', committee_uid: 'c-1', group_type: 'Board' }, 'get_meetings')).toEqual({
      projectUids: ['p-1', 'p-2'],
      committeeUid: 'c-1',
      groupType: 'Board',
    });
  });

  it.each([
    ['a repeated project_uids', { project_uids: ['a', 'b'] }],
    ['an unsafe project UID', { project_uids: 'a,b:c' }],
    ['an unsafe group UID', { committee_uid: 'c*' }],
    ['a blank group type', { group_type: '  ' }],
  ])('rejects %s', (_label, query) => {
    expect(() => readRollupFilters(query, 'get_meetings')).toThrow(ServiceValidationError);
  });
});

describe('narrowRollupScope', () => {
  it('keeps the whole tree without a selection, and only selected projects inside it otherwise', () => {
    expect(narrowRollupScope([ROOT, 'child-1'])).toEqual([ROOT, 'child-1']);
    expect(narrowRollupScope([ROOT, 'child-1'], ['child-1', 'outside'])).toEqual(['child-1']);
  });
});

describe('buildRollupScopedQuery with groups', () => {
  it('adds the groups as committee tags and drops the roll-up filter params', () => {
    const result = buildRollupScopedQuery({ root_project_uid: ROOT, project_uids: 'x', committee_uid: 'c-1', group_type: 'Board' }, [ROOT], ['c-1', 'c-2']);

    expect(result).toEqual({ tags: ['committee_uid:c-1', 'committee_uid:c-2'], filters_or: [`project_uid:${ROOT}`] });
  });

  it('drops caller committee tags when it sets its own, since tags are one OR group', () => {
    const result = buildRollupScopedQuery({ root_project_uid: ROOT, tags: ['committee_uid:other', 'x:y'] }, [ROOT], ['c-1']);

    expect(result['tags']).toEqual(['x:y', 'committee_uid:c-1']);
  });
});
