// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Format an ISO date (or full ISO timestamp) as `MMM yyyy` in UTC — e.g.
 * `Jan 2024`. Returns `'—'` for invalid input so consumers can render the
 * em-dash placeholder without extra null-checks.
 */
export function formatMonthYearUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Format an ISO date (or full ISO timestamp) as `MMM dd, yyyy` in UTC — e.g.
 * `Jan 05, 2024`. Returns `'—'` for invalid input. Mirrors the Trainees /
 * Event Attendees / Contributors expanded-row date convention.
 */
export function formatLongDateUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const month = SHORT_MONTHS[d.getUTCMonth()];
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${month} ${day}, ${d.getUTCFullYear()}`;
}
