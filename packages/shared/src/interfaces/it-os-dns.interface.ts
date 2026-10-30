// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { TagSeverity } from './components.interface';

/** One DNS record on a sample IT OS domain. */
export interface ItOsDnsRecord {
  id: number;
  type: string;
  name: string;
  content: string;
  ttl: number;
  /** Priority, for MX records. */
  prio?: number;
}

/** A sample project domain in the IT OS Domains & DNS agent. */
export interface ItOsDomain {
  name: string;
  primary?: boolean;
  registrar: string;
  /** Who serves DNS: 'DNSimple' (LF) or 'External'. */
  dns: string;
  /** True when the registrar the domain is leaving also hosts its DNS. */
  dnsAtRegistrar?: boolean;
  ns: string[];
  expires: string;
  autoRenew: boolean;
  locked: boolean;
  dnssec?: boolean;
  /** PCC-style state: 'Registered', 'Transfer code needed', 'Transfer pending' or 'Transfer failed'. */
  state: string;
  uses: string[];
  /** Records served by LF's DNS; null while DNS is hosted elsewhere. */
  records: ItOsDnsRecord[] | null;
  /** Records visible publicly while DNS is hosted elsewhere. */
  publicRecords?: ItOsDnsRecord[];
  /** Target of the registrar's URL forwarding service, which stops when DNS moves. */
  regForwarding?: string;
}

/** The fields a proposed change carries. */
export interface ItOsActionPayload {
  domain: string;
  id?: number;
  type?: string;
  name?: string;
  content?: string;
  ttl?: number;
  prio?: number;
  /** Auto-renew target state. */
  on?: boolean;
  ns?: string[];
}

/** Approval policy for one kind of change. */
export interface ItOsActionPolicy {
  describe: (payload: ItOsActionPayload) => string;
  needsApproval: (payload: ItOsActionPayload) => boolean;
  reason: (payload: ItOsActionPayload) => string;
  /** Whether the change adds to the project's monthly Essentials fee. */
  addsDomainFee?: boolean;
}

export interface ItOsProposal {
  key: string;
  payload: ItOsActionPayload;
  on: boolean;
}

export interface ItOsActionResult {
  title: string;
  /** Set when the change went to LF IT for approval instead of applying. */
  requestId?: string;
}

/** A set of proposed changes the user confirms or cancels. */
export interface ItOsPlan {
  proposals: ItOsProposal[];
  /** 'open', 'done' or 'cancelled'. */
  state: string;
  results?: ItOsActionResult[];
}

export interface ItOsChatAction {
  label: string;
  primary?: boolean;
  run: () => void;
}

export interface ItOsChatNote {
  /** 'info', 'ok' or 'warn'. */
  tone: string;
  text: string;
}

/** The transfer-code step: one code per domain plus the PCC attestations. */
export interface ItOsTransferForm {
  names: string[];
  codes: Record<string, string>;
  attestUnlocked: boolean;
  attestDnsElsewhere: boolean;
  /** Ask for the second attestation when DNS stays outside LF. */
  askDnsElsewhere: boolean;
}

/** Choose which waiting domains to transfer. */
export interface ItOsDomainPicker {
  domains: ItOsDomain[];
  picks: Record<string, boolean>;
}

/** Optional zone-file upload while copying records. */
export interface ItOsZoneUpload {
  names: string[];
  need: string[];
}

/** One message in an IT OS agent chat. Bot HTML is built from escaped text and sanitized by Angular on render. */
export interface ItOsChatMessage {
  fromUser: boolean;
  text?: string;
  html?: string;
  typing?: boolean;
  /** Progress steps shown one by one while the agent works. */
  steps?: string[];
  shown?: number;
  plan?: ItOsPlan;
  actions?: ItOsChatAction[];
  /** Set once one of the message's action buttons was used. */
  used?: boolean;
  picker?: ItOsDomainPicker;
  transferForm?: ItOsTransferForm;
  zoneUpload?: ItOsZoneUpload;
  /** Show the LF nameservers with a copy button. */
  nameservers?: boolean;
}

/** Per-domain transfer progress: whether LF manages DNS and the records to copy. */
export interface ItOsTransferProgress {
  /** 'yes' or 'no'. */
  manage: string;
  zone: ItOsDnsRecord[] | null;
}

/** Filter chip on the Details tab's domain list. */
export interface ItOsDomainFilter {
  id: string;
  label: string;
  matches: (domain: ItOsDomain) => boolean;
}

/** How a domain state is shown in the domain list. */
export interface ItOsDomainStateLabel {
  label: string;
  severity: TagSeverity;
}
