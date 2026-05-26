// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MembershipDetailTab } from '../interfaces/org-memberships.interface';

// TODO: replace with real API call latency once write endpoints are wired (FR-018b).
export const SIMULATED_SAVE_DELAY_MS = 400;

/** Spec 018 FR-032a: CSV header row, 9 columns, in this exact order. */
export const MEMBERSHIP_AGREEMENT_CSV_HEADERS = [
  'Organization',
  'Foundation',
  'Agreement Name',
  'Signed Date',
  'Format',
  'Status',
  'Tier',
  'Current',
  'Download URL',
] as const;

export const TAB_FRAGMENTS: readonly MembershipDetailTab[] = ['key-contacts', 'board', 'docs', 'governance'] as const;
export const DEFAULT_TAB: MembershipDetailTab = 'key-contacts';

// Also accepts 'board-committee' → 'board' and 'documentation' → 'docs' aliases.
const TAB_FRAGMENT_ALIASES: Readonly<Record<string, MembershipDetailTab>> = {
  'board-committee': 'board',
  documentation: 'docs',
};

export function fragmentToTab(fragment: string | null | undefined): MembershipDetailTab {
  const candidate = (fragment ?? '').toLowerCase().trim();
  if ((TAB_FRAGMENTS as readonly string[]).includes(candidate)) {
    return candidate as MembershipDetailTab;
  }
  return TAB_FRAGMENT_ALIASES[candidate] ?? DEFAULT_TAB;
}
