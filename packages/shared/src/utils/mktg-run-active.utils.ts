// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_RUN_ACTIVE } from '../constants/mktg-run.constants';
import { MKTG_DOCUMENT_TYPES, MKTG_DOCUMENT_ID_REGEX, MKTG_LIVING_DOCUMENT_ID, MKTG_STARTED_RUN_ID_REGEX } from '../constants/mktg-document-store.constants';
import type { MktgActiveRunConflict } from '../interfaces/mktg-document-run.interface';

/** Validate the server's top-level conflict facts before presenting navigation or discard. */
export function readMktgActiveRunConflict(value: unknown, agentId: string, documentId?: string): MktgActiveRunConflict | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === agentId);
  if (
    !type ||
    body['code'] !== MKTG_RUN_ACTIVE ||
    typeof body['message'] !== 'string' ||
    typeof body['startedAt'] !== 'string' ||
    !Number.isFinite(Date.parse(body['startedAt'])) ||
    typeof body['startedBy'] !== 'string' ||
    !body['startedBy'].trim() ||
    typeof body['activeRunId'] !== 'string' ||
    !MKTG_STARTED_RUN_ID_REGEX.test(body['activeRunId']) ||
    body['agentKey'] !== type.agentKey ||
    typeof body['documentId'] !== 'string' ||
    !MKTG_DOCUMENT_ID_REGEX.test(body['documentId']) ||
    (type.kind === 'run' ? body['documentId'] === MKTG_LIVING_DOCUMENT_ID : body['documentId'] !== (documentId ?? MKTG_LIVING_DOCUMENT_ID)) ||
    (body['state'] !== 'writing' && body['state'] !== 'questions' && body['state'] !== 'storing')
  )
    return null;
  return {
    code: MKTG_RUN_ACTIVE,
    message: body['message'],
    startedBy: body['startedBy'],
    startedAt: body['startedAt'],
    activeRunId: body['activeRunId'],
    state: body['state'],
    agentKey: type.agentKey,
    documentId: body['documentId'],
  };
}

/** One heading policy for catalog and dedicated one-off intakes; never double the word "run". */
export function mktgActiveRunConflictHeading(conflict: MktgActiveRunConflict): string {
  const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === conflict.agentKey);
  const label = (type?.itemLabel ?? 'document').replace(/\s+run$/i, '');
  return type?.kind === 'run' ? `Your ${label} run is in progress` : `${conflict.startedBy}'s ${label} run is in progress`;
}
