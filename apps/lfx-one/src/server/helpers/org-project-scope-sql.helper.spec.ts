// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgProjectScope } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { orgProjectScopePredicate } from './org-project-scope-sql.helper';

describe('orgProjectScopePredicate', () => {
  it('maps each allowed scope onto the LF flag column', () => {
    expect(orgProjectScopePredicate('lf')).toBe('AND is_lf_project = TRUE');
    expect(orgProjectScopePredicate('non_lf', 'c.IS_LF_PROJECT')).toBe('AND c.IS_LF_PROJECT = FALSE');
    expect(orgProjectScopePredicate('all')).toBe('');
  });

  it('throws for a value outside the allow-list instead of building SQL', () => {
    expect(() => orgProjectScopePredicate('everything' as OrgProjectScope)).toThrow('Unknown project scope: everything');
  });
});
