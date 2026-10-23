// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_ARTIFACT_PARTITION_REGEX } from '../constants/mktg-artifact.constants';
import {
  MKTG_DOCUMENT_COMMENT_ANCHOR_MAX_CHARS,
  MKTG_DOCUMENT_COMMENT_ID_REGEX,
  MKTG_DOCUMENT_COMMENT_LIMITS,
  MKTG_DOCUMENT_COMMENT_MAX_CHARS,
  MKTG_DOCUMENT_COMMENT_PATH_REGEX,
  MKTG_DOCUMENT_COMMENT_PATH_PART_REGEX,
  MKTG_DOCUMENT_COMMENT_ROOTS,
  MKTG_DOCUMENT_COMMENT_UNSAFE_PARTS,
  MKTG_BOILERPLATES_COMMENT_FIELD_REGEX,
} from '../constants/mktg-document-comments.constants';
import { MKTG_LIVING_DOCUMENT_ID, MKTG_REVISION_ID_REGEX, MKTG_STARTED_RUN_ID_REGEX } from '../constants/mktg-document-store.constants';
import {
  MKTG_REDRAFT_ANCHOR_KEYS,
  MKTG_REDRAFT_CONTEXT_KEYS,
  MKTG_REDRAFT_CONTEXT_SCHEMA,
  MKTG_REDRAFT_SNAPSHOT_KEYS,
  MKTG_REDRAFT_REQUEST_KEYS,
} from '../constants/mktg-document-redraft.constants';
import { MKTG_RUN_POLL } from '../constants/mktg-run.constants';
import type { MktgCommentAgentKey, MktgReviseDocumentRequest, MktgDocumentCommentSubmission } from '../interfaces/mktg-document-comments.interface';
import type { MktgDocumentRedraftContext, MktgRedraftResultValidation } from '../interfaces/mktg-document-redraft.interface';
import type { BrandKitEnvelope } from '../interfaces/brand-kit.interface';
import type { FoundationMessageEnvelope } from '../interfaces/foundation-message.interface';
import type { BoilerplatesEnvelope } from '../interfaces/boilerplates.interface';
import { guardBrandKitText, validateBrandKitEnvelope } from './brand-kit.utils';
import { guardBoilerplatesText, validateBoilerplatesEnvelope } from './boilerplates.utils';
import { guardFoundationMessageText, validateFoundationMessageEnvelope } from './foundation-message.utils';

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function id(value: unknown): value is string {
  return typeof value === 'string' && MKTG_DOCUMENT_COMMENT_ID_REGEX.test(value);
}

/** Public send shape contains IDs only, never caller-authored previous JSON/routing/identity. */
export function readMktgRedraftRequest(value: unknown): MktgReviseDocumentRequest | null {
  if (
    !record(value) ||
    !onlyKeys(value, MKTG_REDRAFT_REQUEST_KEYS) ||
    typeof value['project'] !== 'string' ||
    !MKTG_ARTIFACT_PARTITION_REGEX.test(value['project'].trim()) ||
    typeof value['revisionId'] !== 'string' ||
    !MKTG_REVISION_ID_REGEX.test(value['revisionId']) ||
    !id(value['clientRequestId']) ||
    !Array.isArray(value['commentIds']) ||
    !value['commentIds'].length ||
    value['commentIds'].length > Math.max(...Object.values(MKTG_DOCUMENT_COMMENT_LIMITS)) ||
    !value['commentIds'].every(id) ||
    new Set(value['commentIds']).size !== value['commentIds'].length
  )
    return null;
  return { project: value['project'].trim(), revisionId: value['revisionId'], commentIds: [...value['commentIds']], clientRequestId: value['clientRequestId'] };
}

