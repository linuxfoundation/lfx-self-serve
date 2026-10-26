// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ItOsActionPayload, ItOsActionPolicy, ItOsDomain, ItOsDomainFilter, ItOsDomainStateLabel } from '../interfaces';

// Sample data and rules for the IT OS Domains & DNS agent (#4257). Fictional project; nothing here
// is read from or sent to ITX, DNSimple or a registrar.

export const IT_OS_SAMPLE_PROJECT = {
  name: 'Example Foundation',
  primaryDomain: 'examplefoundation.org',
  githubOrg: 'example-foundation',
} as const;

export const IT_OS_LF_NAMESERVERS = ['ns1.dnsimple.com', 'ns2.dnsimple-edge.net', 'ns3.dnsimple.com', 'ns4.dnsimple-edge.org'];

/** PCC state of a domain that was added to the project but hasn't moved to LF. */
export const IT_OS_WAITING_STATE = 'Transfer code needed';

/** Label and tag severity per domain state. */
export const IT_OS_DOMAIN_STATE_LABELS: Record<string, ItOsDomainStateLabel> = {
  Registered: { label: 'With LF', severity: 'success' },
  'Transfer code needed': { label: 'Waiting to transfer', severity: 'warn' },
  'Transfer pending': { label: 'Transferring', severity: 'info' },
  'Transfer failed': { label: 'Transfer failed', severity: 'danger' },
};

// LF IT's fee amounts are internal, so this public repo shows placeholders. Staff see the placeholder;
// external project or community members are referred to the Formation Team, as in production.
export const IT_OS_FEES = {
  perDomain: '$X.XX',
  essentialsBase: '$Y.YY',
  pantheonMultisite: '$Z.ZZ',
} as const;
export const IT_OS_COST_NOTE =
  "From LF IT's IT fee schedule. Amounts are placeholders in this prototype; real amounts are internal and shown to LF staff only.";
export const IT_OS_FORMATION_TEXT = 'Fee questions for this project go to the Formation Team.';

export const IT_OS_DNS_SUGGESTIONS = [
  'Transfer all waiting domains',
  'Point events at our Pantheon site',
  'What do we pay for domains?',
  'Which domains renew in November?',
];

const RISKY_DELETE_TYPES = ['MX', 'NS', 'TXT'];

/** Which changes apply immediately and which go to LF IT for approval. */
export const IT_OS_DNS_ACTIONS: Record<string, ItOsActionPolicy> = {
  'dns.addRecord': {
    describe: (p) => `Add ${p.type} record ${p.name} on ${p.domain}`,
    needsApproval: () => false,
    reason: () => 'Routine change; easy to undo.',
  },
  'dns.editRecord': {
    describe: (p) => `Change ${p.type} record ${p.name} on ${p.domain}`,
    needsApproval: () => false,
    reason: () => 'Routine change; easy to undo.',
  },
  'dns.changeMailOrNs': {
    describe: (p) => `${p.id ? 'Change' : 'Add'} ${p.type} record ${p.name} on ${p.domain}`,
    needsApproval: () => true,
    reason: () => 'MX and NS records control where mail and DNS go. A mistake can stop mail delivery.',
  },
  'dns.deleteRecord': {
    describe: (p) => `Delete ${p.type} record ${p.name} on ${p.domain}`,
    needsApproval: (p) => RISKY_DELETE_TYPES.includes(p.type ?? ''),
    reason: (p) => (RISKY_DELETE_TYPES.includes(p.type ?? '') ? `Deleting ${p.type} records can break mail or domain verification.` : 'Routine change.'),
  },
  'domain.register': {
    describe: (p) => `Register ${p.domain}`,
    needsApproval: () => false,
    reason: () => 'Domains are registered on auto-renew, the LF standard.',
    addsDomainFee: true,
  },
  'domain.transfer': {
    describe: (p) => `Transfer ${p.domain} to the Linux Foundation`,
    needsApproval: () => false,
    reason: () => 'Moving project domains to LF is a required setup step.',
    addsDomainFee: true,
  },
  'domain.autoRenew': {
    describe: (p) => `Turn auto-renew ${p.on ? 'on' : 'off'} for ${p.domain}`,
    needsApproval: (p) => !p.on,
    reason: (p) => (p.on ? 'Auto-renew is the LF standard.' : 'Every LF domain auto-renews as a standard. Turning it off needs LF IT approval.'),
  },
  'domain.delegation': {
    describe: (p) => `Move nameservers for ${p.domain} away from LF`,
    needsApproval: () => true,
    reason: () => 'Moves where every record for the domain is served from.',
  },
};

/** Labels for the fields shown under each proposed change. */
export const IT_OS_PAYLOAD_LABELS: Partial<Record<keyof ItOsActionPayload, string>> = {
  domain: 'Domain',
  type: 'Type',
  name: 'Name',
  content: 'Value',
  prio: 'Priority',
  ns: 'Nameservers',
};

