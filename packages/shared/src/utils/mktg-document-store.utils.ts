// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Pure helpers for the Marketing OS document store: the revision key layout
// `documents/{project}/{agentKey}/{documentId}/{sequence}-{sha256}.json`, the
// revision ids derived from it, and the "How it was made" wording. Hashing is
// deliberately not here (it is environment-specific); the server recomputes
// every sha with node:crypto.

import { MKTG_AGENTS } from '../constants/mktg-os-agents.constants';
import { MKTG_AGENT_INTAKES, MKTG_RUN_PERSIST_RETRY_MAX_ATTEMPTS, MKTG_RUN_QUESTIONS_ID_REGEX } from '../constants/mktg-run.constants';
import { MKTG_ONE_OFF_STOPPED_MESSAGE } from '../constants/mktg-one-off.constants';
import { MEMBER_360_FAILURE_MESSAGES } from '../constants/member-360.constants';
import type { Member360FailureReason } from '../interfaces/member-360.interface';
import type {
  MktgDocumentRunProgress,
  MktgStartedRunRecord,
  MktgStoredDocumentRunState,
  MktgRunPendingQuestions,
} from '../interfaces/mktg-document-run.interface';
import { MKTG_ARTIFACT_PARTITION_REGEX, MKTG_ARTIFACT_SHA256_REGEX } from '../constants/mktg-artifact.constants';
import {
  MKTG_DOCUMENT_ID_REGEX,
  MKTG_DOCUMENT_STORE_KEY_PREFIX,
  MKTG_DOCUMENT_TYPES,
  MKTG_LEGACY_REVISION_ID_PREFIX,
  MKTG_STARTED_RUN_ATTEMPT_ID_REGEX,
  MKTG_REVISION_GENERATED_LABEL,
  MKTG_REVISION_ID_REGEX,
  MKTG_REVISION_KEY_SUFFIX,
  MKTG_REVISION_NAME_UNAVAILABLE_LABEL,
  MKTG_REVISION_SEQUENCE_DIGITS,
  MKTG_REVISION_UNKNOWN_AUTHOR_LABEL,
} from '../constants/mktg-document-store.constants';
import type {
  MktgDocumentLocation,
  MktgDocumentType,
  MktgRevisionAuthor,
  MktgRevisionSummary,
  ParsedMktgRevisionKey,
} from '../interfaces/mktg-document-store.interface';
import type { MktgRunActivity, MktgRunPersistReceipt, MktgRunResultResponse } from '../interfaces/mktg-run.interface';

/** Normalize the artifact receipt's snake-case location for camel-case UI/progress models. */
export function mktgDocumentLocationOfReceipt(receipt?: MktgRunPersistReceipt): MktgDocumentLocation | undefined {
  const location = receipt?.document_location;
  return location ? { agentKey: location.agent_key, documentId: location.document_id, revisionId: location.revision_id } : undefined;
}

/** The registered document type for an agent key, or undefined when the key names none. */
export function findMktgDocumentType(agentKey: string): MktgDocumentType | undefined {
  return MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === agentKey);
}

/**
 * The prefix every revision of one project lives under, `documents/{project}/`.
 * Throws on an unvalidated project: this builds a storage path.
 */
export function buildMktgDocumentProjectPrefix(project: string): string {
  if (!MKTG_ARTIFACT_PARTITION_REGEX.test(project)) {
    throw new Error('buildMktgDocumentProjectPrefix requires an already-validated project partition');
  }
  return `${MKTG_DOCUMENT_STORE_KEY_PREFIX}/${project}/`;
}

/**
 * The prefix one document's revisions live under,
 * `documents/{project}/{agentKey}/{documentId}/`. Throws when the agent key
 * is not a registered document type or the document id is malformed.
 */
export function buildMktgDocumentPrefix(project: string, agentKey: string, documentId: string): string {
  if (!findMktgDocumentType(agentKey)) {
    throw new Error('buildMktgDocumentPrefix requires a registered document agent key');
  }
  if (!MKTG_DOCUMENT_ID_REGEX.test(documentId)) {
    throw new Error('buildMktgDocumentPrefix requires an already-validated document id');
  }
  return `${buildMktgDocumentProjectPrefix(project)}${agentKey}/${documentId}/`;
}

