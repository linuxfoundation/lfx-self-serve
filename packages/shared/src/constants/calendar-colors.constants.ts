// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Hex color config per meeting type for FullCalendar events (Tailwind classes don't apply inside FullCalendar). */
export const MEETING_TYPE_COLORS: Record<string, { bg: string; border: string }> = {
  technical: { bg: '#7c3aed', border: '#6d28d9' },
  maintainers: { bg: '#2563eb', border: '#1d4ed8' },
  board: { bg: '#dc2626', border: '#b91c1c' },
  marketing: { bg: '#059669', border: '#047857' },
  legal: { bg: '#d97706', border: '#b45309' },
  other: { bg: '#4b5563', border: '#374151' },
  default: { bg: '#3b82f6', border: '#2563eb' },
};

/** Calendar color for cancelled meeting occurrences. */
export const CANCELLED_COLOR = { bg: '#9ca3af', border: '#6b7280' };

/** Calendar color for vote deadline events. */
export const VOTE_COLOR = { bg: '#f59e0b', border: '#d97706' };

/** Calendar color for survey cutoff events. */
export const SURVEY_COLOR = { bg: '#a855f7', border: '#9333ea' };
