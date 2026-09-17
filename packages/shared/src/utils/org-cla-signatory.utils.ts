// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_CLA_AUTHORITY_NAME_MAX_LENGTH, ORG_CLA_AUTHORITY_NAME_MIN_LENGTH } from '../constants/cla.constants';
import { codePointLength } from './string.utils';

/**
 * Validates an already-trimmed signatory name for the send-by-email request (#2365).
 *
 * Shared so the dialog's Send control and the BFF refuse the same values. The bounds are the
 * producer's own: below the minimum, generated request validation upstream rejects the POST with
 * a status this BFF does not relabel, so the dialog would show its generic failure copy with
 * nothing to act on.
 *
 * Measured in code points, not `String.length`, because that is what the producer measures —
 * go-openapi's `MinLength` counts with `utf8.RuneCount`. The two disagree on any non-BMP
 * character: a one-rune name such as `𠮷` is two UTF-16 units, so a `String.length` check would
 * pass it and hand upstream exactly the rejection this predicate exists to prevent. For the same
 * reason the field carries no native `maxlength` and the form bounds the name with
 * `maxCodePointsValidator`: a UTF-16 cap would stop a non-BMP name at half the length this
 * predicate accepts, refusing from the input a name the producer would take.
 *
 * Trimming is the caller's, because both call sites trim to build the request anyway and a
 * predicate that re-trimmed would answer for a string neither of them is sending.
 */
export function isSendableAuthorityName(trimmedName: string): boolean {
  const length = codePointLength(trimmedName);
  return length >= ORG_CLA_AUTHORITY_NAME_MIN_LENGTH && length <= ORG_CLA_AUTHORITY_NAME_MAX_LENGTH;
}
