// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MktgRevisionApproval, MktgRevisionAuthor, MktgRevisionResponse } from './mktg-document-store.interface';

/** The agent's reviewer report. Sidecar metadata, never revision content. */
export interface MktgAssetReport {
  sources_read: string[];
  sources_failed: { name: string; reason: string }[];
  gaps: string[];
  notes: string;
}

/** Display-only header data; names are already resolved by the server. */
export interface MktgAssetHeaderMetadata {
  version: number | null;
  agentName: string;
  createdAt: string | null;
  approval: MktgRevisionApproval | null;
  otherApprovedCurrent: { number: number; approvedBy: MktgRevisionAuthor | null } | null;
}

/** Read state for the approved payload, kept separate from the viewed draft. */
export interface MktgApprovedRevisionState {
  loading: boolean;
  revision: MktgRevisionResponse | null;
  error: string;
}
