// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PendingActionType, TagSeverity } from '../interfaces/components.interface';

/**
 * Per-type tag severity for "My Pending Actions" rows. Read entries directly
 * (`PENDING_ACTION_SEVERITY.Vote`); do NOT wrap in a `(type: string) => TagSeverity` helper —
 * accepting `string` re-introduces the silent-fallback footgun the union type prevents.
 */
export const PENDING_ACTION_SEVERITY: Record<PendingActionType, TagSeverity> = {
  RSVP: 'warn', // amber — most common row + matches the row's amber background tint
  Vote: 'info', // blue
  Survey: 'warn', // amber — pending survey, action needed
  Agenda: 'secondary', // gray — informational read-before-meeting cue
  Submitted: 'success', // green — completed survey/feedback acknowledgement, distinguishes from pending Survey
};
