// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { COMMITTEE_ENGAGEMENT_RATE_THRESHOLDS } from '../constants/committee-engagement.constants';
import type { CommitteeEngagementClassification } from '../interfaces/committee-engagement.interface';

/** `attended / invited`, 0 when nobody was invited, rounded to 2 decimal places. */
export function computeCommitteeEngagementRate(attended: number, invited: number): number {
  if (invited <= 0) return 0;
  return Math.round((attended / invited) * 100) / 100;
}

/**
 * A member never invited in the window and a member invited but who attended nothing are both
 * `Inactive` — the first has no signal, the second has a negative one, but neither is a "low but
 * present" engagement level like `Low` is meant to capture.
 */
export function classifyCommitteeEngagement(attended: number, invited: number): CommitteeEngagementClassification {
  const rate = computeCommitteeEngagementRate(attended, invited);
  if (invited <= 0 || rate <= 0) return 'Inactive';
  if (rate >= COMMITTEE_ENGAGEMENT_RATE_THRESHOLDS.high) return 'High';
  if (rate >= COMMITTEE_ENGAGEMENT_RATE_THRESHOLDS.medium) return 'Medium';
  return 'Low';
}
