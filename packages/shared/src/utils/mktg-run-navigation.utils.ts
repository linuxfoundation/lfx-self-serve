// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_STARTED_RUN_ID_REGEX } from '../constants/mktg-document-store.constants';
import { MKTG_RUN_ANSWERED } from '../constants/mktg-run.constants';
import type { MktgRetiredRunHint } from '../interfaces/mktg-document-run.interface';

/** One safe attribution policy for public and owner-token answers conflicts. */
export function mktgRunAnsweredBy(body: unknown, runId: string, questionsId: string): string | null {
  if (!body || typeof body !== 'object' || !('code' in body) || body.code !== MKTG_RUN_ANSWERED) return null;
  const details = 'details' in body ? body.details : body;
  if (!details || typeof details !== 'object') return null;
  if (('runId' in details && runId && details.runId !== runId) || ('questionsId' in details && details.questionsId !== questionsId)) return null;
  const name = 'answeredBy' in details && typeof details.answeredBy === 'string' ? details.answeredBy.trim() : '';
  return name && !/[<>@|:]/.test(name) ? name : 'Another writer';
}

/** Read only the optional safe navigation hint, never a private record or its arbitrary fields. */
export function readMktgRetiredRunHint(value: unknown): MktgRetiredRunHint | null {
  if (
    !value ||
    typeof value !== 'object' ||
    !('state' in value) ||
    (value.state !== 'discarded' && value.state !== 'superseded') ||
    !('runId' in value) ||
    typeof value.runId !== 'string' ||
    !MKTG_STARTED_RUN_ID_REGEX.test(value.runId)
  )
    return null;
  const name = 'closedBy' in value && typeof value.closedBy === 'string' ? value.closedBy.trim() : '';
  const date = 'closedAt' in value && typeof value.closedAt === 'string' && Number.isFinite(Date.parse(value.closedAt)) ? value.closedAt : null;
  return {
    runId: value.runId,
    state: value.state,
    replacedBy: 'replacedBy' in value && typeof value.replacedBy === 'string' && MKTG_STARTED_RUN_ID_REGEX.test(value.replacedBy) ? value.replacedBy : null,
    closedBy: name && !/[<>@|:]/.test(name) ? name : null,
    closedAt: date,
  };
}

/** Shared run-page/document-page copy; callers supply local short time, not an attribution identifier. */
export function mktgDiscardedRunMessage(hint: MktgRetiredRunHint | null, localTime = ''): string {
  if (hint?.state === 'superseded') return 'A newer run replaced this one.';
  const by = hint?.closedBy ? ` by ${hint.closedBy}` : '';
  const at = hint?.closedAt && localTime ? ` at ${localTime}` : '';
  return `This run was discarded${by}${at}; a newer run was started.`;
}
