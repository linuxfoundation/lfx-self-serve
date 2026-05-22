// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MembershipDetailTab } from '../interfaces/org-memberships.interface';

// TODO: replace with real API call latency once write endpoints are wired (FR-018b).
export const SIMULATED_SAVE_DELAY_MS = 400;

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
