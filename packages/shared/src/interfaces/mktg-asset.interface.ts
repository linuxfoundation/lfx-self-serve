// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MKTG_REPORT_V2 } from '../constants/mktg-asset.constants';
import type { MktgRevisionApproval, MktgRevisionAuthor, MktgRevisionResponse } from './mktg-document-store.interface';

/**
 * A source the agent could not read, in plain language; `detail` keeps the machine reason. `kind` is the agent's own
 * vocabulary (the Brand Kit narrows it to its enum); the family reads it as text.
 */
export interface MktgReportFailedSource {
  source: string;
  kind: string;
  reason: string;
  detail?: string;
}

/** An asset the agent looked for and did not find, with the plain reason and, when it knows one, the fix. `asset` is the agent's id. */
export interface MktgReportMissingAsset {
  asset: string;
  reason: string;
  fix?: string;
}

/** Something the agent noticed about what it read; `source` names where. `code` is the agent's own vocabulary. */
export interface MktgReportWarning {
  code: string;
  text: string;
  source?: string;
}

/** The three findings groups of a v2 report, written by the agent in plain language; the UI never rewrites a reason. */
export interface MktgReportFindings {
  sources_failed: MktgReportFailedSource[];
  missing_assets: MktgReportMissingAsset[];
  warnings: MktgReportWarning[];
}

/**
 * The agent's reviewer report. Sidecar metadata, never revision content. The v1 fields are always there; the v2
 * fields are optional, and an agent whose report carries `findings` gets the Brand Kit's Sources-tab groups and
 * approve dialog. A v1 report (no `findings`) renders as it always did.
 */
export interface MktgAssetReport {
  sources_read: string[];
  sources_failed: { name: string; reason: string }[];
  gaps: string[];
  notes: string;
  version?: typeof MKTG_REPORT_V2;
  findings?: MktgReportFindings;
}

/** The enums a v2-report validator may close: the Brand Kit's own; the family leaves them open. */
export interface MktgReportV2Enums {
  kinds?: readonly string[];
  assets?: readonly string[];
  codes?: readonly string[];
}

/** A failed source as the "Could not be read" card lists it: the source, the agent's plain reason and, when it gives one, the machine detail. */
export interface MktgReportFailedItem {
  title: string;
  text: string;
  detail: string | null;
}

/** A missing asset as the Missing assets card lists it: the asset's label (or its id as written), the reason and, when named, the fix. */
export interface MktgReportMissingItem {
  title: string;
  text: string;
  fix: string | null;
}

/** A warning as the Warnings card lists it: the text, and its source as a link only when it is an http(s) address. */
export interface MktgReportWarningItem {
  text: string;
  source: string | null;
  href: string | null;
}

/**
 * The Sources tab's findings from a report, in the agent's plain words: a v2 report's three groups; a v1 report's
 * legacy failed list in `failed`, nothing missing and no warning, with `hasFindings` false so the tab adds no card.
 */
export interface MktgReportFindingsView {
  hasFindings: boolean;
  failed: MktgReportFailedItem[];
  missing: MktgReportMissingItem[];
  warnings: MktgReportWarningItem[];
}

/**
 * What the document view hands the approve dialog: the viewed revision's report as the agent wrote it, and whether the
 * document is the Brand Kit's (read from the document type, never from the report's shape), whose dialog lists no Gaps
 * group.
 */
export interface MktgApproveGapsDialogData {
  report: MktgAssetReport;
  brandKit: boolean;
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
