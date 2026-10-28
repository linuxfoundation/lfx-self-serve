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

/** Documents API: `GET ?project=`, `GET /:agentKey/:documentId`, `GET …/revisions/:revisionId`, `POST …/restore`, `POST …/runs/:runId/retry`. */
export const MKTG_DOCUMENTS_API_PATH = '/api/mktg-agents/documents';

/** Private session-keyed starts. Key enumeration is full; HEAD/GET/Guild discovery uses the bounded newest-mtime window. */
export const MKTG_STARTED_RUN_PREFIX = 'document-runs';
/** Only automatic timer reads skip older entries; not a discovery or retention limit. */
export const MKTG_STARTED_RUN_POLL_WINDOW_MS = 6 * MKTG_RUN_POLL.timeoutMs;
/** Bounded HEAD/GET workers; filter by agent after the body read, before Guild. */
export const MKTG_STARTED_RUN_READ_CONCURRENCY = 4;
export const MKTG_STARTED_RUN_DISCOVERY_LIMIT = 128;
export const MKTG_STARTED_RUN_TERMINAL_CACHE_LIMIT = 256;
/** Do not memoize S3's still-current write second; all local writes invalidate the cache too. */
export const MKTG_STARTED_RUN_CACHE_STABLE_MS = 2000;
/** Base64 encoding this UTF-8 snapshot stays below the total object-metadata budget. */
export const MKTG_STARTED_RUN_FAILURE_BYTES = 768;
/** ASCII turn-id ledger; never evict accepted ACKs to make room for another turn. */
export const MKTG_STARTED_RUN_ATTEMPT_HISTORY_BYTES = 384;
/** Schema tag stamped on every MktgStartedRunRecord in the private document store. */
export const MKTG_STARTED_RUN_SCHEMA = 'mktg-started-run/v1';
/** Automatic progress reads back off on availability failures, not on human questions pauses. */
export const MKTG_DOCUMENT_PROGRESS_POLL = { maxBackoffMs: 8 * MKTG_RUN_POLL.intervalMs } as const;
export const MKTG_STARTED_RUN_ID_REGEX = /^[0-9a-f]{64}$/;
export const MKTG_STARTED_RUN_ATTEMPT_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;
/** Metadata within one attempt advances only; explicit retries have a newer retry-at. */
export const MKTG_STARTED_RUN_STATE_ORDER: Record<MktgStoredDocumentRunState, number> = {
  writing: 0,
  questions: 1,
  storing: 2,
  failed: 3,
  superseded: 4,
  completed: 5,
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
export const MKTG_REVISION_ID_REGEX = /^((?!000000)[0-9]{6}-[0-9a-f]{64}|legacy-[0-9a-f]{64})$/;

/** Bounded metadata fan-out and optimistic write attempts. */
export const MKTG_DOCUMENT_READ_CONCURRENCY = 4;
export const MKTG_DOCUMENT_WRITE_ATTEMPTS = 8;
export const MKTG_DOCUMENT_CURRENT_KEY = 'current.json';

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
    structuredView: 'brand-kit',
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
  // Stored as JSON revisions from its first run: there is no pre-revision copy to read.
  {
    agentKey: 'boilerplates',
    kind: 'living',
    catalogAgentId: 'boilerplates',
    agentName: catalogAgentName('boilerplates'),
    label: intakeDocumentName('boilerplates'),
    itemLabel: intakeDocumentName('boilerplates'),
  },
  // The FAQ was stored as revisions from its first run: it has no pre-revision partition.
  {
    agentKey: 'faq',
    kind: 'living',
    catalogAgentId: 'faq',
    agentName: catalogAgentName('faq'),
    label: intakeDocumentName('faq'),
    itemLabel: intakeDocumentName('faq'),
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
    catalogAgentId: 'member-360',
    agentName: catalogAgentName('member-360'),
    label: 'Member 360',
    itemLabel: 'Member 360 run',
  },
];

/** Collapsed document-view history keeps this many newest revisions, plus open/current rows. */
export const MKTG_DOCUMENT_REVISION_PREVIEW_COUNT = 5;

/** Side-panel action help, shared by its tooltip and accessible description. */
export const MKTG_DOCUMENT_MAKE_CURRENT_HINT = 'Agents read the current version. Nothing is added or deleted.';

/** Maximum status characters stored in S3 metadata, including the truncation ellipsis. */
export const MKTG_REVISION_STATUS_METADATA_MAX_CHARS = 200;

/** Historical attribution placeholder when no author record was stored. */
export const MKTG_REVISION_UNKNOWN_AUTHOR_LABEL = 'no name (stored before names were recorded)';

/** Neutral attribution placeholder when a stored author's display name is unavailable. */
export const MKTG_REVISION_NAME_UNAVAILABLE_LABEL = 'name unavailable';

/** "How it was made" for a generated revision, by intake mode. */
export const MKTG_REVISION_GENERATED_LABEL: Record<MktgArtifactIntakeMode, string> = {
  form: 'generated from the form',
  conversational: 'generated in a conversation with the agent',
  prefill: 'generated from the form with your existing documents (pre-fill)',
};
