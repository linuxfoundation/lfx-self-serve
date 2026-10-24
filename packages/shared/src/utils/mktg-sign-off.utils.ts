// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_REVISION_ID_REGEX, MKTG_LEGACY_REVISION_ID_PREFIX } from '../constants/mktg-document-store.constants';
import { MKTG_SIGN_OFF_NONCE_REGEX } from '../constants/mktg-sign-off.constants';
import { MKTG_SIGN_OFF_REQUEST_PREFIX } from '../constants/mktg-document-comments.constants';
import type { MktgSignOffRequestIds, MktgSignOffRole } from '../interfaces/mktg-sign-off.interface';

/** Request correlation, not an identity hash/capability; remains scoped to revision AND role after release. */
export function mktgSignOffRequestIds(revisionId: string, role: MktgSignOffRole, nonce: string): MktgSignOffRequestIds | null {
  if (
    typeof revisionId !== 'string' ||
    typeof nonce !== 'string' ||
    !MKTG_REVISION_ID_REGEX.test(revisionId) ||
    revisionId.startsWith(MKTG_LEGACY_REVISION_ID_PREFIX) ||
    (role !== 'ed' && role !== 'tocChair') ||
    !MKTG_SIGN_OFF_NONCE_REGEX.test(nonce)
  )
    return null;
  const prefix = `${MKTG_SIGN_OFF_REQUEST_PREFIX}${revisionId}-${role}-${nonce}`;
  return { commentRequestId: `${prefix}-c`, requestId: `${prefix}-r` };
}
