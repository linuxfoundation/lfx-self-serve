// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_DOCUMENT_TYPES } from '../constants/mktg-document-store.constants';
import type { MktgAssetHeaderMetadata } from '../interfaces/mktg-asset.interface';
import type { MktgDocumentAgentKey, MktgRevisionApproval, MktgRevisionResponse } from '../interfaces/mktg-document-store.interface';

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
