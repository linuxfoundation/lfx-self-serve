// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Pure helpers for the Marketing OS document store: the revision key layout
// `documents/{project}/{agentKey}/{documentId}/{sequence}-{sha256}.json`, the
// revision ids derived from it, and the "How it was made" wording. Hashing is
// deliberately not here (it is environment-specific); the server recomputes
// every sha with node:crypto.

import { MKTG_AGENTS } from '../constants/mktg-os-agents.constants';
import { MKTG_AGENT_INTAKES } from '../constants/mktg-run.constants';
import type { MktgDocumentRunProgress, MktgStartedRunRecord, MktgStoredDocumentRunState } from '../interfaces/mktg-document-run.interface';
import { MKTG_ARTIFACT_PARTITION_REGEX, MKTG_ARTIFACT_SHA256_REGEX } from '../constants/mktg-artifact.constants';
import {
  MKTG_DOCUMENT_ID_REGEX,
  MKTG_DOCUMENT_STORE_KEY_PREFIX,
  MKTG_DOCUMENT_TYPES,
  MKTG_LEGACY_REVISION_ID_PREFIX,
  MKTG_STARTED_RUN_ATTEMPT_ID_REGEX,
  MKTG_REVISION_GENERATED_LABEL,
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
import type { MktgRunPersistReceipt } from '../interfaces/mktg-run.interface';

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
export function findMktgRunIntake(key: string) {
  const type = findMktgDocumentType(key);
  const id = type?.catalogAgentId;
  return type?.kind === 'living' && id && MKTG_AGENTS.some((agent) => agent.id === id && agent.status === 'active') ? MKTG_AGENT_INTAKES[id] : undefined;
}

export function mktgRunProgress(run: MktgStartedRunRecord, fullReply = run.failureText): MktgDocumentRunProgress | null {
  if (run.state === 'completed' || run.state === 'superseded') {
    return null;
  }
  const progress: MktgDocumentRunProgress = {
    runId: run.runId,
    project: run.project,
    agentKey: run.agentKey,
    documentId: run.documentId,
    startedAt: run.startedAt,
    state: run.state,
    ...(run.state === 'failed' && fullReply !== undefined && { failureText: fullReply }),
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
  return state === 'completed' || state === 'superseded';
}

export function isMktgRunTerminal(state: MktgStoredDocumentRunState): boolean {
  return isMktgRunClosed(state) || state === 'failed';
}

export function isMktgRunAttemptId(value: string): boolean {
  return typeof value === 'string' && MKTG_STARTED_RUN_ATTEMPT_ID_REGEX.test(value);
}

export function mktgRunIdFromKey(key: string): string {
  return key.split('/').at(-1)?.slice(0, -5) ?? '';
}
