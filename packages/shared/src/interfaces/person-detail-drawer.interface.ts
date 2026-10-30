// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgCommitFilters } from './org-commit-filters.interface';
import type { OrgLensTimeRange } from './org-lens-time-range.interface';
import type { OrgKeyContactAssignment } from './org-people-key-contacts.interface';
import type { OrgAllEmployeeCommitteeMembership, OrgPeopleDirectoryView, OrgTeamMembersFilter } from './org-people.interface';

/** The five content tabs of the shared person-detail drawer (LFXV2-2195). */
export type PersonDrawerTab = 'events' | 'training' | 'code' | 'governance' | 'key-contacts';

/** Opener context for the shared person-detail drawer — header fields plus optional identity/fetch overrides. */
export interface PersonDrawerContext {
  /** Warehouse person_key; omitted by Board/Committee/Key Contact/Access openers, which pass `username` instead. */
  personKey?: string;
  /** Pre-loaded Governance seats when there is no personKey to fetch on. */
  governanceSeats?: OrgAllEmployeeCommitteeMembership[];
  /**
   * Pre-loaded key contact assignments from an opener that already holds them (the Key Contacts tab groups
   * them per person). Supplied seats render without waiting on — and instead of — the per-person fetch, the
   * same way `governanceSeats` does.
   */
  keyContactAssignments?: OrgKeyContactAssignment[];
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
  /** `true` when the opener lists the person as a former employee of the account; the header shows a "Former employee" badge. */
  isFormer?: boolean;
  /** The live directory the opener listed the person in; a live-only person's company-email lookup reads that (warm) directory first. */
  directoryView?: OrgPeopleDirectoryView;
  /** The range the opener lists the person in; the Code tab's Maintainer pills follow it (the Org Lens default range when omitted). */
  range?: OrgLensTimeRange;
  /**
   * The opener's project type and code count (Code Contributions, People → Contributors, People → All Employees;
   * lfx-self-serve#4404). With it, the Code tab counts in `range` exactly what the opener's row counts; without it,
   * the Code tab shows every commit of the trailing 12 months.
   */
  codeFilters?: OrgCommitFilters;
  /** The opener's Team members pick, sent with `codeFilters` (lfx-self-serve#4685): under exclude a CDP team member's Code tab is empty. */
  teamMembers?: OrgTeamMembersFilter;
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

/** One rendered row of the drawer's Key Contacts tab — role, its pill classes, and the foundation it is held for. */
export interface PersonDrawerKeyContactRow {
  contactUid: string;
  role: string;
  pillClass: string;
  foundationLabel: string;
}
