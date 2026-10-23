// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Writer-only re-enterable scalar prefill. No author, extracted/uploaded payloads or session capabilities. */
export interface MktgLastIntake {
  answers: Record<string, string>;
  documentCount: number;
  logoCount: number;
}

/** Null denotes confirmed absent history, never a failed read. */
export interface MktgLastIntakeResponse {
  intake: MktgLastIntake | null;
}

/** Read-only Sources summary; edits use the registered intake form controls. */
export interface MktgRunSourceField {
  key: string;
  label: string;
  value: string;
  origin: string;
}

/** BFF-only accepted Generate input, after validation and canonical project resolution. */
export interface MktgLastIntakeStart extends MktgLastIntake {
  project: string;
  agentId: string;
  runId: string;
}

/** Private last-writer-wins snapshot; deliberately separate from started-run/session records. */
export interface MktgStoredLastIntake extends MktgLastIntake {
  schema: string;
  project: string;
  agentKey: string;
  startedAt: string;
  runId: string;
}
