// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { z } from 'zod';
import type { envelopeSchema, tabsSchema, memberRankingRowSchema } from '../server/member-360-schema.utils';
import type { formInputSchema, trackerSchema, priorRunSchema } from '../server/member-360.utils';
import type { MktgRunActivity, MktgRunSessionResponse } from './mktg-run.interface';
import type { CATEGORY_KEYS, MEMBER_360_FINALIZE_RECEIPT_ID } from '../constants/member-360.constants';
export type Member360Envelope = z.infer<typeof envelopeSchema>;
export type Member360Tabs = z.infer<typeof tabsSchema>;
export type Member360RankingRow = z.infer<typeof memberRankingRowSchema>;
export type Member360FormInput = z.infer<typeof formInputSchema>;
export type Member360Tracker = z.infer<typeof trackerSchema>;
export type Member360PriorRun = z.infer<typeof priorRunSchema>;
export type Member360Category = (typeof CATEGORY_KEYS)[number];
/** Agent 2.1.1 compact finalize receipt; its hash covers tabs only. */
export interface Member360FinalizeReceipt {
  finalize_receipt: typeof MEMBER_360_FINALIZE_RECEIPT_ID;
  ok: true;
  sha256: string;
  rows: { ranking: number; evidence: number };
  partial: boolean;
  violations?: string[];
}
export interface Member360GenerateRequest {
  project: string;
  window?: '12' | '6' | 'year';
  compare?: boolean;
  trackers?: Member360Tracker[];
}
export interface Member360GenerationStart {
  sessionId: string;
  documentId: string;
}
export interface Member360TrackerUpload {
  id: number;
  tracker: Member360Tracker;
  format: string;
  summary: string;
}
export interface Member360Session extends MktgRunSessionResponse {
  documentId: string;
}
export interface Member360PendingRun {
  user: string;
  project: string;
  session: Member360Session;
  startedAt: number;
}
export type Member360FailureReason = 'no_edit_access' | 'agent_stopped';
export interface Member360Result {
  status: 'pending' | 'ready' | 'needs_input' | 'failed';
  /** Ephemeral, redacted terminal agent text; never stored as a document. */
  message?: string;
  /** Server-classified failure; clients default older responses to agent_stopped. */
  reason?: Member360FailureReason;
  /** Plain activity sentences from trusted session events while the run is pending. */
  activity?: MktgRunActivity[];
  documentId?: string;
  stored?: boolean;
}
export interface Member360WorkbookDownload {
  bytes: Uint8Array;
  filename: string;
}
export interface Member360HeatCell {
  label: string;
  value: number | null;
  color: string;
}
export interface Member360SortColumn {
  key: keyof Member360RankingRow | null;
  label: string;
}
export interface Member360SummaryCard {
  key: string;
  label: string;
  value: string;
  note: string;
}
export interface Member360RankingFilters {
  tier: string;
  owner: string;
  search: string;
}
export interface Member360DisplayRow {
  key: number;
  trendText: string;
  trendClass: string;
  trendAriaLabel: string | null;
  trendState: string;
  member: Member360RankingRow;
  heat: Member360HeatCell[];
  renewalClass: string;
  tierClass: string;
  rationale: string;
  evidence: Member360Tabs['evidence'];
}
