// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PollStatus, VoteResponseStatus } from '../enums/poll.enum';
import { TagSeverity } from '../interfaces/components.interface';

/**
 * Poll status display labels
 * @description Human-readable labels for poll statuses
 */
export const POLL_STATUS_LABELS = {
  [PollStatus.ACTIVE]: 'Active',
  [PollStatus.DISABLED]: 'Disabled',
  [PollStatus.ENDED]: 'Ended',
} as const;

/**
 * Poll status severity mappings
 * @description Maps poll statuses to tag severity levels for styling
 */
export const POLL_STATUS_SEVERITY: Record<PollStatus, TagSeverity> = {
  [PollStatus.ACTIVE]: 'info',
  [PollStatus.DISABLED]: 'warn',
  [PollStatus.ENDED]: 'secondary',
} as const;

/**
 * Vote response status display labels
 * @description Human-readable labels for vote response statuses
 */
export const VOTE_RESPONSE_STATUS_LABELS = {
  [VoteResponseStatus.RESPONDED]: 'Responded',
  [VoteResponseStatus.AWAITING_RESPONSE]: 'Awaiting Response',
} as const;

/**
 * Vote response status severity mappings
 * @description Maps vote response statuses to tag severity levels for styling
 */
export const VOTE_RESPONSE_STATUS_SEVERITY: Record<VoteResponseStatus, TagSeverity> = {
  [VoteResponseStatus.RESPONDED]: 'success',
  [VoteResponseStatus.AWAITING_RESPONSE]: 'info',
} as const;

/**
 * Combined vote status labels
 * @description Combines poll status and user response into single status
 * - Open: Active poll, user has not responded
 * - Submitted: Active poll, user has responded
 * - Closed: Poll has ended (regardless of user response)
 */
export const COMBINED_VOTE_STATUS_LABELS = {
  open: 'Open',
  submitted: 'Submitted',
  closed: 'Closed',
} as const;

/**
 * Combined vote status severity mappings
 * @description Maps combined vote statuses to tag severity levels for styling
 */
export const COMBINED_VOTE_STATUS_SEVERITY = {
  open: 'info' as TagSeverity,
  submitted: 'success' as TagSeverity,
  closed: 'secondary' as TagSeverity,
} as const;
