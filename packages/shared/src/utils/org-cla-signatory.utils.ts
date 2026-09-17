// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_CLA_AUTHORITY_NAME_MAX_LENGTH, ORG_CLA_AUTHORITY_NAME_MIN_LENGTH } from '../constants/cla.constants';

/**
 * Whether an already-trimmed signatory name is one send-by-email (#2365) can post.
 *
 * Shared so the dialog's Send control and the BFF refuse the same values. The bounds are the
 * producer's own: below the minimum, generated request validation upstream rejects the POST with
 * a status this BFF does not relabel, so the dialog would show its generic failure copy with
 * nothing to act on.
 *
 * Trimming is the caller's, because both call sites trim to build the request anyway and a
 * predicate that re-trimmed would answer for a string neither of them is sending.
 */
export function isSendableAuthorityName(trimmedName: string): boolean {
  return trimmedName.length >= ORG_CLA_AUTHORITY_NAME_MIN_LENGTH && trimmedName.length <= ORG_CLA_AUTHORITY_NAME_MAX_LENGTH;
}
