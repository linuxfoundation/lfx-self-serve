// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Format an ISO date/timestamp as `MMM yyyy` UTC; returns `'—'` for invalid input. */
export function formatMonthYearUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Format an ISO date/timestamp as `MMM dd, yyyy` UTC; returns `'—'` for invalid input. */
export function formatLongDateUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const month = SHORT_MONTHS[d.getUTCMonth()];
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${month} ${day}, ${d.getUTCFullYear()}`;
}
