// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_ARTIFACT_PARTITION_REGEX, MKTG_ARTIFACT_SHA256_REGEX } from '../constants/mktg-artifact.constants';
import { MKTG_DOCUMENT_TYPES, MKTG_REVISION_ID_REGEX } from '../constants/mktg-document-store.constants';
import { MKTG_KIT_FAMILIES, MKTG_KIT_FRAMEWORK_KEY, MKTG_KIT_POSITIONING_FAMILY_ID } from '../constants/mktg-kit.constants';
import { MKTG_REBUILD_DOWNSTREAM_KEYS } from '../constants/mktg-rebuild.constants';
import type { MktgDocumentsResponse } from '../interfaces/mktg-document-store.interface';
import type { MktgRebuildNavigationIntent, MktgRevisionRef } from '../interfaces/mktg-rebuild.interface';

/** Validate navigation state before Family considers a one-shot rebuild action. */
export function readMktgRebuildNavigationIntent(value: unknown): MktgRebuildNavigationIntent | null {
  if (!value || typeof value !== 'object' || !('project' in value) || typeof value.project !== 'string' || !MKTG_ARTIFACT_PARTITION_REGEX.test(value.project))
    return null;
  if (!('frameworkRevisionId' in value) || typeof value.frameworkRevisionId !== 'string' || !MKTG_REVISION_ID_REGEX.test(value.frameworkRevisionId))
    return null;
  return { project: value.project, frameworkRevisionId: value.frameworkRevisionId };
}

/** Narrow untrusted/historical sidecar or metadata; malformed provenance is unknown, not stale. */
export function readMktgFrameworkRef(value: unknown): MktgRevisionRef | null {
  if (!value || typeof value !== 'object') return null;
  if (!('agentKey' in value) || value.agentKey !== MKTG_KIT_FRAMEWORK_KEY) return null;
  if (!('revisionId' in value) || typeof value.revisionId !== 'string' || !MKTG_REVISION_ID_REGEX.test(value.revisionId)) return null;
  if (!('revisionNumber' in value) || typeof value.revisionNumber !== 'number' || !Number.isSafeInteger(value.revisionNumber) || value.revisionNumber < 1)
    return null;
  if (!('contentSha256' in value) || typeof value.contentSha256 !== 'string' || !MKTG_ARTIFACT_SHA256_REGEX.test(value.contentSha256)) return null;
  // Project only the public identity fields; do not propagate arbitrary metadata.
  return { agentKey: value.agentKey, revisionId: value.revisionId, revisionNumber: value.revisionNumber, contentSha256: value.contentSha256 };
}

export function sameMktgRevision(a: MktgRevisionRef, b: MktgRevisionRef): boolean {
  return a.agentKey === b.agentKey && a.revisionId === b.revisionId && a.contentSha256 === b.contentSha256;
}

/** Follow the family's catalog order, but only for the explicit living downstream graph. */
export function mktgRebuildDocumentTypes() {
  const family = MKTG_KIT_FAMILIES.find((entry) => entry.id === MKTG_KIT_POSITIONING_FAMILY_ID);
  return (family?.agentIds ?? []).flatMap((id) =>
    MKTG_DOCUMENT_TYPES.filter((type) => type.catalogAgentId === id && type.kind === 'living' && MKTG_REBUILD_DOWNSTREAM_KEYS.includes(type.agentKey))
  );
}

/**
 * Called by the server once, after its metadata-only current-summary listing.
 * No newest lookup, timestamps, bodies or historical approval scans. Browser
 * consumers use the resulting needsRebuild field unchanged on all three boards.
 */
export function projectMktgRebuildStaleness(listing: MktgDocumentsResponse): MktgDocumentsResponse {
  const framework = listing.groups.find((group) => group.type.agentKey === MKTG_KIT_FRAMEWORK_KEY)?.documents[0];
  const approved = framework?.approvedCurrent;
  const target =
    approved && approved.revisionId === framework?.latestRevisionId
      ? readMktgFrameworkRef({
          agentKey: MKTG_KIT_FRAMEWORK_KEY,
          revisionId: approved.revisionId,
          revisionNumber: approved.number,
          contentSha256: framework.contentSha256,
        })
      : null;
  return {
    ...listing,
    approvedFramework: target,
    groups: listing.groups.map((group) => ({
      ...group,
      documents: group.documents.map((document) => {
        const upstream = readMktgFrameworkRef(document.upstreamFramework);
        const eligible = group.type.kind === 'living' && MKTG_REBUILD_DOWNSTREAM_KEYS.includes(group.type.agentKey);
        return {
          ...document,
          needsRebuild: eligible && target && upstream && !sameMktgRevision(upstream, target) ? { builtFrom: upstream, rebuildFrom: target } : null,
        };
      }),
    })),
  };
}
