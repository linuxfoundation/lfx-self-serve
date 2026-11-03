// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ItOsChangePolicy, ItOsCommittee, ItOsMailingList } from '../interfaces';

// Sample data and rules for the IT OS Mailing List agent (#4257). Sync rules follow LF's PCC
// "Committee ↔ Mailing List Sync" docs. Fictional project; nothing here is read from or sent to groups.io.

export const IT_OS_LISTS_HOST = 'lists.examplefoundation.org';

// PCC creates main@lists.<primary domain> (public, Announcement). Every other list is a sub-list of main.
export const IT_OS_SAMPLE_LISTS: ItOsMailingList[] = [
  {
    name: 'main',
    parent: null,
    description: 'Announcements to the whole community',
    visibility: 'Public',
    permission: 'Announcement',
    subscribers: 1312,
    committee: null,
    members: ['alex.morgan@example.com', 'devi.k@example.net', 'tomas@example.org', 'ines.r@example.com', 'jrivera@example.org', 'pnair@example.org'],
  },
  {
    name: 'dev',
    parent: 'main',
    description: 'Developer discussion',
    visibility: 'Public',
    permission: 'Moderated Discussion',
    subscribers: 412,
    committee: null,
    members: ['alex.morgan@example.com', 'devi.k@example.net', 'tomas@example.org', 'ines.r@example.com'],
  },
  {
    name: 'tsc',
    parent: 'main',
    description: 'Technical Steering Committee',
    visibility: 'Private',
    permission: 'Moderated Discussion',
    subscribers: 6,
    committee: 'Technical Steering Committee',
    sync: 'manual',
    members: ['r.chen@example.com', 'kwame@example.org', 'aiko@example.com', 'neha.sharma@example.com', 'ben.osei@example.net', 'pnair@example.org'],
  },
  {
    name: 'governing-board',
    parent: 'main',
    description: 'Governing Board voting representatives',
    visibility: 'Private',
    permission: 'Moderated Discussion',
    subscribers: 3,
    committee: 'Governing Board',
    sync: 'c2l',
    filter: ['Voting Rep'],
    members: ['chair@example.com', 'board1@example.org', 'board2@example.net'],
  },
  {
    name: 'security',
    parent: 'main',
    description: 'Private vulnerability reports',
    visibility: 'Private',
    permission: 'Moderated Discussion',
    subscribers: 3,
    committee: null,
    members: ['r.chen@example.com', 'sokafor@example.com', 'neha.sharma@example.com'],
  },
];

/** Committees from LFX. */
export const IT_OS_SAMPLE_COMMITTEES: ItOsCommittee[] = [
  {
    name: 'Technical Steering Committee',
    voting: true,
    members: [
      { name: 'Rui Chen', email: 'r.chen@example.com', status: 'Voting Rep' },
      { name: 'Kwame Mensah', email: 'kwame@example.org', status: 'Voting Rep' },
      { name: 'Aiko Tanaka', email: 'aiko@example.com', status: 'Voting Rep' },
      { name: 'Neha Sharma', email: 'neha.sharma@example.com', status: 'Voting Rep' },
      { name: 'Ben Osei', email: 'ben@example.com', alt: ['ben.osei@example.net'], status: 'Voting Rep' },
      { name: 'Lena Fischer', email: 'lena.fischer@example.com', status: 'Voting Rep' },
      { name: 'Sam Okafor', email: 'sokafor@example.com', status: 'Observer' },
    ],
  },
  {
    name: 'Governing Board',
    voting: true,
    members: [
      { name: 'Morgan Lee', email: 'chair@example.com', status: 'Voting Rep' },
      { name: 'Dana Park', email: 'board1@example.org', status: 'Voting Rep' },
      { name: 'Chris Adeyemi', email: 'board2@example.net', status: 'Voting Rep' },
      { name: 'Sasha Ivanova', email: 'alt@example.org', status: 'Alternate Voting Rep' },
    ],
  },
  {
    name: 'Security Response Team',
    voting: false,
    members: [
      { name: 'Rui Chen', email: 'r.chen@example.com' },
      { name: 'Sam Okafor', email: 'sokafor@example.com' },
      { name: 'Neha Sharma', email: 'neha.sharma@example.com' },
      { name: 'Lena Fischer', email: 'lena.fischer@example.com' },
    ],
  },
  {
    name: 'Outreach Committee',
    voting: false,
    members: [
      { name: 'Ines Romero', email: 'ines.r@example.com' },
      { name: 'Tomas Novak', email: 'tomas@example.org' },
    ],
  },
];

