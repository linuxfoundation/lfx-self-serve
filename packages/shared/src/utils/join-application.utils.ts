// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { PendingActionItem } from '../interfaces/components.interface';

/**
 * True when a join-application row carries the full address (group + application UID) that identifies it
 * upstream. Rows without it can be shown but never acted on or cookie-hidden: an incomplete address would
 * collapse distinct requests onto one identifier.
 */
export function hasJoinApplicationAddress(item: Pick<PendingActionItem, 'committeeUid' | 'applicationUid'>): boolean {
  return !!item.committeeUid && !!item.applicationUid;
}

/**
 * True when a join-application row can be approved, rejected or dismissed from the dashboard: it needs the full
 * address plus the applicant email the confirmation copy and review calls refer to.
 */
export function isReviewableJoinApplication(item: Pick<PendingActionItem, 'committeeUid' | 'applicationUid' | 'applicationApplicantEmail'>): boolean {
  return hasJoinApplicationAddress(item) && !!item.applicationApplicantEmail;
}
