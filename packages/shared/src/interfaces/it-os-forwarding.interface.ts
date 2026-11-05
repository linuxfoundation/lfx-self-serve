// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ItOsDomainStateLabel } from './it-os-dns.interface';

/** One address in LF's standard alias template for new projects. */
export interface ItOsForwardStandard {
  alias: string;
  /** 'required', 'ifneeded', 'optional' or 'dont'. */
  tier: string;
  purpose?: string;
  note?: string;
  /** Who it goes to has to come from the user, for example "security responders". */
  ask?: string;
  /** Where it goes is still being confirmed by LF. */
  tbd?: boolean;
  /** For 'dont' addresses: what to use instead. */
  instead?: string;
}

/** One forward on the project's primary domain. */
export interface ItOsForward {
  alias: string;
  dest: string;
  /** Set when the address was replaced by an auto-reply pointing here. */
  autoReply?: string;
}

/** Where an existing forward doesn't match the standard, and the suggested fix. */
export interface ItOsForwardFinding {
  alias: string;
  /** 'bad' (not allowed), 'warn' (needs a fix) or 'info' (worth a look). */
  tone: string;
  issue: string;
  fix: string;
  /** The change that fixes it, when one can be proposed. */
  change?: { key: string; payload: Record<string, string> };
}

/** One existing forward as the forwards table shows it. */
export interface ItOsForwardRow {
  forward: ItOsForward;
  tier: string;
  /** The suggested fix, when the forward is outside the guidelines. */
  fix?: string;
  status: ItOsDomainStateLabel;
}

/** One standard address that isn't set up, as the forwards table shows it. */
export interface ItOsForwardMissingRow {
  standard: ItOsForwardStandard;
  destination: string;
}
