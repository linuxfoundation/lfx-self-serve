// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { LensGrantInputs } from '../interfaces/lens.interface';
import { deriveAllowedLenses } from './lens.utils';

const NO_GRANTS: LensGrantInputs = {
  hasBoardRole: false,
  hasProjectRole: false,
  isRootWriter: false,
  isOrgLensEnabled: false,
};

const inputs = (overrides: Partial<LensGrantInputs>): LensGrantInputs => ({ ...NO_GRANTS, ...overrides });

describe('deriveAllowedLenses', () => {
  it('always includes the me lens', () => {
    expect(deriveAllowedLenses(NO_GRANTS)).toEqual(['me']);
  });

  describe('persona-derived grants', () => {
    it('grants foundation for a board role', () => {
      expect(deriveAllowedLenses(inputs({ hasBoardRole: true }))).toEqual(['me', 'foundation']);
    });

    it('grants project for a project role', () => {
      expect(deriveAllowedLenses(inputs({ hasProjectRole: true }))).toEqual(['me', 'project']);
    });

    it('grants both for a root writer', () => {
      expect(deriveAllowedLenses(inputs({ isRootWriter: true }))).toEqual(['me', 'foundation', 'project']);
    });

    it('keeps persona-granted lenses stable regardless of other inputs', () => {
      expect(deriveAllowedLenses(inputs({ hasBoardRole: true, hasProjectRole: true }))).toEqual(['me', 'foundation', 'project']);
    });
  });

  describe('org lens', () => {
    it('appends org when the flag is on', () => {
      expect(deriveAllowedLenses(inputs({ isOrgLensEnabled: true }))).toEqual(['me', 'org']);
    });

    it('orders org last alongside other grants', () => {
      expect(deriveAllowedLenses(inputs({ isRootWriter: true, isOrgLensEnabled: true }))).toEqual(['me', 'foundation', 'project', 'org']);
    });
  });
});
