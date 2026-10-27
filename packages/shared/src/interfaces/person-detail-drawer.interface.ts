// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgAllEmployeeCommitteeMembership } from './org-people.interface';

/** The four content tabs of the shared person-detail drawer (LFXV2-2195). */
export type PersonDrawerTab = 'events' | 'training' | 'code' | 'governance';

/** Opener context for the shared person-detail drawer — header fields plus optional identity/fetch overrides. */
export interface PersonDrawerContext {
  /** Warehouse person_key; omitted by Board/Committee/Key Contact/Access openers, which pass `username` instead. */
  personKey?: string;
  /** Pre-loaded Governance seats when there is no personKey to fetch on. */
  governanceSeats?: OrgAllEmployeeCommitteeMembership[];
  name: string;
  title?: string | null;
  avatarUrl?: string | null;
  initials?: string;
  avatarColorClass?: string;
  /** LF username for openers without a personKey: resolved server-side to one roster person for activity, falling back to the company-address lookup. Never an email address. */
  username?: string | null;
  profileUrl?: string | null;
  sourceIconClass?: string | null;
  defaultTab?: PersonDrawerTab;
}

/** One rendered address line in the drawer header. */
export interface PersonDrawerEmail {
  email: string;
  isPrimary: boolean;
  /**
   * Precomputed `mailto:` target, or `null` when the address carries URI delimiters that would turn one
   * recipient into several (or into a header field). Such an address still renders — as plain text, and
   * still copyable — rather than as a link that mails the wrong person.
   */
  href: string | null;
}

/** Which person, at which org, a copy confirmation in the drawer header belongs to. */
export interface PersonDrawerCopiedAddress {
  context: PersonDrawerContext;
  orgUid: string | null | undefined;
  email: string;
}
