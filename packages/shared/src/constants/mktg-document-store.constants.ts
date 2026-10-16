// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The Marketing OS document store: key layout, id shapes and the document
// types the Documents area lists. Revisions live in the same private
// `marketing-os-artifacts` bucket as the pre-revision artifacts, under their
// own `documents/` prefix.

import type { MktgArtifactIntakeMode } from '../interfaces/mktg-artifact.interface';
import type { MktgDocumentType } from '../interfaces/mktg-document-store.interface';
import type { MktgStoredDocumentRunState } from '../interfaces/mktg-document-run.interface';
import { MKTG_AGENTS } from './mktg-os-agents.constants';
import { MKTG_AGENT_INTAKES, MKTG_RUN_POLL } from './mktg-run.constants';

/** Documents reads, `POST …/restore`, and `POST …/runs/:runId/retry` share this base path. */
export const MKTG_DOCUMENTS_API_PATH = '/api/mktg-agents/documents';

/**
 * Session-keyed runs. Initial/navigation reads discover all ages; timer reads
 * use the recent poll window below. start/mark refresh the listed mtime.
 * Metadata/body reads use small bounded batches. Session-hash keys contain no
 * agent key, so agent filtering occurs after the body read, before Guild.
 */
export const MKTG_STARTED_RUN_PREFIX = 'document-runs';
/** Only automatic poll reads skip entries older than one hour; this is NOT a discovery/retention limit. */
export const MKTG_STARTED_RUN_POLL_WINDOW_MS = 6 * MKTG_RUN_POLL.timeoutMs;
/** Maximum concurrent per-entry HEAD/GET workers; navigation discovery remains unbounded by age. */
export const MKTG_STARTED_RUN_READ_CONCURRENCY = 4;
export const MKTG_STARTED_RUN_SCHEMA = 'mktg-started-run/v1';
export const MKTG_STARTED_RUN_ID_REGEX = /^[0-9a-f]{64}$/;
/** Metadata transitions within one attempt only move forward; an explicit retry has a newer retry-at. */
export const MKTG_STARTED_RUN_STATE_ORDER: Record<MktgStoredDocumentRunState, number> = {
  writing: 0,
  storing: 1,
  failed: 2,
  superseded: 3,
  completed: 4,
};

/** Key prefix of every revision: `documents/{project}/{agentKey}/{documentId}/{sequence}-{sha256}.json`. */
export const MKTG_DOCUMENT_STORE_KEY_PREFIX = 'documents';

/** Schema id written into every stored revision record. */
export const MKTG_REVISION_SCHEMA = 'mktg-document-revision/v1';

/** Object key suffix of a stored revision record. */
export const MKTG_REVISION_KEY_SUFFIX = '.json';

/** Content type revision records are written with. */
export const MKTG_REVISION_CONTENT_TYPE = 'application/json; charset=utf-8';

/** Digits of the zero-padded write sequence that leads a revision key, so keys sort in write order. */
export const MKTG_REVISION_SEQUENCE_DIGITS = 6;

/** Document id of a living document: one per project and agent. */
export const MKTG_LIVING_DOCUMENT_ID = 'living';

/** Prefix of a one-off run's document id (`run-` + 24 hex characters derived from the run's session). */
export const MKTG_RUN_DOCUMENT_ID_PREFIX = 'run-';

/** Shape of a document id: the living id, or a run id. One safe key segment either way. */
export const MKTG_DOCUMENT_ID_REGEX = /^(living|run-[0-9a-f]{24})$/;

/** Prefix of the id of a living document's revision 1 that is still read from the pre-revision store. */
export const MKTG_LEGACY_REVISION_ID_PREFIX = 'legacy-';

/** Shape of a revision id: `{sequence}-{sha256}` for a stored revision, `legacy-{sha256}` for a not-yet-migrated one. */
export const MKTG_REVISION_ID_REGEX = /^([0-9]{6}-[0-9a-f]{64}|legacy-[0-9a-f]{64})$/;

/** The catalog's display name for an agent, so a rename in MKTG_AGENTS reaches the Documents area. */
function catalogAgentName(catalogAgentId: string): string {
  const agent = MKTG_AGENTS.find((a) => a.id === catalogAgentId);
  if (!agent) {
    throw new Error(`Unknown Marketing OS catalog agent: ${catalogAgentId}`);
  }
  return agent.name;
}

/** The intake's document name for a living document, so a rename in MKTG_AGENT_INTAKES reaches the Documents area. */
function intakeDocumentName(catalogAgentId: string): string {
  const intake = MKTG_AGENT_INTAKES[catalogAgentId];
  if (!intake) {
    throw new Error(`No Marketing OS intake for catalog agent: ${catalogAgentId}`);
  }
  return intake.documentName;
}

/**
 * Document types in the order the Documents area lists them: living
 * documents in run order (the marketplace's agent numbers), then the one-off
 * run types. Living documents are read from the pre-revision store until
 * their first revision is written, so each names its legacy artifact key.
 */
export const MKTG_DOCUMENT_TYPES: MktgDocumentType[] = [
  {
    agentKey: 'brand-kit',
    kind: 'living',
    catalogAgentId: 'brand-kit',
    agentName: catalogAgentName('brand-kit'),
    label: intakeDocumentName('brand-kit'),
    itemLabel: intakeDocumentName('brand-kit'),
    legacyArtifactKey: 'brand-kit',
  },
  {
    agentKey: 'foundation-message',
    kind: 'living',
    catalogAgentId: 'foundation-setup',
    agentName: catalogAgentName('foundation-setup'),
    label: intakeDocumentName('foundation-setup'),
    itemLabel: intakeDocumentName('foundation-setup'),
    legacyArtifactKey: 'foundation-message',
  },
  {
    agentKey: 'icp',
    kind: 'living',
    catalogAgentId: 'icp',
    agentName: catalogAgentName('icp'),
    label: intakeDocumentName('icp'),
    itemLabel: intakeDocumentName('icp'),
    legacyArtifactKey: 'icp',
  },
  {
    agentKey: 'aeo-geo',
    kind: 'run',
    catalogAgentId: 'aeo-geo',
    agentName: catalogAgentName('aeo-geo'),
    label: 'AEO/GEO reports',
    itemLabel: 'AEO/GEO report',
  },
  {
    agentKey: 'linkedin-post',
    kind: 'run',
    catalogAgentId: 'linkedin-post',
    agentName: catalogAgentName('linkedin-post'),
    label: 'LinkedIn posts',
    itemLabel: 'LinkedIn post',
  },
  {
    agentKey: 'member-360',
    kind: 'run',
    // Member 360 has no catalog entry yet, so its name is spelled out here.
    agentName: 'Member 360 Agent',
    label: 'Member 360',
    itemLabel: 'Member 360 run',
  },
];

/** "How it was made" for a generated revision, by intake mode. */
export const MKTG_REVISION_GENERATED_LABEL: Record<MktgArtifactIntakeMode, string> = {
  form: 'Generated from the form',
  conversational: 'Generated in a conversation with the agent',
  prefill: 'Generated from the form with your existing documents (pre-fill)',
};
