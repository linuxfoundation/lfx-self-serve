// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { ProjectStage } from '../enums/project-stage.enum';
import { deriveFormationEntityType, getFormationQueueStageDisplay, normalizeFormationSubStage } from './formation.utils';

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

describe('normalizeFormationSubStage (GH-2366)', () => {
  it('maps the three Formation sub-stages the queue taxonomy recognizes', () => {
    expect(normalizeFormationSubStage(ProjectStage.FormationExploratory)).toBe('exploratory');
    expect(normalizeFormationSubStage(ProjectStage.FormationEngaged)).toBe('engaged');
    expect(normalizeFormationSubStage(ProjectStage.FormationOnHold)).toBe('on_hold');
  });

  it('normalizes every other ProjectStage value to null — no queue-taxonomy equivalent', () => {
    expect(normalizeFormationSubStage(ProjectStage.FormationDisengaged)).toBeNull();
    expect(normalizeFormationSubStage(ProjectStage.FormationConfidential)).toBeNull();
    expect(normalizeFormationSubStage(ProjectStage.Active)).toBeNull();
    expect(normalizeFormationSubStage(ProjectStage.Archived)).toBeNull();
    expect(normalizeFormationSubStage(ProjectStage.Prospect)).toBeNull();
  });

  it('normalizes null/undefined/empty string to null', () => {
    expect(normalizeFormationSubStage(null)).toBeNull();
    expect(normalizeFormationSubStage(undefined)).toBeNull();
    expect(normalizeFormationSubStage('')).toBeNull();
  });

  it('normalizes an unrecognized string to null rather than throwing', () => {
    expect(normalizeFormationSubStage('not-a-real-stage')).toBeNull();
  });

  it('never resolves an Object.prototype member name off the prototype chain', () => {
    expect(normalizeFormationSubStage('toString')).toBeNull();
    expect(normalizeFormationSubStage('constructor')).toBeNull();
    expect(normalizeFormationSubStage('hasOwnProperty')).toBeNull();
  });
});

describe('getFormationQueueStageDisplay (GH-2366)', () => {
  it('renders the canonical label/severity for a mapped sub-stage', () => {
    expect(getFormationQueueStageDisplay('engaged', 'Formation - Engaged')).toEqual({ label: 'Formation · Engaged', severity: 'accent' });
  });

  it('renders the raw upstream value verbatim, muted, for an unmapped sub-stage', () => {
    expect(getFormationQueueStageDisplay(null, 'Active')).toEqual({ label: 'Active', severity: 'secondary' });
    expect(getFormationQueueStageDisplay(null, 'Formation - Disengaged')).toEqual({ label: 'Formation - Disengaged', severity: 'secondary' });
  });

  it('falls back to an em dash when the raw value itself is empty', () => {
    expect(getFormationQueueStageDisplay(null, '')).toEqual({ label: '—', severity: 'secondary' });
  });
});
