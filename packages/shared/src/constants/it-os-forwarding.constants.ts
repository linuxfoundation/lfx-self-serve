// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ItOsChangePolicy, ItOsForward, ItOsForwardStandard, ItOsScenario } from '../interfaces';

// Sample data and rules for the IT OS Email Forwarding agent (#4257). Fictional project; nothing here
// is read from or sent to Forward Email. Forwarding changes apply right away: none need LF IT approval.

/** The project's staff in LFX, used to fill in where standard addresses go. */
export const IT_OS_SAMPLE_STAFF = {
  pms: [{ name: 'Priya Nair', email: 'pnair@example.org' }],
  ed: { name: 'Jordan Rivera', email: 'jrivera@example.org' },
  marketing: [] as { name: string; email: string }[],
  pr: [] as { name: string; email: string }[],
  sales: [] as { name: string; email: string }[],
};

/** LF's standard alias template for new projects. User-facing text only. */
export const IT_OS_FORWARD_STANDARD: ItOsForwardStandard[] = [
  { alias: 'support', tier: 'required', purpose: 'All general inbound inquiries. The primary public address.', note: 'Goes to Intercom only.' },
  {
    alias: 'operations',
    tier: 'required',
    purpose: 'Internal notifications, financial alerts and operational email.',
    note: "Internal only. Don't publish it.",
  },
  {
    alias: 'membership',
    tier: 'required',
    purpose: 'Automated notifications from LFX, billing and CRM tools, like new member alerts.',
    note: 'Internal only. Membership questions from people go to support@.',
  },
  { alias: 'marketing', tier: 'required', purpose: 'Marketing inquiries.', note: 'Goes to support@ if the project has no marketing staff.' },
  { alias: 'pr', tier: 'required', purpose: 'Press and PR inquiries.', note: 'Goes to support@ if the project has no PR staff.' },
  { alias: 'legal', tier: 'required', purpose: 'Legal inquiries.', note: 'PMs review before anything goes to LF Legal.' },
  { alias: 'events', tier: 'required', tbd: true, purpose: 'Event inquiries and logistics.', note: 'LF is still confirming where this goes.' },
  { alias: 'conduct', tier: 'required', purpose: 'Code of conduct reports.', note: 'Handled by people only, never by the support AI.' },
  {
    alias: 'security',
    tier: 'ifneeded',
    purpose: 'Security vulnerability reports, if the project has a security response process.',
    note: 'Named people only.',
    ask: 'security responders',
  },
  { alias: 'staff', tier: 'ifneeded', purpose: 'Internal distribution list.', note: 'Not public-facing.' },
  { alias: 'social', tier: 'ifneeded', purpose: 'Social media account logins only.', note: 'Gets an auto-reply: not monitored, use support@.' },
  { alias: 'sales', tier: 'optional', purpose: 'Only if a dedicated sales team works with the project.', ask: 'sales staff' },
  { alias: 'mentorship', tier: 'optional', purpose: 'Only if the project runs a mentorship program.' },
  { alias: 'cla', tier: 'optional', purpose: 'Only if the project uses CLAs.' },
  { alias: 'zoom', tier: 'optional', purpose: 'Zoom account login only.', note: 'Not public-facing.' },
  { alias: 'ap', tier: 'dont', instead: "LF's accounts payable address" },
  { alias: 'ar', tier: 'dont', instead: "LF's accounts receivable address" },
  { alias: 'info', tier: 'dont', instead: 'support@' },
  { alias: 'admin', tier: 'dont', instead: 'support@' },
  { alias: 'meetings', tier: 'dont', instead: 'support@' },
  { alias: 'ed', tier: 'dont', instead: 'operations@' },
  { alias: 'trademark', tier: 'dont', instead: 'legal@' },
  { alias: 'accountspayable', tier: 'dont', instead: "LF's accounts payable address" },
  { alias: 'accountsreceivable', tier: 'dont', instead: "LF's accounts receivable address" },
];

export const IT_OS_FORWARD_TIER_LABELS: Record<string, string> = {
  required: 'Required',
  ifneeded: 'If needed',
  optional: 'Optional',
  dont: 'Do not create',
};

export const IT_OS_FORWARD_SOURCE = 'Source: LF PMO standard alias template for new projects';

export const IT_OS_FORWARDING_SCENARIOS: ItOsScenario[] = [
  { id: 'new', label: 'Not set up yet' },
  { id: 'review', label: 'Set up, outside the guidelines' },
];
export const IT_OS_FORWARDING_DEFAULT_SCENARIO = 'new';

/** Existing forwards in the "outside the guidelines" situation. */
export const IT_OS_SAMPLE_FORWARDS: ItOsForward[] = [
  { alias: 'support', dest: 'jrivera@example.org' },
  { alias: 'operations', dest: 'pnair@example.org, jrivera@example.org' },
  { alias: 'membership', dest: 'operations@examplefoundation.org' },
  { alias: 'marketing', dest: 'support@examplefoundation.org' },
  { alias: 'conduct', dest: 'support@examplefoundation.org' },
  { alias: 'security', dest: 'security@lists.examplefoundation.org' },
  { alias: 'info', dest: 'jrivera@example.org' },
  { alias: 'ed', dest: 'jrivera@example.org' },
  { alias: 'admin', dest: 'pnair@example.org' },
  { alias: 'jobs', dest: 'jrivera@example.org' },
];

const PRIMARY = 'examplefoundation.org';
const forwardCount = (p: Record<string, unknown>): string => {
  const n = Array.isArray(p['aliases']) ? p['aliases'].length : 0;
  return n ? ` with ${n} ${n === 1 ? 'address' : 'addresses'}` : '';
};

export const IT_OS_FORWARDING_ACTIONS: Record<string, ItOsChangePolicy> = {
  'fwd.enable': {
    describe: (p) => `Turn on email forwarding for ${PRIMARY}${forwardCount(p)}`,
    needsApproval: () => false,
    reason: () => 'Forwarding on the primary domain applies right away.',
  },
  'fwd.addAlias': {
    describe: (p) => `Forward ${p['alias']}@${PRIMARY} to ${p['dest']}`,
    needsApproval: () => false,
    reason: () => 'Works as soon as you confirm.',
  },
  'fwd.editAlias': {
    describe: (p) => `Send ${p['alias']}@${PRIMARY} to ${p['dest']}`,
    needsApproval: () => false,
    reason: () => 'Easy to change back.',
  },
  'fwd.deleteAlias': {
    describe: (p) => `Delete forward ${p['alias']}@${PRIMARY}`,
    needsApproval: () => false,
    reason: () => 'Easy to recreate.',
  },
  'fwd.autoReply': {
    describe: (p) => `Replace ${p['alias']}@${PRIMARY} with an auto-reply pointing to ${p['instead']}`,
    needsApproval: () => false,
    reason: () => "The standard says an existing address it doesn't allow becomes an auto-reply.",
  },
};

export const IT_OS_FORWARDING_PAYLOAD_LABELS: Record<string, string> = {
  alias: 'Address',
  dest: 'Forwards to',
  instead: 'Points people to',
  aliases: 'Addresses',
};