export const IT_OS_DOMAIN_FILTERS: ItOsDomainFilter[] = [
  { id: 'all', label: 'All', matches: () => true },
  { id: 'lf', label: 'With LF', matches: (d) => d.state === 'Registered' },
  { id: 'wait', label: 'Waiting to transfer', matches: (d) => d.state === IT_OS_WAITING_STATE },
  { id: 'xfer', label: 'Transferring', matches: (d) => d.state === 'Transfer pending' },
  { id: 'fail', label: 'Failed', matches: (d) => d.state === 'Transfer failed' },
];

const LF = IT_OS_LF_NAMESERVERS;
const AT_REGISTRAR_NS = ['ns1.exampleregistrar.net', 'ns2.exampleregistrar.net'];
const ELSEWHERE_NS = ['ns1.example-dns-host.net', 'ns2.example-dns-host.net'];
const redirect = (id: number) => [
  { id, type: 'URL', name: '@', content: 'https://examplefoundation.org', ttl: 3600 },
  { id: id + 1, type: 'URL', name: 'www', content: 'https://examplefoundation.org', ttl: 3600 },
  { id: id + 2, type: 'TXT', name: '_lfmanaged', content: 'lf_managed', ttl: 3600 },
];

const NAMED_DOMAINS: ItOsDomain[] = [
  {
    name: 'examplefoundation.org',
    primary: true,
    registrar: 'DNSimple',
    dns: 'DNSimple',
    ns: [...LF],
    expires: '2027-07-09',
    autoRenew: true,
    locked: true,
    state: 'Registered',
    uses: ['Website on Pantheon', 'Mailing lists'],
    records: [
      { id: 1, type: 'A', name: '@', content: '23.185.0.2', ttl: 3600 },
      { id: 2, type: 'AAAA', name: '@', content: '2620:12a:8000::2', ttl: 3600 },
      { id: 3, type: 'AAAA', name: '@', content: '2620:12a:8001::2', ttl: 3600 },
      { id: 4, type: 'URL', name: 'www', content: 'https://examplefoundation.org', ttl: 3600 },
      { id: 5, type: 'CNAME', name: 'docs', content: 'example-foundation.github.io', ttl: 3600 },
      { id: 6, type: 'CNAME', name: 'community', content: 'examplefoundation.hosted-by-discourse.com', ttl: 3600 },
      { id: 7, type: 'TXT', name: '@', content: 'google-site-verification=Hn4v8wLqP0sYt2cR', ttl: 3600 },
      { id: 8, type: 'TXT', name: '_dmarc', content: 'v=DMARC1; p=quarantine; rua=mailto:dmarc@examplefoundation.org', ttl: 3600 },
      { id: 9, type: 'TXT', name: '_gh-example-foundation-o', content: '7c1e9a24b3', ttl: 3600 },
      { id: 10, type: 'CAA', name: '@', content: '0 issue "letsencrypt.org"', ttl: 3600 },
      { id: 20, type: 'TXT', name: '_lfmanaged', content: 'lf_managed', ttl: 3600 },
    ],
  },
  {
    name: 'examplefdn.io',
    registrar: 'DNSimple',
    dns: 'DNSimple',
    ns: [...LF],
    expires: '2026-11-06',
    autoRenew: true,
    locked: true,
    state: 'Registered',
    uses: ['Short links'],
    records: redirect(11),
  },
  {
    name: 'example-conf.org',
    registrar: 'Example Registrar Inc.',
    dns: 'External',
    dnsAtRegistrar: true,
    ns: [...AT_REGISTRAR_NS],
    expires: '2027-08-02',
    autoRenew: true,
    locked: true,
    dnssec: false,
    state: IT_OS_WAITING_STATE,
    uses: ['Event site'],
    records: null,
    publicRecords: [
      { id: 0, type: 'A', name: '@', content: '198.51.100.24', ttl: 1800 },
      { id: 0, type: 'CNAME', name: 'www', content: 'example-conf.org', ttl: 1800 },
      { id: 0, type: 'CNAME', name: 'schedule', content: 'exampleconf2026.sched.com', ttl: 1800 },
      { id: 0, type: 'CNAME', name: 'cfp', content: 'exampleconf2026.sessionize.com', ttl: 1800 },
      { id: 0, type: 'MX', name: '@', content: 'mx1.mail.exampleregistrar.net', prio: 10, ttl: 1800 },
      { id: 0, type: 'MX', name: '@', content: 'mx2.mail.exampleregistrar.net', prio: 20, ttl: 1800 },
      { id: 0, type: 'TXT', name: '@', content: 'v=spf1 include:spf.mail.exampleregistrar.net ~all', ttl: 1800 },
      { id: 0, type: 'TXT', name: 'default._domainkey', content: 'v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQ…', ttl: 1800 },
    ],
  },
  {
    name: 'examplecon.com',
    registrar: 'Example Registrar Inc.',
    dns: 'External',
    dnsAtRegistrar: true,
    ns: [...AT_REGISTRAR_NS],
    expires: '2027-03-11',
    autoRenew: true,
    locked: true,
    dnssec: false,
    state: IT_OS_WAITING_STATE,
    uses: ['Redirects to example-conf.org'],
    records: null,
    regForwarding: 'https://example-conf.org',
    publicRecords: [
      { id: 0, type: 'A', name: '@', content: '203.0.113.80', ttl: 3600 },
      { id: 0, type: 'CNAME', name: 'www', content: 'examplecon.com', ttl: 3600 },
    ],
  },
  {
    name: 'examplesummit.org',
    registrar: 'Example Registrar Inc.',
    dns: 'External',
    dnsAtRegistrar: true,
    ns: [...AT_REGISTRAR_NS],
    expires: '2027-01-20',
    autoRenew: true,
    locked: false,
    dnssec: false,
    state: IT_OS_WAITING_STATE,
    uses: ['Event site'],
    records: null,
    publicRecords: [
      { id: 0, type: 'A', name: '@', content: '198.51.100.31', ttl: 3600 },
      { id: 0, type: 'CNAME', name: 'www', content: 'examplesummit.org', ttl: 3600 },
      { id: 0, type: 'CNAME', name: 'schedule', content: 'examplesummit.example-sched.com', ttl: 3600 },
    ],
  },
  {
    name: 'example-events.org',
    registrar: 'Other Registrar Co.',
    dns: 'External',
    dnsAtRegistrar: false,
    ns: [...ELSEWHERE_NS],
    expires: '2027-04-02',
    autoRenew: true,
    locked: false,
    dnssec: false,
    state: IT_OS_WAITING_STATE,
    uses: ['Events calendar'],
    records: null,
    publicRecords: [
      { id: 0, type: 'A', name: '@', content: '203.0.113.40', ttl: 3600 },
      { id: 0, type: 'CNAME', name: 'www', content: 'example-events.org', ttl: 3600 },
    ],
  },
  {
    name: 'exampleproj.io',
    registrar: 'Other Registrar Co.',
    dns: 'External',
    dnsAtRegistrar: false,
    ns: [...ELSEWHERE_NS],
    expires: '2027-06-15',
    autoRenew: true,
    locked: false,
    dnssec: true,
    state: IT_OS_WAITING_STATE,
    uses: ['Old project site'],
    records: null,
    publicRecords: [
      { id: 0, type: 'A', name: '@', content: '203.0.113.41', ttl: 3600 },
      { id: 0, type: 'CNAME', name: 'www', content: 'exampleproj.io', ttl: 3600 },
    ],
  },
  {
    name: 'example-training.org',
    registrar: 'Other Registrar Co.',
    dns: 'External',
    dnsAtRegistrar: false,
    ns: [...ELSEWHERE_NS],
    expires: '2027-09-09',
    autoRenew: true,
    locked: false,
    dnssec: false,
    state: IT_OS_WAITING_STATE,
    uses: ['Training site'],
    records: null,
    publicRecords: [
      { id: 0, type: 'A', name: '@', content: '203.0.113.42', ttl: 3600 },
      { id: 0, type: 'CNAME', name: 'www', content: 'example-training.org', ttl: 3600 },
      { id: 0, type: 'TXT', name: '@', content: 'google-site-verification=Tr4in1ng', ttl: 3600 },
    ],
  },
];

