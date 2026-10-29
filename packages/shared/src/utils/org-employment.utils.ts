// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_EMPLOYMENT_OPTIONS } from '../constants/org-people.constants';
import type { OrgEmploymentFilter } from '../interfaces';

/** `employment` value → employment filter, or `null` when it is not one of the allowed values. */
export function parseOrgEmploymentFilter(value: string | null | undefined): OrgEmploymentFilter | null {
  return ORG_EMPLOYMENT_OPTIONS.find((option) => option.value === value)?.value ?? null;
}