/** Revision id of a stored revision: the zero-padded sequence, a dash, the record's sha256. */
export function buildMktgRevisionId(sequence: number, sha: string): string {
  if (!Number.isInteger(sequence) || sequence < 1 || String(sequence).length > MKTG_REVISION_SEQUENCE_DIGITS) {
    throw new Error('buildMktgRevisionId requires a positive sequence that fits the key');
  }
  if (!MKTG_ARTIFACT_SHA256_REGEX.test(sha)) {
    throw new Error('buildMktgRevisionId requires an already-validated sha256');
  }
  return `${String(sequence).padStart(MKTG_REVISION_SEQUENCE_DIGITS, '0')}-${sha}`;
}

/** The object key of a stored revision. */
export function buildMktgRevisionKey(project: string, agentKey: string, documentId: string, sequence: number, sha: string): string {
  return `${buildMktgDocumentPrefix(project, agentKey, documentId)}${buildMktgRevisionId(sequence, sha)}${MKTG_REVISION_KEY_SUFFIX}`;
}

/**
 * Take a listed key apart, or return null when it is not a revision key under
 * `projectPrefix` — which is how a listing ignores anything else stored there.
 */
export function parseMktgRevisionKey(key: string, projectPrefix: string): ParsedMktgRevisionKey | null {
  if (!key.startsWith(projectPrefix) || !key.endsWith(MKTG_REVISION_KEY_SUFFIX)) {
    return null;
  }
  const segments = key.slice(projectPrefix.length, -MKTG_REVISION_KEY_SUFFIX.length).split('/');
  if (segments.length !== 3) {
    return null;
  }
  const [agentKey, documentId, id] = segments;
  const type = findMktgDocumentType(agentKey);
  if (!type || !MKTG_DOCUMENT_ID_REGEX.test(documentId)) {
    return null;
  }
  const match = /^([0-9]{6})-([0-9a-f]{64})$/.exec(id);
  if (!match) {
    return null;
  }
  const sequence = Number.parseInt(match[1], 10);
  if (sequence < 1) {
    return null;
  }
  return { agentKey: type.agentKey, documentId, sequence, sha: match[2], id };
}

/** Revision id of a living document's revision 1 that is still read from the pre-revision store. */
export function buildMktgLegacyRevisionId(sha: string): string {
  if (!MKTG_ARTIFACT_SHA256_REGEX.test(sha)) {
    throw new Error('buildMktgLegacyRevisionId requires an already-validated sha256');
  }
  return `${MKTG_LEGACY_REVISION_ID_PREFIX}${sha}`;
}

/** The document sha a legacy revision id names, or null when the id is not a legacy one. */
export function parseMktgLegacyRevisionId(id: string): string | null {
  if (!id.startsWith(MKTG_LEGACY_REVISION_ID_PREFIX)) {
    return null;
  }
  const sha = id.slice(MKTG_LEGACY_REVISION_ID_PREFIX.length);
  return MKTG_ARTIFACT_SHA256_REGEX.test(sha) ? sha : null;
}

/** One attribution policy for the row and history bar, including unavailable directory names. */
export function describeMktgRevisionAuthor(author: MktgRevisionAuthor | null | undefined): string {
  if (!author) return MKTG_REVISION_UNKNOWN_AUTHOR_LABEL;
  return author.name || MKTG_REVISION_NAME_UNAVAILABLE_LABEL;
}

