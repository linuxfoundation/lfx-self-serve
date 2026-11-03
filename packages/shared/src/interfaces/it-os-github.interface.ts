// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export interface ItOsGithubMember {
  login: string;
  name: string;
  /** 'Owner' or 'Member'. */
  role: string;
}

export interface ItOsGithubInvite {
  /** 'Owner' or 'Member'. */
  role: string;
  sent: string;
}

/** One of the project's GitHub orgs in the IT OS GitHub Org agent. */
export interface ItOsGithubOrg {
  org: string;
  /** What thelinuxfoundation is in the org: 'none', 'invited', 'expired', 'member' or 'owner'. */
  lf: string;
  /** The pending or expired invitation for thelinuxfoundation. */
  invite: ItOsGithubInvite | null;
  /** The org's personal access token policy: 'ok', 'disallowed', or 'expiry' (tokens must expire; LF's doesn't). */
  pat: string;
  /** False when GitHub has no org by this name (PCC linked_status not_created). */
  exists: boolean;
  members: ItOsGithubMember[];
}
