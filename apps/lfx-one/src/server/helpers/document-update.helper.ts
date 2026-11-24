// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ProjectDocumentType, UpdateDocumentRequest, UpstreamDocumentRecord } from '@lfx-one/shared/interfaces';
import { isUuid } from '@lfx-one/shared/utils';

/**
 * Validates the body of `PATCH .../documents/:documentId`. A field left out is left as it is, so the request must name
 * at least one of `name` and `parent_uid`; anything else is refused rather than silently dropped. The returned
 * `request` holds only what was valid, and the caller refuses the request when `fieldErrors` is not empty.
 *
 * @param nameMaxLength the longest name the owning upstream accepts for this type
 */
export function parseDocumentUpdateRequest(
  body: unknown,
  type: ProjectDocumentType,
  nameMaxLength: number
): { request: UpdateDocumentRequest; fieldErrors: Record<string, string> } {
  const request: UpdateDocumentRequest = {};
  const fieldErrors: Record<string, string> = {};

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { request, fieldErrors: { body: 'Request body must be a JSON object' } };
  }

  const fields = body as Record<string, unknown>;

  for (const key of Object.keys(fields)) {
    if (key !== 'name' && key !== 'parent_uid') {
      fieldErrors[key] = 'This field cannot be edited';
    }
  }

  if ('name' in fields) {
    const name = fields['name'];
    if (typeof name !== 'string' || !name.trim()) {
      fieldErrors['name'] = 'Name is required';
    } else if (name.trim().length > nameMaxLength) {
      fieldErrors['name'] = `Name must be ${nameMaxLength} characters or fewer`;
    } else {
      request.name = name.trim();
    }
  }

  if ('parent_uid' in fields) {
    const parentUid = fields['parent_uid'];
    if (type === 'folder') {
      fieldErrors['parent_uid'] = 'A folder cannot be moved';
    } else if (parentUid !== null && (typeof parentUid !== 'string' || !isUuid(parentUid))) {
      fieldErrors['parent_uid'] = 'Folder ID must be a valid UUID, or null for the root';
    } else {
      request.parent_uid = parentUid;
    }
  }

  if (!('name' in fields) && !('parent_uid' in fields) && Object.keys(fieldErrors).length === 0) {
    fieldErrors['body'] = 'Provide a name, a parent_uid, or both';
  }

  return { request, fieldErrors };
}

/**
 * Builds the full-replace body the upstream `PUT` expects from the record as it is now and the requested change. The
 * upstream services replace every editable field, so what is not being changed is carried over from the record: a
 * rename keeps the folder and description, and a move keeps the name. A field that ends up absent is how the upstream
 * services spell "none", so a `null` folder (the root) is left out.
 */
export function buildDocumentUpdateBody(type: ProjectDocumentType, current: UpstreamDocumentRecord, changes: UpdateDocumentRequest): Record<string, unknown> {
  const name = changes.name ?? current.name;

  if (type === 'folder') {
    return { name };
  }

  const folderUid = changes.parent_uid === undefined ? current.folder_uid : (changes.parent_uid ?? undefined);

  if (type === 'link') {
    return { name, url: current.url, description: current.description, folder_uid: folderUid };
  }

  return { name, description: current.description, folder_uid: folderUid };
}
