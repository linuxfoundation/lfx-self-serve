// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The Marketing OS document store: every stored agent output is a DOCUMENT
// with an append-only list of REVISIONS, per project and agent. Living
// documents (Brand Kit, Message Foundation, ICP) gain a revision each time
// they are generated or restored; one-off runs (AEO/GEO reports, LinkedIn
// posts, Member 360) are documents with exactly one revision — a new run is a
// new document. Nothing is ever deleted: restoring copies an older revision
// into a new, latest one.
//
// A revision record is immutable and content-addressed by its own bytes, so it
// carries no personal identity (no user names or usernames): a value that a
// deletion or anonymization request could require removing must never be
// inside the hashed bytes, or removing it would drop the revision.

import type { MktgArtifactIntakeMode, MktgArtifactKey } from './mktg-artifact.interface';

/**
 * Agent key of a document type — the artifact namespace for the agents that
 * already persist through the shared artifact layer, plus the one-off run
 * agents whose outputs are documents too.
 */
export type MktgDocumentAgentKey = MktgArtifactKey | 'aeo-geo' | 'linkedin-post' | 'member-360';

/**
 * `living` documents are updated in place (a new revision each time);
 * `run` documents are one-off outputs that are never updated.
 */
export type MktgDocumentKind = 'living' | 'run';

/**
 * How a revision came to exist:
 * - `generated`: an agent run produced it;
 * - `restored`: a user restored an older revision, copied into a new one;
 * - `legacy`: the document was stored before revisions existed and became revision 1.
 */
export type MktgRevisionOrigin = 'generated' | 'restored' | 'legacy';

/** One document type of the store, in the order the Documents area lists them. */
export interface MktgDocumentType {
  agentKey: MktgDocumentAgentKey;
  kind: MktgDocumentKind;
  /** Marketplace catalog agent id, when the agent is in the catalog. */
  catalogAgentId?: string;
  /** Name of the agent that writes the document, e.g. `Brand Kit Agent`. */
  agentName: string;
  /** Document name for living documents (`Brand Kit`), group name for runs (`LinkedIn posts`). */
  label: string;
  /** Name of one document of the type: the document name for living documents, one run's name for runs (`LinkedIn post`). */
  itemLabel: string;
  /**
   * Artifact spec key of the pre-revision store (`{keyPrefix}/{project}/{sha}.md`)
   * whose latest object becomes revision 1 of a living document. Absent for
   * agents that never wrote there.
   */
  legacyArtifactKey?: MktgArtifactKey;
}

/**
 * The agent's bundle of one revision. The Markdown is the document; the
 * sidecar holds the envelope's structured fields (intake answers, inputs,
 * structure) and the brand file the brand the agent applied, when the agent
 * delivers one. Revisions migrated from the pre-revision store carry the
 * Markdown only.
 */
export interface MktgRevisionBundle {
  markdown: string;
  /** Lowercase hex SHA-256 of the UTF-8 Markdown bytes. */
  contentSha256: string;
  sidecar: Record<string, unknown> | null;
  brandFile: string | null;
}

/** A reviewer comment that produced a revision. Stored now, written by the comment-and-revise flow. */
export interface MktgRevisionComment {
  /** The exact passage the comment is anchored to. */
  anchor: string;
  text: string;
  /**
   * Opaque reference to the commenter, resolved to a display name when read.
   * Never a name or username: the record is immutable and content-addressed.
   */
  author: string;
  createdAt: string;
}

/** The formatter's deck for a revision: its slide spec and the link to the built deck. Empty until the formatter runs. */
export interface MktgRevisionDeck {
  spec: Record<string, unknown> | null;
  link: string | null;
}

/** Where a generated revision came from. */
export interface MktgRevisionSource {
  /** Guild session that produced it; null for restored and migrated revisions. */
  sessionId: string | null;
  /** The envelope's draft version within its run (a label, never an ordering). */
  draftVersion: number;
  intakeMode: MktgArtifactIntakeMode;
}

/**
 * One revision as stored: a JSON object at
 * `documents/{project}/{agentKey}/{documentId}/{sequence}-{sha256}.json`,
 * content-addressed by the SHA-256 of its own bytes and never rewritten.
 */
export interface MktgRevisionRecord {
  schema: string;
  project: string;
  agentKey: MktgDocumentAgentKey;
  documentId: string;
  /** Write sequence within the document, starting at 1. */
  sequence: number;
  createdAt: string;
  origin: MktgRevisionOrigin;
  /** Revision id this one was restored from (`restored` only). */
  restoredFromId: string | null;
  source: MktgRevisionSource;
  bundle: MktgRevisionBundle;
  comments: MktgRevisionComment[];
  deck: MktgRevisionDeck;
}

