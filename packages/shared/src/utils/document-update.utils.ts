// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DocumentUpdatePatch } from '../interfaces/project.interface';

/**
 * Lays the renames and moves a page made in this session over a fetched document list. The list is read through an index
 * that updates after the write returns, so a refetch right after can still hold the old name or folder.
 *
 * A patch applies only while it is newer than the fetched copy, so a later change someone else makes shows through.
 * A fetched copy with no readable `updated_at` is treated as older, and a patch with none as not newer.
 */
export function applyDocumentUpdates<T extends { uid: string; name: string; parent_uid?: string; updated_at?: string }>(
  fetched: T[],
  patches: ReadonlyMap<string, DocumentUpdatePatch>
): T[] {
  if (patches.size === 0) return fetched;

  return fetched.map((doc) => {
    const patch = patches.get(doc.uid);
    if (!patch || !isPatchNewer(patch, doc)) return doc;

    const patched: T = { ...doc };
    if (patch.name !== undefined) patched.name = patch.name;
    if (patch.parent_uid !== undefined) patched.parent_uid = patch.parent_uid ?? undefined;
    if (patch.updated_at !== undefined) patched.updated_at = patch.updated_at;
    return patched;
  });
}

/** Merges a new patch into what is already remembered for the same document, so a rename and a later move both stay. */
export function mergeDocumentUpdate(
  patches: ReadonlyMap<string, DocumentUpdatePatch>,
  uid: string,
  patch: DocumentUpdatePatch
): Map<string, DocumentUpdatePatch> {
  return new Map(patches).set(uid, { ...patches.get(uid), ...patch });
}

function isPatchNewer(patch: DocumentUpdatePatch, doc: { updated_at?: string }): boolean {
  const fetchedAt = Date.parse(doc.updated_at ?? '');
  if (Number.isNaN(fetchedAt)) return true;
  return Date.parse(patch.updated_at ?? '') > fetchedAt;
}