/** "How it was made" for one revision, as the Revisions table shows it. */
export function describeMktgRevision(
  revision: Pick<MktgRevisionSummary, 'origin' | 'intakeMode' | 'restoredFromNumber'> &
    Partial<Pick<MktgRevisionSummary, 'commentCount' | 'number' | 'basedOnNumber'>>,
  type: MktgDocumentType
): string {
  if (revision.origin === 'legacy') {
    return `generated by the ${type.agentName} (stored before revisions existed)`;
  }
  if (revision.origin === 'restored') {
    return revision.restoredFromNumber ? `restored from v${revision.restoredFromNumber}` : 'restored from an earlier revision';
  }
  let label = revision.intakeMode ? MKTG_REVISION_GENERATED_LABEL[revision.intakeMode] : 'generated';
  if (revision.commentCount) label = `revised from ${revision.commentCount} ${revision.commentCount === 1 ? 'comment' : 'comments'}`;
  if (revision.basedOnNumber && revision.number && revision.basedOnNumber !== revision.number - 1) label += ` · based on v${revision.basedOnNumber}`;
  return label;
}

/** Pure run membership, validation and public projection shared by the durable reader. */
export function findMktgRunIntake(key: string, includeOneOff = false) {
  const type = findMktgDocumentType(key);
  const id = type?.catalogAgentId;
  const intake = id ? MKTG_AGENT_INTAKES[id] : undefined;
  return id &&
    (type?.kind === 'living' || (includeOneOff && intake?.tracksDocumentRun)) &&
    MKTG_AGENTS.some((agent) => agent.id === id && agent.status === 'active')
    ? intake
    : undefined;
}

/** Absent legacy turns are allowed; present turns contain only the existing typed question payload. */
export function isMktgRunPendingQuestions(value: unknown): value is MktgRunPendingQuestions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const turn = value as Record<string, unknown>;
  return (
    typeof turn['questionsId'] === 'string' &&
    MKTG_RUN_QUESTIONS_ID_REGEX.test(turn['questionsId']) &&
    typeof turn['askedAt'] === 'string' &&
    Number.isFinite(Date.parse(turn['askedAt'])) &&
    Array.isArray(turn['questions']) &&
    turn['questions'].every((value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const question = value as Record<string, unknown>;
      return (
        ['key', 'label', 'question', 'why', 'suggestedAnswer'].every((key) => typeof question[key] === 'string') &&
        Array.isArray(question['basis']) &&
        question['basis'].every((basis: unknown) => typeof basis === 'string')
      );
    })
  );
}

/** Build a claim only for the exact unclaimed turn; the store commits it with the observed ETag. */
export function mktgRunClaimAnswers(run: MktgStartedRunRecord, questionsId: string, answeredBy: string, answeredAt: string): MktgStartedRunRecord | null {
  if (
    run.state !== 'questions' ||
    run.pendingQuestions?.questionsId !== questionsId ||
    run.answeredQuestionsId === questionsId ||
    !MKTG_RUN_QUESTIONS_ID_REGEX.test(questionsId) ||
    !answeredBy.trim() ||
    !Number.isFinite(Date.parse(answeredAt))
  )
    return null;
  return {
    ...run,
    state: 'writing',
    pendingQuestions: undefined,
    answeredQuestionsId: questionsId,
    answeredBy,
    answeredAt,
    retryAt: mktgRunRenewAt(run, Date.parse(answeredAt)),
    persistRetries: 0,
  };
}