/** A revision as the Documents area lists it — everything but the bundle. */
export interface MktgRevisionSummary {
  /** Revision id: `{sequence}-{sha256}` for stored revisions, `legacy-{sha256}` for a not-yet-migrated revision 1. */
  id: string;
  /** Revision number shown to users (v1, v2, …), by write order. */
  number: number;
  createdAt: string | null;
  origin: MktgRevisionOrigin;
  /** Number of the revision this one was restored from (`restored` only). */
  restoredFromNumber: number | null;
  intakeMode: MktgArtifactIntakeMode;
  /** Review status as the document states it (`Draft — pre-filled from your documents`); empty when it states none. */
  status: string;
  contentSha256: string;
  commentCount: number;
  latest: boolean;
}

/** A document in the Documents area navigation (no revision details). */
export interface MktgDocumentListItem {
  agentKey: MktgDocumentAgentKey;
  documentId: string;
  revisionCount: number;
  latestRevisionId: string;
  /** When the latest revision was stored. */
  updatedAt: string | null;
  /** When the first revision was stored (the run date of a one-off run). */
  createdAt: string | null;
}

/** One document type with its documents for the active project. */
export interface MktgDocumentGroup {
  type: MktgDocumentType;
  /** Living types hold zero or one document; run types one per run, newest first. */
  documents: MktgDocumentListItem[];
}

/** Response of `GET /api/mktg-agents/documents?project=<uid>`. */
export interface MktgDocumentsResponse {
  project: string;
  groups: MktgDocumentGroup[];
}

/** Response of `GET /api/mktg-agents/documents/:agentKey/:documentId?project=<uid>`: the document and its revisions, newest first. */
export interface MktgDocumentDetailResponse {
  project: string;
  type: MktgDocumentType;
  documentId: string;
  revisions: MktgRevisionSummary[];
}

/** Response of `GET /api/mktg-agents/documents/:agentKey/:documentId/revisions/:revisionId?project=<uid>`. */
export interface MktgRevisionResponse extends MktgDocumentDetailResponse {
  revision: MktgRevisionSummary;
  markdown: string;
}

/** Body of `POST /api/mktg-agents/documents/:agentKey/:documentId/restore`. */
export interface MktgRestoreRevisionRequest {
  project: string;
  revisionId: string;
}

/** Response of a restore: the document with its new latest revision. */
export interface MktgRestoreRevisionResponse extends MktgDocumentDetailResponse {
  revision: MktgRevisionSummary;
}

/** A stored revision read back, integrity-checked. */
export interface MktgStoredRevision {
  id: string;
  key: string;
  record: MktgRevisionRecord;
}

/** A revision key taken apart. */
export interface ParsedMktgRevisionKey {
  agentKey: MktgDocumentAgentKey;
  documentId: string;
  sequence: number;
  sha: string;
  /** Revision id: `{sequence}-{sha}`. */
  id: string;
}

/** A listed revision key with the store's write time. */
export interface MktgListedRevision extends ParsedMktgRevisionKey {
  key: string;
  lastModified?: Date;
}

/** A listed pre-revision artifact of a living document. */
export interface MktgLegacyListing {
  key: string;
  sha: string;
  lastModified?: Date;
}

/** A pre-revision artifact read back as a living document's revision 1. */
export interface MktgLegacyDocument {
  sha: string;
  key: string;
  markdown: string;
  storedAt: string | null;
  draftVersion: number;
  intakeMode: MktgArtifactIntakeMode;
}

/** The fields of a revision record its writer chooses; the store fills in the rest. */
export type MktgRevisionRecordFields = Pick<MktgRevisionRecord, 'createdAt' | 'origin' | 'restoredFromId' | 'source' | 'bundle'>;

/** An entry of the Documents area navigation (view model). */
export interface MktgDocumentNavItem {
  type: MktgDocumentType;
  /** Text shown with "{position} · {label}" for living documents; null for runs. */
  position: number | null;
  /** `v3 · current`, `Not generated yet`, `12 runs`, … */
  badge: string;
  badgeClass: string;
  selected: boolean;
}

/** A row of the Revisions table and panel (view model). */
export interface MktgRevisionRow {
  revision: MktgRevisionSummary;
  /** "How it was made". */
  how: string;
}

/** The Documents area's selected living document (view model). */
export interface MktgSelectedLivingDocument {
  type: MktgDocumentType;
  document: MktgDocumentListItem | null;
}
