// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_RUN_ACTIVE, MKTG_RUN_ANSWERED, MKTG_RUN_CHANGED_BY_FALLBACK, MKTG_RUN_NOT_FAILED } from '../constants/mktg-run.constants';
import { MKTG_DOCUMENT_TYPES, MKTG_DOCUMENT_ID_REGEX, MKTG_LIVING_DOCUMENT_ID, MKTG_STARTED_RUN_ID_REGEX } from '../constants/mktg-document-store.constants';
import type { MktgActiveRunConflict, MktgRunAnsweredConflict, MktgRunNotFailedConflict } from '../interfaces/mktg-document-run.interface';
import { isMktgDisplayName } from './mktg-document-store.utils';

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
    typeof body['startedByViewer'] !== 'boolean' ||
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
    startedByViewer: body['startedByViewer'],
    startedAt: body['startedAt'],
    activeRunId: body['activeRunId'],
    state: body['state'],
    agentKey: type.agentKey,
    documentId: body['documentId'],
  };
}

/** Accept only the display-name/time acknowledgement, never opaque server ownership fields. */
export function readMktgRunAnsweredConflict(value: unknown): MktgRunAnsweredConflict | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (
    body['code'] !== MKTG_RUN_ANSWERED ||
    typeof body['answeredBy'] !== 'string' ||
    !body['answeredBy'].trim() ||
    typeof body['answeredAt'] !== 'string' ||
    !Number.isFinite(Date.parse(body['answeredAt']))
  )
    return null;
  return { code: MKTG_RUN_ANSWERED, answeredBy: body['answeredBy'].trim(), answeredAt: body['answeredAt'] };
}

/** Validate a refused dismiss before naming anyone: the facts must be about the run this page tried to dismiss. A 409 without them stays unnamed. */
export function readMktgRunNotFailedConflict(value: unknown, runId: string): MktgRunNotFailedConflict | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const changedAt = body['changedAt'];
  if (
    body['code'] !== MKTG_RUN_NOT_FAILED ||
    !MKTG_STARTED_RUN_ID_REGEX.test(runId) ||
    body['runId'] !== runId ||
    (body['change'] !== 'closed' && body['change'] !== 'retried') ||
    typeof body['changedByViewer'] !== 'boolean' ||
    (changedAt !== null && (typeof changedAt !== 'string' || !Number.isFinite(Date.parse(changedAt))))
  )
    return null;
  const name = typeof body['changedBy'] === 'string' ? body['changedBy'].trim() : '';
  return {
    code: MKTG_RUN_NOT_FAILED,
    runId,
    change: body['change'],
    // A display name only: an email, subject or markup-like value is never shown.
    changedBy: isMktgDisplayName(name) ? name : null,
    changedByViewer: body['changedByViewer'],
    changedAt,
  };
}

/**
 * One line for a dismiss that lost: who closed or retried the run first and, with the caller's local short time, when.
 * With the row's label and local started time the line says which run, as that row's Dismiss button names it.
 */
export function mktgRunNotFailedNotice(
  conflict: Pick<MktgRunNotFailedConflict, 'change' | 'changedBy' | 'changedByViewer' | 'changedAt'>,
  localTime = '',
  run: { label: string; started: string } | null = null
): string {
  const who = conflict.changedByViewer ? 'You' : (conflict.changedBy ?? MKTG_RUN_CHANGED_BY_FALLBACK);
  const at = conflict.changedAt && localTime ? ` at ${localTime}` : '';
  // The change is the verb: "closed" or "retried".
  const did = `${who} already ${conflict.change}`;
  if (!run) return `${did} this run${at}.`;
  // Two times in one line: the change's own repeats the verb, so it is never read as the start. Never double the word "run".
  return `${did} the ${run.label.replace(/\s+run$/i, '')} run started at ${run.started}${at && ` (${conflict.change}${at})`}.`;
}

/** One heading policy for catalog and dedicated one-off intakes; never double the word "run". */
export function mktgActiveRunConflictHeading(conflict: MktgActiveRunConflict): string {
  const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === conflict.agentKey);
  const label = (type?.itemLabel ?? 'document').replace(/\s+run$/i, '');
  return type?.kind === 'run' || conflict.startedByViewer ? `Your ${label} run is in progress` : `${conflict.startedBy}'s ${label} run is in progress`;
}
