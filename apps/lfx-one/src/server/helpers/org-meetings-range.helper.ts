// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_MEETINGS_DEFAULT_TIME_RANGE, ORG_MEETINGS_SUPPORTED_TIME_RANGES } from '@lfx-one/shared/constants';
import type { OrgMeetingsSupportedTimeRange } from '@lfx-one/shared/interfaces';

import { ServiceValidationError } from '../errors';

const SUPPORTED = new Set<string>(ORG_MEETINGS_SUPPORTED_TIME_RANGES);

/**
 * Resolves the `range` query parameter to one of the seven bounded windows the warehouse is built
 * for. An omitted parameter takes the default; anything else outside the set — including `allTime`
 * and `custom`, which are valid members of the wider dropdown union but unbuilt for V1 — is a 400.
 *
 * Deliberately not a silent fallback: answering a request for `allTime` with `past365d` data would
 * render a plausible-looking number for a window the caller did not ask for.
 */
export function parseOrgMeetingsRange(rawRange: unknown, operation: string): OrgMeetingsSupportedTimeRange {
  // Only an absent parameter defaults. `?range=` is a supplied value, and answering it with the
  // default window would be the silent fallback this function exists to avoid.
  if (rawRange === undefined) {
    return ORG_MEETINGS_DEFAULT_TIME_RANGE;
  }
  if (typeof rawRange !== 'string' || !SUPPORTED.has(rawRange)) {
    throw ServiceValidationError.forField('range', `range must be one of: ${ORG_MEETINGS_SUPPORTED_TIME_RANGES.join(', ')}`, { operation });
  }
  return rawRange as OrgMeetingsSupportedTimeRange;
}
