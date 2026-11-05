// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** A groups.io list in the IT OS Mailing List agent. Every list except main is a sub-list of main. */
export interface ItOsMailingList {
  name: string;
  /** 'main' for sub-lists, null for main itself. */
  parent: string | null;
  description: string;
  /** 'Public' or 'Private'. */
  visibility: string;
  /** PCC permission type: 'Announcement', 'Moderated Discussion' or 'Open Discussion'. */
  permission: string;
  subscribers: number;
  committee: string | null;
  /** PCC sync direction when linked to a committee: 'c2l', 'l2c' or 'manual'. */
  sync?: string;
  /** Voting statuses synced from a voting committee; empty means everyone. */
  filter?: string[];
  /** The sample subscribers we know by email. */
  members: string[];
  /** People the user chose to keep though they aren't on the committee. */
  keep?: string[];
  /** Email conflicts already shown to the user. */
  seenConflicts?: string[];
}

export interface ItOsCommitteeMember {
  name: string;
  email: string;
  /** Other emails LFX knows for the same person. */
  alt?: string[];
  /** Voting status on a voting committee. */
  status?: string;
}

export interface ItOsCommittee {
  name: string;
  voting: boolean;
  members: ItOsCommitteeMember[];
}

/** What a sync from the committee would change on a list (the PCC Sync Now preview, Committee → List). */
export interface ItOsSyncDiff {
  committee: ItOsCommittee;
  add: ItOsCommitteeMember[];
  remove: { email: string; staffRole?: string; staffName?: string }[];
  conflicts: (ItOsCommitteeMember & { listEmail: string })[];
  allConflicts: (ItOsCommitteeMember & { listEmail: string })[];
  kept: string[];
  /** Committee members left out by the list's voting filter. */
  filtered: number;
  inSync: boolean;
}

/** One row of the mailing lists table, worked out once per change rather than in the template. */
export interface ItOsMailingListRow {
  list: ItOsMailingList;
  diff: ItOsSyncDiff | null;
  /** Sync direction and summary, e.g. "Committee → List · 2 to add". Empty when the list isn't linked. */
  syncText: string;
  subscribers: string;
}
