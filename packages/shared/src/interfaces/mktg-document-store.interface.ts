// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The Marketing OS document store: every stored agent output is a DOCUMENT
// with an append-only list of REVISIONS, per project and agent. Living
// documents (Brand Kit, Message Foundation, ICP) gain a revision each time
// they are generated or revised; one-off runs (AEO/GEO reports, LinkedIn
// posts, Member 360) are documents with exactly one revision — a new run is a
// new document. Make current changes a separate mutable pointer, not history.
//
// A revision record is immutable and content-addressed by its own bytes, so it
// carries no personal identity (no user names or usernames): a value that a
// deletion or anonymization request could require removing must never be
// inside the hashed bytes, or removing it would drop the revision.

import type { MktgRebuildStaleness, MktgRevisionRef } from './mktg-rebuild.interface';
import type { LinkedinDocumentContent } from './linkedin-post.interface';
import type { MktgArtifactIntakeMode, MktgArtifactKey } from './mktg-artifact.interface';
import type { Member360Envelope } from './member-360.interface';
import type { MktgDocumentRunSnapshot } from './mktg-document-run.interface';

/**
 * Agent key of a document type — the artifact namespace for the agents that
 * already persist through the shared artifact layer, plus the one-off run
 * agents whose outputs are documents too.
 */
export type MktgDocumentAgentKey = MktgArtifactKey | 'faq' | 'aeo-geo' | 'linkedin-post' | 'member-360';

/**
 * `living` documents are updated in place (a new revision each time);
 * `run` documents are one-off outputs that are never updated.
 */
export type MktgDocumentKind = 'living' | 'run';

/**
 * How a revision came to exist:
 * - `generated`: an agent run produced it;
 * - `revised`: the future comment-and-revise writer produced it;
 * - `restored`: historical copies made before current pointers existed;
 * - `legacy`: the document was stored before revisions existed and became revision 1.
 */
export type MktgRevisionOrigin = 'generated' | 'revised' | 'restored' | 'legacy';

/** Public attribution resolved from the directory at read time; never includes a stored identity. */
export interface MktgRevisionAuthor {
  name: string | null;
}

/** Mutable approval annotation; never put in a revision's hashed bytes. */
export interface MktgDocumentApprovalAnnotation {
  approvedAt: string;
  approvedBy: string | null;
}

export interface MktgRevisionApproval {
  approvedAt: string;
  approvedBy: MktgRevisionAuthor | null;
}

export interface MktgApprovedCurrent {
  revisionId: string;
  number: number;
}

/** Server-only stored record; never an API response. Names are resolved at read time. */
export interface MktgDocumentCurrentRecord {
  revisionId: string;
  changedAt: string;
  /** Opaque effective Auth0 subject, never a name, username or email. */
  changedBy: string | null;
  /** Only these revisions are committed; interrupted writes remain invisible. */
  revisionIds: string[];
  /** Optional for all records written before approval support. Unknown shapes mean no approvals. */
  approvals?: Record<string, MktgDocumentApprovalAnnotation>;
}

/** Server-only stored record and compare-and-swap token; never an API response. */
export interface MktgDocumentCurrentSnapshot {
  record: MktgDocumentCurrentRecord | null;
  etag?: string;
}

