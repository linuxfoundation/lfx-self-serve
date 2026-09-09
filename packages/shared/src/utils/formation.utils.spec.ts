// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { deriveFormationEntityType } from './formation.utils';

describe('deriveFormationEntityType', () => {
  it('derives foundation when is_foundation is true, regardless of parent_uid', () => {
    expect(deriveFormationEntityType({ is_foundation: true, parent_uid: null })).toBe('foundation');
    expect(deriveFormationEntityType({ is_foundation: true, parent_uid: 'some-parent-uid' })).toBe('foundation');
  });

  it('derives project when not a foundation and parent_uid is null (top-level)', () => {
    expect(deriveFormationEntityType({ is_foundation: false, parent_uid: null })).toBe('project');
  });

  it('derives project for every other falsy parent_uid form, not just null', () => {
    // Deliberately falsy, not `=== null`: a producer that omits the key (`undefined`) or sends
    // an un-collapsed empty string is the more likely deviation from the `null` contract than a
    // real ROOT UUID, and must not silently mislabel a top-level project as `child_project`.
    expect(deriveFormationEntityType({ is_foundation: false, parent_uid: undefined })).toBe('project');
    expect(deriveFormationEntityType({ is_foundation: false, parent_uid: '' })).toBe('project');
  });

  it('derives child_project when not a foundation and parent_uid names a real parent', () => {
    expect(deriveFormationEntityType({ is_foundation: false, parent_uid: 'cncf-uid' })).toBe('child_project');
  });
});
