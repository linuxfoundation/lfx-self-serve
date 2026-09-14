// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { ProjectStage } from '../enums/project-stage.enum';
import { isFormationStageGate } from './project-stage.utils';

describe('isFormationStageGate', () => {
  it.each([ProjectStage.FormationExploratory, ProjectStage.FormationEngaged, ProjectStage.FormationOnHold, ProjectStage.FormationConfidential])(
    'returns true for %s',
    (stage) => {
      expect(isFormationStageGate(stage)).toBe(true);
    }
  );

  it.each([ProjectStage.Active, ProjectStage.Archived, ProjectStage.Prospect])('returns false for %s', (stage) => {
    expect(isFormationStageGate(stage)).toBe(false);
  });

  // GH-2328: Disengaged matches the `Formation - ` prefix but is a terminal sub-stage — the checklist
  // route must no longer be reachable, even though it still says "Formation - " like the five others.
  it('returns false for Formation - Disengaged (terminal, carved out of the prefix match)', () => {
    expect(isFormationStageGate(ProjectStage.FormationDisengaged)).toBe(false);
    expect(isFormationStageGate('Formation - Disengaged')).toBe(false);
  });

  it('returns false for null/undefined/empty string', () => {
    expect(isFormationStageGate(null)).toBe(false);
    expect(isFormationStageGate(undefined)).toBe(false);
    expect(isFormationStageGate('')).toBe(false);
  });

  it('accepts a bare string not backed by the enum (stage is ProjectStage | string on Project)', () => {
    expect(isFormationStageGate('Formation - Engaged')).toBe(true);
    expect(isFormationStageGate('Some Unrecognized Stage')).toBe(false);
  });

  it('matches by prefix, so a new upstream Formation sub-stage not yet in the enum still gates on', () => {
    expect(isFormationStageGate('Formation - Some New Sub-Stage')).toBe(true);
  });
});