// Large foundations hold 50-100 domains, so seed 58 more that are already with LF.
const SEED_BASES = [
  'examplefoundation',
  'example-foundation',
  'examplefdn',
  'exampleproject',
  'example-project',
  'examplehq',
  'examplecommunity',
  'exampleopen',
  'getexample',
  'example-docs',
];
const SEED_TLDS = ['com', 'net', 'org', 'io', 'dev', 'ai', 'tech'];
const SEED_USES = [
  'Redirects to examplefoundation.org',
  'Redirects to examplefoundation.org',
  'Parked',
  'Redirects to examplefoundation.org',
  'Redirects to examplefoundation.org',
];
const SEEDED_DOMAINS: ItOsDomain[] = SEED_TLDS.flatMap((tld) => SEED_BASES.map((base) => `${base}.${tld}`))
  .filter((name) => !NAMED_DOMAINS.some((d) => d.name === name))
  .slice(0, 58)
  .map((name, index) => {
    const i = index + 1;
    return {
      name,
      registrar: 'DNSimple',
      dns: 'DNSimple',
      ns: [...LF],
      expires: `${2027 + (i % 2)}-${String(((i * 5) % 12) + 1).padStart(2, '0')}-${String(((i * 7) % 27) + 1).padStart(2, '0')}`,
      autoRenew: true,
      locked: true,
      state: 'Registered',
      uses: [SEED_USES[i % SEED_USES.length]],
      records: redirect(1000 + i * 3),
    };
  });

/** Starting sample domains. Copy before mutating: the agent's "Reset demo" restores from this list. */
export const IT_OS_SAMPLE_DOMAINS: ItOsDomain[] = [...NAMED_DOMAINS, ...SEEDED_DOMAINS];
