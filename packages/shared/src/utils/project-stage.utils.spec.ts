// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { ProjectStage } from '../enums/project-stage.enum';
import { isFormationStage } from './project-stage.utils';

describe('isFormationStage', () => {
  it.each([
    ProjectStage.FormationExploratory,
    ProjectStage.FormationEngaged,
    ProjectStage.FormationOnHold,
    ProjectStage.FormationDisengaged,
    ProjectStage.FormationConfidential,
  ])('returns true for %s', (stage) => {
    expect(isFormationStage(stage)).toBe(true);
  });

  it.each([ProjectStage.Active, ProjectStage.Archived, ProjectStage.Prospect])('returns false for %s', (stage) => {
    expect(isFormationStage(stage)).toBe(false);
  });

  it('returns false for null/undefined/empty string', () => {
    expect(isFormationStage(null)).toBe(false);
    expect(isFormationStage(undefined)).toBe(false);
    expect(isFormationStage('')).toBe(false);
  });

  it('accepts a bare string not backed by the enum (stage is ProjectStage | string on Project)', () => {
    expect(isFormationStage('Formation - Engaged')).toBe(true);
    expect(isFormationStage('Some Unrecognized Stage')).toBe(false);
  });
});