export const IT_OS_SYNC_LABELS: Record<string, string> = {
  c2l: 'Committee → List',
  l2c: 'List → Committee',
  manual: 'Manual',
};

export const IT_OS_LIST_PERMISSION_TEXT: Record<string, string> = {
  Announcement: 'only moderators can post',
  'Moderated Discussion': "new members' posts are held for a moderator until approved",
  'Open Discussion': 'new members can post right away, so moderators approve who joins',
};

/** Sample paste for the bulk add demo: duplicates, an invalid address and people already on dev. */
export const IT_OS_BULK_SAMPLE = [
  'Alex Morgan <alex.morgan@example.com>',
  'priya.s@example.org',
  'wei.zhang@example.com, maria.g@example.net',
  'Jonas Berg,jonas.berg@example.org',
  'devi.k@example.net',
  'li.na@example',
  'priya.s@example.org',
  'omar.h@example.org',
  'kenji@example.com',
  'Fatima Diallo <fatima.d@example.net>',
  'lucas.m@example.com',
  'anna.k@example.org',
].join('\n');

export const IT_OS_MAILING_LIST_SUGGESTIONS = [
  'Create a sub-list called events',
  'Bulk add subscribers to dev',
  'Is tsc in sync with its committee?',
  'Link security to the Security Response Team',
];

const listAddress = (name: unknown): string => `${name}@${IT_OS_LISTS_HOST}`;

export const IT_OS_MAILING_LIST_ACTIONS: Record<string, ItOsChangePolicy> = {
  'ml.createList': {
    describe: (p) => `Create ${p['parent'] ? 'sub-list' : 'list'} ${listAddress(p['name'])}`,
    needsApproval: () => false,
    reason: () => 'Routine change.',
  },
  'ml.addMember': {
    describe: (p) => {
      const emails = Array.isArray(p['emails']) ? p['emails'] : [];
      return p['who'] ? `Add ${p['who']} to ${p['list']}` : `Add ${emails.length} ${emails.length === 1 ? 'subscriber' : 'subscribers'} to ${p['list']}`;
    },
    needsApproval: () => false,
    reason: () => 'Routine change.',
  },
  'ml.removeMember': {
    describe: (p) => `Remove ${p['email']} from ${p['list']}`,
    needsApproval: () => false,
    reason: () => 'Routine change.',
  },
  'ml.setSync': {
    describe: (p) => `Set ${p['list']} to ${IT_OS_SYNC_LABELS[String(p['sync'])]} sync`,
    needsApproval: () => false,
    reason: () => "Only changes how future membership changes flow. Existing members aren't affected.",
  },
  'ml.linkCommittee': {
    describe: (p) => `Link ${p['list']} to ${p['committee']} (${IT_OS_SYNC_LABELS[String(p['sync'])]})`,
    needsApproval: () => false,
    reason: () => "Future membership changes sync automatically. Existing members aren't affected.",
  },
};

export const IT_OS_MAILING_LIST_PAYLOAD_LABELS: Record<string, string> = {
  name: 'Name',
  parent: 'Under',
  description: 'Description',
  visibility: 'Visibility',
  permission: 'Permission',
  list: 'List',
  emails: 'Emails',
  email: 'Email',
  committee: 'Committee',
};
