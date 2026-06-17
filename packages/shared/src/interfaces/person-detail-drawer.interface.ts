// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgAllEmployeeCommitteeMembership } from './org-people.interface';

/** The four content tabs of the shared person-detail drawer (LFXV2-2195). */
export type PersonDrawerTab = 'events' | 'training' | 'code' | 'governance';

/** Opener context for the shared person-detail drawer — header fields plus optional identity/fetch overrides. */
export interface PersonDrawerContext {
  /** Warehouse person_key; omitted when Governance is pre-supplied (Board/Committee tabs). */
  personKey?: string;
  /** Pre-loaded Governance seats when there is no personKey to fetch on. */
  governanceSeats?: OrgAllEmployeeCommitteeMembership[];
  name: string;
  title?: string | null;
  avatarUrl?: string | null;
  initials?: string;
  avatarColorClass?: string;
  username?: string | null;
  profileUrl?: string | null;
  sourceIconClass?: string | null;
  defaultTab?: PersonDrawerTab;
}
