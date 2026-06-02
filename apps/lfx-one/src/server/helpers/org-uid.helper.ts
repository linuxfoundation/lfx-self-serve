// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SALESFORCE_ACCOUNT_ID_PATTERN } from '@lfx-one/shared/constants';

import { ServiceValidationError } from '../errors';

// Validates org-lens route IDs as the canonical org account id (18-char Salesforce
// Account.Id). Spec 002 (org-sfid-canonical-id): member-service v0.7.0 makes the SFID
// the canonical b2b_org uid, so the org-lens routes now carry the account id directly
// (no UUID, no UUID→SFID conversion). The route param is still named `:orgUid`/`:uid`
// for backward compatibility; the value space is the 18-char SFID.
export function assertOrgUid(orgUid: string | undefined, operation: string): asserts orgUid is string {
  if (!orgUid || typeof orgUid !== 'string') {
    throw ServiceValidationError.forField('orgUid', 'orgUid path parameter is required', { operation });
  }
  if (!SALESFORCE_ACCOUNT_ID_PATTERN.test(orgUid)) {
    throw ServiceValidationError.forField('orgUid', 'Invalid organization id format', { operation });
  }
}
