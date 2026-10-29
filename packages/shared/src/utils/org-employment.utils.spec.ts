// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { ORG_ALL_EMPLOYEE_EMPLOYMENT_OPTIONS, ORG_EMPLOYMENT_OPTIONS } from '../constants/org-people.constants';
import { parseOrgEmploymentFilter } from './org-employment.utils';

// lfx-self-serve#4627 — People → Contributors offers the All Employees employment filter.
describe('parseOrgEmploymentFilter', () => {
  it('shares one option list with All Employees', () => {
    expect(ORG_EMPLOYMENT_OPTIONS).toBe(ORG_ALL_EMPLOYEE_EMPLOYMENT_OPTIONS);
  });

  it.each(['current', 'former', 'all'] as const)('reads %s', (value) => {
    expect(parseOrgEmploymentFilter(value)).toBe(value);
  });

  it.each([null, undefined, '', 'Former', 'everyone'])('reads %s as not allowed', (value) => {
    expect(parseOrgEmploymentFilter(value)).toBeNull();
  });
});
