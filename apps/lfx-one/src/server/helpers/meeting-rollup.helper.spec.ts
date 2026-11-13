// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { ServiceValidationError } from '../errors';
import { buildRollupScopedQuery, isRollupScope, readRollupRootUid } from './meeting-rollup.helper';

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
