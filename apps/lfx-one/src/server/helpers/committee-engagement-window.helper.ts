// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { COMMITTEE_ENGAGEMENT_DEFAULT_WINDOW, COMMITTEE_ENGAGEMENT_SUPPORTED_WINDOWS } from '@lfx-one/shared/constants';
import type { CommitteeEngagementWindow } from '@lfx-one/shared/interfaces';

import { ServiceValidationError } from '../errors';

const SUPPORTED = new Set<string>(COMMITTEE_ENGAGEMENT_SUPPORTED_WINDOWS);

/**
 * Resolves the `window` query parameter to one of the three windows the committee-engagement
 * warehouse model is built for. An omitted parameter takes the default; anything else outside the
 * set is a 400 — mirrors `parseOrgMeetingsRange`'s "never a silent fallback" rule, since answering
 * a `?window=90d` request with 30d data would render a plausible-looking but wrong number.
 */
export function parseCommitteeEngagementWindow(rawWindow: unknown, operation: string): CommitteeEngagementWindow {
  if (rawWindow === undefined) {
    return COMMITTEE_ENGAGEMENT_DEFAULT_WINDOW;
  }
  if (typeof rawWindow !== 'string' || !SUPPORTED.has(rawWindow)) {
    throw ServiceValidationError.forField('window', `window must be one of: ${COMMITTEE_ENGAGEMENT_SUPPORTED_WINDOWS.join(', ')}`, { operation });
  }
  return rawWindow as CommitteeEngagementWindow;
}
