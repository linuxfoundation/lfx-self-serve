// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ItOsChangePolicy, ItOsDomainStateLabel, ItOsGithubOrg, ItOsScenario } from '../interfaces';
import { IT_OS_SAMPLE_PROJECT } from './it-os-dns.constants';

// Sample data and rules for the IT OS GitHub Org agent (#4257). Causes and fixes follow LF's PCC source
// control docs. Fictional project; nothing here is read from or sent to GitHub.

/** LF's GitHub account. It has to be an owner of every LF project GitHub org. */
export const IT_OS_LF_GITHUB_ACCOUNT = 'thelinuxfoundation';

/** The project's first org, before any sample situation is applied. */
export const IT_OS_SAMPLE_GITHUB_ORG: ItOsGithubOrg = {
  org: IT_OS_SAMPLE_PROJECT.githubOrg,
  lf: 'member',
  invite: null,
  pat: 'ok',
  exists: true,
  members: [
    { login: 'jrivera', name: 'Jordan Rivera', role: 'Owner' },
    { login: 'pnair', name: 'Priya Nair', role: 'Owner' },
    { login: 'thelinuxfoundation', name: 'The Linux Foundation', role: 'Member' },
    { login: 'sokafor', name: 'Sam Okafor', role: 'Member' },
    { login: 'r-chen', name: 'Rui Chen', role: 'Member' },
  ],
};

export const IT_OS_GITHUB_SCENARIOS: ItOsScenario[] = [
  { id: 'none', label: 'Not invited' },
  { id: 'invited-member', label: 'Invited as a member' },
  { id: 'expired', label: 'Invitation expired' },
  { id: 'member', label: 'Member, not owner' },
  { id: 'pat', label: 'Owner, token blocked' },
  { id: 'gone', label: 'Org not found' },
  { id: 'owner', label: 'All set' },
];
export const IT_OS_GITHUB_DEFAULT_SCENARIO = 'member';

/** Org fields per sample situation, applied to the project's first org. */
export const IT_OS_GITHUB_SCENARIO_STATE: Record<string, Partial<ItOsGithubOrg>> = {
  none: { lf: 'none' },
  'invited-member': { lf: 'invited', invite: { role: 'Member', sent: 'Oct 14' } },
  expired: { lf: 'expired', invite: { role: 'Owner', sent: 'Oct 2' } },
  member: { lf: 'member' },
  pat: { lf: 'owner', pat: 'expiry' },
  gone: { exists: false, lf: 'none' },
  owner: { lf: 'owner' },
};

/** PCC linked_status labels: full | partial | none | not_created. */
export const IT_OS_GITHUB_LINKED_LABELS: Record<string, ItOsDomainStateLabel> = {
  full: { label: 'Full connection', severity: 'success' },
  partial: { label: 'Partial connection', severity: 'warn' },
  none: { label: 'Not connected', severity: 'danger' },
  not_created: { label: 'Org not found', severity: 'danger' },
};

export const IT_OS_GITHUB_LF_LABELS: Record<string, string> = {
  none: 'Not in the org',
  invited: 'Invitation pending',
  expired: 'Invitation expired',
  member: 'Member',
  owner: 'Owner',
};

export const IT_OS_GITHUB_ACTIONS: Record<string, ItOsChangePolicy> = {
  'gh.addOrg': {
    describe: (p) => `Connect GitHub org ${p['org']} to ${IT_OS_SAMPLE_PROJECT.name}`,
    needsApproval: () => false,
    reason: () => "LF can only accept an invitation to an org that's connected to the project.",
  },
};

export const IT_OS_GITHUB_PAYLOAD_LABELS: Record<string, string> = { org: 'GitHub org' };
