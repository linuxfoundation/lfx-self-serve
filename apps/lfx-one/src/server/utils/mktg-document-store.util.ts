// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_RUN_DOCUMENT_ID_PREFIX } from '@lfx-one/shared/constants';
import { createHash } from 'node:crypto';

/** Canonical document-store identity used by both navigation and persistence. */
export function buildMktgRunDocumentId(sessionId: string): string {
  return `${MKTG_RUN_DOCUMENT_ID_PREFIX}${createHash('sha256').update(sessionId, 'utf8').digest('hex').slice(0, 24)}`;
}