/** Fail closed on unknown fields, including accidental raw session/token/starter attribution fields. */
export function readMktgRedraftContext(value: unknown): MktgDocumentRedraftContext | null {
  return isMktgRedraftContext(value) ? value : null;
}
export function isMktgRedraftContext(value: unknown): value is MktgDocumentRedraftContext {
  return checkedContext(value) !== null;
}
function checkedContext(value: unknown): Record<string, unknown> | null {
  if (
    !record(value) ||
    !onlyKeys(value, MKTG_REDRAFT_CONTEXT_KEYS) ||
    value['schema'] !== MKTG_REDRAFT_CONTEXT_SCHEMA ||
    typeof value['runId'] !== 'string' ||
    !MKTG_STARTED_RUN_ID_REGEX.test(value['runId']) ||
    typeof value['project'] !== 'string' ||
    !MKTG_ARTIFACT_PARTITION_REGEX.test(value['project']) ||
    typeof value['agentKey'] !== 'string' ||
    !Object.hasOwn(MKTG_DOCUMENT_COMMENT_LIMITS, value['agentKey']) ||
    value['documentId'] !== MKTG_LIVING_DOCUMENT_ID ||
    !id(value['requestId']) ||
    typeof value['basedOnId'] !== 'string' ||
    !MKTG_REVISION_ID_REGEX.test(value['basedOnId']) ||
    !Number.isSafeInteger(value['priorVersion']) ||
    Number(value['priorVersion']) < 1 ||
    Number(value['priorVersion']) >= Number.MAX_SAFE_INTEGER ||
    typeof value['projectName'] !== 'string' ||
    !value['projectName'].trim() ||
    /[\r\n]/.test(value['projectName']) ||
    !Array.isArray(value['comments'])
  )
    return null;
  const agent = value['agentKey'] as MktgCommentAgentKey;
  const comments = value['comments'];
  if (!comments.length || comments.length > MKTG_DOCUMENT_COMMENT_LIMITS[agent]) return null;
  const ids = new Set<string>();
  for (const comment of comments) {
    if (
      !record(comment) ||
      !onlyKeys(comment, MKTG_REDRAFT_SNAPSHOT_KEYS) ||
      !id(comment['id']) ||
      ids.has(comment['id']) ||
      typeof comment['text'] !== 'string' ||
      !comment['text'].trim() ||
      comment['text'].length > MKTG_DOCUMENT_COMMENT_MAX_CHARS ||
      typeof comment['createdAt'] !== 'string' ||
      !Number.isFinite(Date.parse(comment['createdAt']))
    )
      return null;
    ids.add(comment['id']);
    const anchor = comment['anchor'];
    if (
      !record(anchor) ||
      !onlyKeys(anchor, MKTG_REDRAFT_ANCHOR_KEYS) ||
      anchor['kind'] !== (agent === 'brand-kit' ? 'passage' : 'field') ||
      typeof anchor['key'] !== 'string' ||
      anchor['key'].length > MKTG_DOCUMENT_COMMENT_ANCHOR_MAX_CHARS ||
      !MKTG_DOCUMENT_COMMENT_PATH_REGEX.test(anchor['key'])
    )
      return null;
    const parts = anchor['key'].match(MKTG_DOCUMENT_COMMENT_PATH_PART_REGEX) ?? [];
    if (
      !(MKTG_DOCUMENT_COMMENT_ROOTS[agent] as readonly string[]).includes(parts[0] ?? '') ||
      parts.some((part) => (MKTG_DOCUMENT_COMMENT_UNSAFE_PARTS as readonly string[]).includes(part))
    )
      return null;
    if (agent === 'boilerplates' && !MKTG_BOILERPLATES_COMMENT_FIELD_REGEX.test(anchor['key'])) return null;
    if (agent === 'brand-kit') {
      if (typeof anchor['passage'] !== 'string' || !anchor['passage'].trim()) return null;
    } else if (anchor['passage'] !== undefined) return null;
  }
  return value;
}

export function isMktgRedraftSubmissionBusy(submission: Pick<MktgDocumentCommentSubmission, 'state' | 'runId' | 'createdAt'>, now = Date.now()): boolean {
  return (
    submission.state === 'started' ||
    (submission.state === 'reserved' && (!!submission.runId || now - Date.parse(submission.createdAt) <= MKTG_RUN_POLL.timeoutMs))
  );
}

export function isFoundationMessageEnvelope(value: unknown): value is FoundationMessageEnvelope {
  return validateFoundationMessageEnvelope(value).valid;
}
export function isBrandKitEnvelope(value: unknown): value is BrandKitEnvelope {
  return validateBrandKitEnvelope(value).valid;
}
export function isBoilerplatesEnvelope(value: unknown): value is BoilerplatesEnvelope {
  return validateBoilerplatesEnvelope(value).valid;
}

/** Domain envelope/hash/current-turn-finalize validation runs BEFORE this request-specific gate. */
export function validateMktgRedraftResult(context: MktgDocumentRedraftContext, envelope: unknown): MktgRedraftResultValidation {
  const invalid = (): MktgRedraftResultValidation => ({ valid: false, errors: ['The redraft result does not match its frozen send input.'], resolutions: [] });
  if (
    !record(envelope) ||
    envelope['mode'] !== 'redraft' ||
    envelope['version'] !== context.priorVersion + 1 ||
    envelope['project_name'] !== context.projectName
  )
    return invalid();
  const revision = envelope['revision'];
  if (
    !record(revision) ||
    revision['prior_version'] !== context.priorVersion ||
    !Array.isArray(revision['comments']) ||
    revision['comments'].length !== context.comments.length
  )
    return invalid();
  if (context.agentKey !== 'brand-kit' && revision['mode'] !== 'redraft') return invalid();
  const guard = context.agentKey === 'brand-kit' ? guardBrandKitText : guardFoundationMessageText;
  const resolutions: string[] = [];
  for (let index = 0; index < context.comments.length; index++) {
    const input = context.comments[index];
    const output = revision['comments'][index] as unknown;
    if (!input || !record(output) || output['number'] !== index + 1 || typeof output['resolution'] !== 'string' || !output['resolution'].trim())
      return invalid();
    const renderedText = context.agentKey === 'boilerplates' ? guardBoilerplatesText(input.text) : guard(input.text);
    if (output['comment'] !== renderedText) return invalid();
    if (context.agentKey === 'brand-kit') {
      if (output['passage'] !== guardBrandKitText(input.anchor.passage ?? '')) return invalid();
    } else if (output['field'] !== input.anchor.key) return invalid();
    resolutions.push(output['resolution']);
  }
  return { valid: true, errors: [], resolutions };
}