/** Public selection attribution, without stored user IDs or the committed-revision manifest. */
export interface MktgDocumentCurrentSelection {
  revisionId: string;
  changedAt: string;
  changedBy: MktgRevisionAuthor | null;
}

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
 * What a revision's content is: a Markdown document, or the JSON text of a
 * structured asset (the Messaging Framework's `{ mf, icp, mh, nums }`).
 */
export type MktgRevisionFormat = 'markdown' | 'json';

/**
 * The agent's bundle of one revision. `markdown` is the content text: the
 * Markdown document, or — for `format: 'json'` — the JSON text of the asset,
 * exactly the bytes `contentSha256` hashes. The sidecar holds the rest of
 * the envelope (the report, the inputs record, the intake answers, the
 * structure) and the brand file the agent applied, when it delivers one.
 * Revisions migrated from the pre-revision store carry the Markdown only.
 */
export interface MktgRevisionBundle {
  markdown: string;
  /** Lowercase hex SHA-256 of the UTF-8 content bytes. */
  contentSha256: string;
  /** Absent on records written before structured assets existed: Markdown. */
  format?: MktgRevisionFormat;
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
  /** Current revision the writer used as its base; absent on historical records. */
  basedOnId?: string | null;
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
  /** Null when historical data did not record an intake mode. */
  intakeMode: MktgArtifactIntakeMode | null;
  /** Review status as the document states it (`Draft — pre-filled from your documents`); empty when it states none. */
  status: string;
  contentSha256: string;
  /** Whether the revision's content is a Markdown document or a JSON asset. */
  format: MktgRevisionFormat;
  commentCount: number;
  /** Server-owned captured input identity, read from summary metadata without loading the body. */
  upstreamFramework?: MktgRevisionRef | null;
  /** Current, not necessarily newest (kept for existing consumers). */
  latest: boolean;
  approval: MktgRevisionApproval | null;
  author?: MktgRevisionAuthor | null;
  draftVersion?: number;
  basedOnNumber?: number | null;
}

/** A document in the Documents area navigation (no revision details). */
export interface MktgDocumentListItem {
  agentKey: MktgDocumentAgentKey;
  documentId: string;
  revisionCount: number;
  /** Current revision id, not necessarily the newest revision. */
  latestRevisionId: string;
  approvedCurrent: MktgApprovedCurrent | null;
  currentRevisionNumber?: number;
  /** Current content hash from summary metadata; absent for old API producers. */
  contentSha256?: string;
  upstreamFramework?: MktgRevisionRef | null;
  /** Server-only policy projection: clients render this value, never infer it from dates. */
  needsRebuild?: MktgRebuildStaleness | null;
  /** When the current revision was stored (not when it was made current). */
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
export interface MktgDocumentsResponse extends Partial<MktgDocumentRunSnapshot> {
  project: string;
  groups: MktgDocumentGroup[];
  /** Approved-current framework identity for the Downstream card and rebuild precondition. */
  approvedFramework?: MktgRevisionRef | null;
}

/** Response of `GET /api/mktg-agents/documents/:agentKey/:documentId?project=<uid>`: the document and its revisions, newest first. */
export interface MktgDocumentDetailResponse extends Partial<MktgDocumentRunSnapshot> {
  project: string;
  type: MktgDocumentType;
  documentId: string;
  revisions: MktgRevisionSummary[];
  approvedCurrent: MktgApprovedCurrent | null;
  /** Absent/null for documents whose newest revision is current by default. */
  current?: MktgDocumentCurrentSelection | null;
}

/** Snake-case location nested in an artifact persistence receipt. */
export interface MktgDocumentPersistLocation {
  agent_key: MktgDocumentAgentKey;
  document_id: string;
  revision_id: string;
}

/** Exact stored revision produced by a result poll, never whichever revision happens to be current. */
export interface MktgDocumentLocation {
  agentKey: MktgDocumentAgentKey;
  documentId: string;
  revisionId: string;
}

/** Response of `GET /api/mktg-agents/documents/:agentKey/:documentId/revisions/:revisionId?project=<uid>`. */
export interface MktgRevisionResponse extends MktgDocumentDetailResponse {
  revision: MktgRevisionSummary;
  approval: MktgRevisionApproval | null;
  /** The content text: the Markdown document, or the JSON text of the asset when `revision.format` is `json`. */
  markdown: string;
  /**
   * The revision's sidecar — the envelope's structured fields — when the
   * stored record has one; null for a migrated revision. The Brand Kit view
   * renders the kit from it; the framework view reads the report and the
   * inputs record from it.
   */
  sidecar: Record<string, unknown> | null;
  /** Validated read-only LinkedIn cards and LFX-side link/provenance metadata. */
  linkedinPost?: LinkedinDocumentContent;
  /** Validated structured document type; absent for prose documents. */
  member360?: Member360Envelope;
}

/** Body of `POST /api/mktg-agents/documents/:agentKey/:documentId/restore`. */
export interface MktgRestoreRevisionRequest {
  project: string;
  revisionId: string;
}

/** Response of Make current (the compatibility route remains `/restore`): no new revision. */
export interface MktgRestoreRevisionResponse extends MktgDocumentDetailResponse {
  revision: MktgRevisionSummary;
}

/** A stored revision read back, integrity-checked. */
export interface MktgStoredRevision {
  /** Server-only object metadata; never returned by the document HTTP projection. */
  authorId?: string;
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
  metadata?: Record<string, string>;
  /** Historical bodies loaded only when summary metadata is incomplete. */
  record?: MktgRevisionRecord;
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

/**
 * What one generation hands the revision writer: the content text (a Markdown
 * document, or the JSON text of an asset), its sha, the format, the rest of
 * the envelope as the sidecar, and the run's draft version and intake mode.
 */
export interface MktgRevisionContentSource {
  text: string;
  contentSha256: string;
  format: MktgRevisionFormat;
  sidecar: Record<string, unknown> | null;
  version: number;
  intakeMode: MktgArtifactIntakeMode;
}

/** The fields of a revision record its writer chooses; the store fills in the rest. */
export type MktgRevisionRecordFields = Pick<MktgRevisionRecord, 'createdAt' | 'origin' | 'restoredFromId' | 'source' | 'bundle' | 'basedOnId'> &
  Partial<Pick<MktgRevisionRecord, 'comments' | 'deck'>>;

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
  /** Resolved name, unavailable-name label, or the historical no-author label. */
  authorLabel: string;
}

/** The Documents area's selected living document (view model). */
export interface MktgSelectedLivingDocument {
  type: MktgDocumentType;
  document: MktgDocumentListItem | null;
}
