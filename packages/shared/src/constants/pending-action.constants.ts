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

/**
 * Per-type FontAwesome icon for the row's CTA button (e.g. "Cast Vote", "Submit Survey").
 * Kept distinct from the tag icon so the button conveys the action rather than the category.
 */
export const PENDING_ACTION_BUTTON_ICON: Record<PendingActionType, string> = {
  RSVP: 'fa-light fa-calendar-check',
  Vote: 'fa-light fa-check-to-slot',
  Survey: 'fa-light fa-clipboard-list',
  Agenda: 'fa-light fa-list',
  Submitted: 'fa-light fa-circle-check',
};

/**
 * Per-type display label rendered in the row's category tag. The underlying `type` union remains
 * the semantic identifier — this map provides a human-friendly label without touching it.
 */
export const PENDING_ACTION_LABEL: Record<PendingActionType, string> = {
  RSVP: 'Meeting RSVP',
  Vote: 'Vote',
  Survey: 'Survey',
  Agenda: 'Agenda',
  Submitted: 'Submitted',
};
