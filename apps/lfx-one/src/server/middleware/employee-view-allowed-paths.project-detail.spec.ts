// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_LENS_EMPLOYEE_VIEW_ALLOWED_PATHS } from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';

const isAllowed = (path: string): boolean => ORG_LENS_EMPLOYEE_VIEW_ALLOWED_PATHS.some((pattern) => pattern.test(path));

describe('all employee view allow-list: project-detail', () => {
  it.each([
    '/projects/linux/hero',
    '/projects/linux/influence',
    '/projects/linux/trend',
    '/projects/linux/leaderboard/technical',
    '/projects/linux/leaderboard/ecosystem',
    '/projects/linux/leaderboard/technical/organizations/o1',
  ])('allows %s', (path) => {
    expect(isAllowed(path)).toBe(true);
  });

  it.each([
    '/projects/linux/leaderboard/ecosystem/organizations/o1',
    '/projects/linux/cards/maintainers',
    '/projects/linux/cards/maintainers/roster',
    '/projects/linux/cards/board-members',
    '/people/all',
    '/projects/linux/other',
  ])('refuses %s', (path) => {
    expect(isAllowed(path)).toBe(false);
  });
});
