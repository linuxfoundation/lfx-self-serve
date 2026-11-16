// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_ACCEPTED_KEYS } from '../constants/mktg-asset.constants';
import { MKTG_DOCUMENT_TYPES } from '../constants/mktg-document-store.constants';
import type { MktgAssetHeaderMetadata, MktgAssetReport } from '../interfaces/mktg-asset.interface';
import type { MktgDocumentAgentKey, MktgRevisionAccepted, MktgRevisionApproval, MktgRevisionResponse } from '../interfaces/mktg-document-store.interface';

/** Completion is not source completeness; describe the viewed revision's report only. */
export function describeMktgAssetReadiness(report: MktgAssetReport | null): string {
  const failed = report?.sources_failed.length ?? 0;
  const gaps = report?.gaps.length ?? 0;
  const total = failed + (report?.sources_read.length ?? 0);
  const clauses: string[] = [];
  if (failed) clauses.push(`${failed} of ${total} ${total === 1 ? 'source' : 'sources'} could not be read`);
  if (gaps) clauses.push(`${gaps} ${gaps === 1 ? 'gap' : 'gaps'}`);
  return clauses.length ? `Ready — ${clauses.join('; ')}.` : 'Ready.';
}

/**
 * Under an approved revision's gaps: they were accepted at that approval and are still open.
 * Null when the revision is not approved or has no gap, so the view adds nothing.
 */
export function describeMktgAcceptedGaps(report: MktgAssetReport | null, approval: MktgRevisionApproval | null, version: number | null): string | null {
  if (!approval || !report?.gaps.length) return null;
  return version === null ? 'Accepted at approval; still open.' : `Accepted when v${version} was approved; still open.`;
}

/** Under one accepted item of an approved revision: when it was accepted. */
export function describeMktgAcceptedItem(version: number | null): string {
  return version === null ? 'Accepted at approval' : `Accepted when v${version} was approved`;
}

/** The snapshot key of a warning: its code and its text, so a reworded warning reads as new. */
export function mktgWarningAcceptedKey(warning: { code: string; text: string }): string {
  return `${warning.code}|${warning.text}`;
}

/**
 * What a report shows, by stable key, for the approval snapshot: tolerant of any report shape, since it is read from
 * a stored sidecar at approval time. A v2 report's failed sources by `source`, a v1 report's by `name`; nothing invented.
 */
export function mktgAcceptedSnapshotOf(report: unknown): MktgRevisionAccepted {
  const record = asRecord(report);
  const findings = asRecord(record?.['findings']);
  const failed = findings ? strings(findings['sources_failed'], 'source') : strings(record?.['sources_failed'], 'name');
  return {
    sources_failed: failed,
    missing_assets: strings(findings?.['missing_assets'], 'asset'),
    warnings: (Array.isArray(findings?.['warnings']) ? findings['warnings'] : [])
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry['code'] === 'string' && typeof entry['text'] === 'string')
      .map((entry) => mktgWarningAcceptedKey({ code: entry['code'] as string, text: entry['text'] as string })),
    gaps: Array.isArray(record?.['gaps']) ? record['gaps'].filter((gap): gap is string => typeof gap === 'string') : [],
    color_conflicts: strings(record?.['color_conflicts'], 'name'),
  };
}

/** A stored snapshot, or null when any of its five lists is not a list of strings: a malformed one is dropped, never guessed. */
export function readMktgRevisionAccepted(value: unknown): MktgRevisionAccepted | null {
  const record = asRecord(value);
  if (!record) return null;
  const accepted: Partial<MktgRevisionAccepted> = {};
  for (const key of MKTG_ACCEPTED_KEYS) {
    const list = record[key];
    if (!Array.isArray(list) || !list.every((entry) => typeof entry === 'string')) return null;
    accepted[key] = list;
  }
  return accepted as MktgRevisionAccepted;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The string field of each object entry of a list; anything else is left out. */
function strings(list: unknown, field: string): string[] {
  return (Array.isArray(list) ? list : []).map((entry) => asRecord(entry)?.[field]).filter((value): value is string => typeof value === 'string');
}

/** Standalone asset previews have no other-current annotation until their caller resolves it. */
export function mktgAssetHeaderFallback(
  agentKey: MktgDocumentAgentKey,
  version: number | null,
  createdAt: string | null,
  approval: MktgRevisionApproval | null
): MktgAssetHeaderMetadata {
  return {
    version,
    createdAt,
    approval,
    agentName: MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === agentKey)?.agentName ?? '',
    otherApprovedCurrent: null,
  };
}

/** The viewed version and the independently approved current, never a guessed approver. */
export function mktgAssetHeaderMetadata(view: MktgRevisionResponse): MktgAssetHeaderMetadata {
  const current = view.approvedCurrent;
  const other = current && current.revisionId !== view.revision.id ? current : null;
  return {
    version: view.revision.number,
    agentName: view.type.agentName,
    createdAt: view.revision.createdAt,
    approval: view.revision.approval ?? null,
    otherApprovedCurrent: other
      ? { number: other.number, approvedBy: view.revisions.find((entry) => entry.id === other.revisionId)?.approval?.approvedBy ?? null }
      : null,
  };
}
