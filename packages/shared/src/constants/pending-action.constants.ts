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

/** Per-type CTA button icon — conveys the action rather than the category. */
export const PENDING_ACTION_BUTTON_ICON: Record<PendingActionType, string> = {
  RSVP: 'fa-light fa-calendar-check',
  Vote: 'fa-light fa-check-to-slot',
  Survey: 'fa-light fa-clipboard-list',
  Agenda: 'fa-light fa-list',
  Submitted: 'fa-light fa-circle-check',
};

/** Human-friendly display labels for the pending-action category tag. */
export const PENDING_ACTION_LABEL: Record<PendingActionType, string> = {
  RSVP: 'Meeting RSVP',
  Vote: 'Vote',
  Survey: 'Survey',
  Agenda: 'Agenda',
  Submitted: 'Submitted',
};

/**
 * Pending-action fade-out + collapse animation duration in milliseconds. MUST match the CSS
 * transition in pending-actions.component.scss and pending-actions-drawer.component.scss.
 */
export const PENDING_ACTION_FADE_OUT_MS = 300;

/**
 * How long the skeleton placeholder sits in the completed row's slot before the next pending
 * action takes over, in milliseconds.
 */
export const PENDING_ACTION_SKELETON_HOLD_MS = 500;
