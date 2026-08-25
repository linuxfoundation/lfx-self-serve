// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { LensGrantInputs } from '../interfaces/lens.interface';
import { deriveAllowedLenses, isHybridLensUser } from './lens.utils';

const NO_GRANTS: LensGrantInputs = {
  hasBoardRole: false,
  hasProjectRole: false,
  isRootWriter: false,
  hasWriterFoundation: false,
  hasWriterProject: false,
  isOrgLensEnabled: false,
  isLFStaff: false,
  hasMarketingGrant: false,
};

const inputs = (overrides: Partial<LensGrantInputs>): LensGrantInputs => ({ ...NO_GRANTS, ...overrides });

describe('deriveAllowedLenses', () => {
  it('always includes the me lens', () => {
    expect(deriveAllowedLenses(NO_GRANTS)).toEqual(['me']);
  });

  describe('persona-derived grants (pre-existing behaviour)', () => {
    it('grants foundation for a board role', () => {
      expect(deriveAllowedLenses(inputs({ hasBoardRole: true }))).toEqual(['me', 'foundation']);
    });

    it('grants project for a project role', () => {
      expect(deriveAllowedLenses(inputs({ hasProjectRole: true }))).toEqual(['me', 'project']);
    });

    it('grants both for a root writer', () => {
      expect(deriveAllowedLenses(inputs({ isRootWriter: true }))).toEqual(['me', 'foundation', 'project']);
    });
  });

  describe('writer-derived grants (LFXV2-2754)', () => {
    // The regression case: a contributor-only persona holding writer on foundations.
    // Before this change the foundation lens was withheld, which made every foundation
    // the user administers unreachable in the create flow.
    it('grants foundation on a writer-held foundation despite no board role', () => {
      expect(deriveAllowedLenses(inputs({ hasWriterFoundation: true }))).toEqual(['me', 'foundation']);
    });

    it('grants project on a writer-held project despite no project role', () => {
      expect(deriveAllowedLenses(inputs({ hasWriterProject: true }))).toEqual(['me', 'project']);
    });

    it('grants both when the user holds writer on each kind', () => {
      expect(deriveAllowedLenses(inputs({ hasWriterFoundation: true, hasWriterProject: true }))).toEqual(['me', 'foundation', 'project']);
    });

    it('does not grant foundation from a project-only writer grant', () => {
      expect(deriveAllowedLenses(inputs({ hasWriterProject: true }))).not.toContain('foundation');
    });

    it('does not grant project from a foundation-only writer grant', () => {
      expect(deriveAllowedLenses(inputs({ hasWriterFoundation: true }))).not.toContain('project');
    });
  });

  describe('grant sources are additive, never subtractive', () => {
    it('keeps persona-granted lenses when no writer grants have resolved yet', () => {
      // Grants arrive after hydration; the set must not narrow while they are pending.
      expect(deriveAllowedLenses(inputs({ hasBoardRole: true, hasProjectRole: true }))).toEqual(['me', 'foundation', 'project']);
    });

    it('does not duplicate a lens conferred by both sources', () => {
      const result = deriveAllowedLenses(inputs({ hasBoardRole: true, hasWriterFoundation: true }));
      expect(result).toEqual(['me', 'foundation']);
      expect(result.filter((lens) => lens === 'foundation')).toHaveLength(1);
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

  describe('lf staff', () => {
    it('grants foundation without a board role', () => {
      expect(deriveAllowedLenses(inputs({ isLFStaff: true }))).toEqual(['me', 'foundation']);
    });

    it('does not grant project', () => {
      expect(deriveAllowedLenses(inputs({ isLFStaff: true }))).not.toContain('project');
    });
  });

  describe('marketing FGA grant (LFXV2-2235/LFXV2-2236)', () => {
    it('grants foundation without a board role', () => {
      expect(deriveAllowedLenses(inputs({ hasMarketingGrant: true }))).toEqual(['me', 'foundation']);
    });

    it('does not grant project', () => {
      expect(deriveAllowedLenses(inputs({ hasMarketingGrant: true }))).not.toContain('project');
    });
  });
});

describe('isHybridLensUser', () => {
  // Every combination that renders both lens buttons must merge them. Before this was derived
  // from deriveAllowedLenses, only the board+project role pair did, so LF staff, root writers,
  // and writer-granted users kept a separate foundation button.
  it.each([
    ['board role and project role', { hasBoardRole: true, hasProjectRole: true }],
    ['lf staff and project role', { isLFStaff: true, hasProjectRole: true }],
    ['lf staff and a project writer grant', { isLFStaff: true, hasWriterProject: true }],
    ['a foundation writer grant and project role', { hasWriterFoundation: true, hasProjectRole: true }],
    ['writer grants on both kinds', { hasWriterFoundation: true, hasWriterProject: true }],
    ['a root writer alone', { isRootWriter: true }],
    ['board role and a project writer grant', { hasBoardRole: true, hasWriterProject: true }],
    ['a marketing FGA grant and project role', { hasMarketingGrant: true, hasProjectRole: true }],
  ])('is true for %s', (_label, overrides: Partial<LensGrantInputs>) => {
    expect(isHybridLensUser(inputs(overrides))).toBe(true);
  });

  it.each([
    ['no grants at all', {}],
    ['foundation only, from a board role', { hasBoardRole: true }],
    ['foundation only, from lf staff', { isLFStaff: true }],
    ['foundation only, from a writer grant', { hasWriterFoundation: true }],
    ['project only, from a project role', { hasProjectRole: true }],
    ['project only, from a writer grant', { hasWriterProject: true }],
    ['foundation only, from a marketing FGA grant', { hasMarketingGrant: true }],
  ])('is false for %s', (_label, overrides: Partial<LensGrantInputs>) => {
    expect(isHybridLensUser(inputs(overrides))).toBe(false);
  });

  it('is unaffected by the org lens flag', () => {
    expect(isHybridLensUser(inputs({ isOrgLensEnabled: true }))).toBe(false);
    expect(isHybridLensUser(inputs({ isRootWriter: true, isOrgLensEnabled: true }))).toBe(true);
  });
});
