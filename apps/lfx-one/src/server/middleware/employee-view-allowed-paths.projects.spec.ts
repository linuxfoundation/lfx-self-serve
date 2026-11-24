// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_LENS_EMPLOYEE_VIEW_ALLOWED_PATHS } from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';

const isAllowed = (path: string): boolean => ORG_LENS_EMPLOYEE_VIEW_ALLOWED_PATHS.some((pattern) => pattern.test(path));

describe('all employee view allow-list: projects', () => {
  it.each(['/projects', '/projects/search', '/workspaces'])('allows %s', (path) => {
    expect(isAllowed(path)).toBe(true);
  });

  it.each(['/people/all', '/projects/acme/extra/path'])('refuses %s', (path) => {
    expect(isAllowed(path)).toBe(false);
  });
});
