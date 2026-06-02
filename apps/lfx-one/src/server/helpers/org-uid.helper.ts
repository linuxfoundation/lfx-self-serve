// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { UUID_REGEX } from '@lfx-one/shared/constants';

import { ServiceValidationError } from '../errors';

// Validates org-lens route IDs as canonical UUIDs (spec 024 uuid-only routing).
export function assertOrgUid(orgUid: string | undefined, operation: string): asserts orgUid is string {
  if (!orgUid || typeof orgUid !== 'string') {
    throw ServiceValidationError.forField('orgUid', 'orgUid path parameter is required', { operation });
  }
  if (!UUID_REGEX.test(orgUid)) {
    throw ServiceValidationError.forField('orgUid', 'Invalid organization uid format', { operation });
  }
}
