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
  /**
   * The contact address the opening row already displays.
   *
   * DISPLAY ONLY — never a lookup key. This field previously fed an address-keyed company-emails
   * request; that path was withdrawn, because once it returns real data it becomes an interface that,
   * given any address, returns the other addresses the same human holds. Address-to-person resolution
   * is separately prohibited on evidence of false links between unrelated people.
   *
   * To look anything up for this person, use `personKey` or `username`.
   */
  email?: string;
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