/** Explicit public projection: no session capabilities, subjects or private coverage. Closed markers opt in only for selected details. */
export function mktgRunProgress(
  run: MktgStartedRunRecord,
  fullReply = run.failureText,
  activity?: MktgRunActivity[],
  readerSubject?: string,
  readerIsWriter = false,
  includeClosed = false
): MktgDocumentRunProgress | null {
  const closed = run.state === 'superseded' || run.state === 'discarded';
  const completed = run.state === 'completed';
  const producedRevisionId =
    completed && run.result?.agentKey === run.agentKey && run.result.documentId === run.documentId && MKTG_REVISION_ID_REGEX.test(run.result.revisionId)
      ? run.result.revisionId
      : undefined;
  if ((completed && (!includeClosed || !producedRevisionId)) || (closed && !includeClosed)) {
    return null;
  }
  // Agent prose can contain private source data; unknown creators fail closed.
  const genericFailure = run.agentKey === 'member-360' ? MEMBER_360_FAILURE_MESSAGES[run.failureReason ?? 'agent_stopped'] : MKTG_ONE_OFF_STOPPED_MESSAGE;
  const failureText = !run.creatorSubject || readerSubject !== run.creatorSubject ? genericFailure : fullReply;
  const state = run.state === 'questions' && !!run.answeredQuestionsId && run.pendingQuestions?.questionsId === run.answeredQuestionsId ? 'writing' : run.state;
  const progress: MktgDocumentRunProgress = {
    runId: run.runId,
    project: run.project,
    agentKey: run.agentKey,
    documentId: run.documentId,
    startedAt: run.startedAt,
    state,
    ...(closed && run.closedAt && Number.isFinite(Date.parse(run.closedAt)) && { closedAt: run.closedAt }),
    ...(producedRevisionId && { producedRevisionId }),
    ...(!closed && !completed && activity && { activity }),
    ...(readerIsWriter &&
      state === 'questions' &&
      isMktgRunPendingQuestions(run.pendingQuestions) &&
      MKTG_DOCUMENT_TYPES.some((type) => type.agentKey === run.agentKey && type.kind === 'living') && {
        pendingQuestions: {
          questionsId: run.pendingQuestions.questionsId,
          askedAt: run.pendingQuestions.askedAt,
          questions: run.pendingQuestions.questions.map(({ key, label, question, why, suggestedAnswer, basis }) => ({
            key,
            label,
            question,
            why,
            suggestedAnswer,
            basis,
          })),
        },
      }),
    ...(run.state === 'failed' && failureText !== undefined && { failureText }),
    ...(run.state === 'failed' && run.failureReason && { failureReason: run.failureReason }),
    ...(run.state === 'failed' && (run.persistRetries ?? 0) >= MKTG_RUN_PERSIST_RETRY_MAX_ATTEMPTS && { persistenceFailed: true }),
  };
  return progress;
}

export function matchesMktgRunProgress(run: MktgDocumentRunProgress | null, agentKey?: string, documentId?: string): MktgDocumentRunProgress | null {
  return run && (!agentKey || run.agentKey === agentKey) && (!documentId || run.documentId === documentId) ? run : null;
}

export function mktgRunRenewAt(run: MktgStartedRunRecord, now: number): string {
  return new Date(Math.max(now, Date.parse(run.retryAt ?? run.startedAt) + 1)).toISOString();
}

export function isMktgRunClosed(state: MktgStoredDocumentRunState): boolean {
  return state === 'completed' || state === 'superseded' || state === 'discarded';
}

export function isMktgRunTerminal(state: MktgStoredDocumentRunState): boolean {
  return isMktgRunClosed(state) || state === 'failed';
}

export function isMktgRunAttemptId(value: string): boolean {
  return typeof value === 'string' && MKTG_STARTED_RUN_ATTEMPT_ID_REGEX.test(value);
}

/** Host-classified record metadata only, never arbitrary strings or agent prose. */
export function isMktgRunFailureReason(value: unknown): value is Member360FailureReason {
  return typeof value === 'string' && Object.hasOwn(MEMBER_360_FAILURE_MESSAGES, value);
}

export function mktgRunIdFromKey(key: string): string {
  return key.split('/').at(-1)?.slice(0, -5) ?? '';
}

/** Bounded dedup identity, never an authorization token; sessionId remains a separate version key. */
export function mktgRunResultIdentity(result: MktgRunResultResponse, preferReceipt = true): string {
  const sha = result.persistence?.content_sha256;
  if (preferReceipt && sha && MKTG_ARTIFACT_SHA256_REGEX.test(sha)) return sha;
  const text = JSON.stringify({ document: result.documentMarkdown, asset: result.asset, brandKit: result.brandKit });
  let first = 2166136261;
  let second = 5381;
  for (let i = 0; i < text.length; i++) {
    first = Math.imul(first ^ text.charCodeAt(i), 16777619) >>> 0;
    second = (Math.imul(second, 33) ^ text.charCodeAt(i)) >>> 0;
  }
  return first.toString(16).padStart(8, '0') + second.toString(16).padStart(8, '0');
}
