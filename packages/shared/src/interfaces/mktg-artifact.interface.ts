// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// ONE document-persistence contract for EVERY Marketing OS agent. The Brand
// Kit proved the shape (dec-brand-kit-storage-v2); these types are that shape
// with the agent-specific parts lifted into a spec, so the eight agents share
// one implementation instead of eight copies of it.

import type { MKTG_ARTIFACT_INTAKE_MODES } from '../constants/mktg-artifact.constants';
import type { MktgRevisionFormat } from './mktg-document-store.interface';
import type { MktgRunPersistReceipt } from './mktg-run.interface';

/**
 * Artifact namespace key of an agent that persists its document. This is the
 * ARTIFACT vocabulary (it names the storage partition and the BFF endpoint
 * namespace), deliberately not the marketplace catalog agent id: the Message
 * Foundation's catalog id is `foundation-setup` while its contract, its Guild
 * handle and its `/api/mktg-agents/foundation-message/*` routes all say
 * `foundation-message`. Keying storage by the catalog id would make the
 * storage layout hostage to a marketplace-facing label.
 */
export type MktgArtifactKey = 'brand-kit' | 'foundation-message' | 'icp' | 'boilerplates' | 'faq';

/**
 * How an agent's intake answers were collected. Every Marketing OS envelope
 * contract draws on the same vocabulary (`form` and `conversational`
 * everywhere; `prefill` — documents and no interviewee — since the ICP's
 * 0.4.0 re-pin), so the persistence layer can label a stored object without
 * knowing which agent wrote it.
 */
export type MktgArtifactIntakeMode = (typeof MKTG_ARTIFACT_INTAKE_MODES)[number];

/**
 * Everything that differs between agents when persisting a document — the
 * complete list. Everything else (the entitlement-checked partition, the size
 * gate, content-addressed keys, the shared bucket, object metadata, the
 * strictly-newer-draft metadata refresh, degrade-to-null) is identical by
 * contract and lives once in the shared persistence service.
 *
 * Adding a ninth agent is a new entry in `MKTG_ARTIFACT_SPECS` plus its BFF
 * wiring — never a new implementation.
 */
export interface MktgArtifactSpec {
  /** Artifact namespace key — the table key, restated so a spec is self-describing when passed alone. */
  agentKey: MktgArtifactKey;
  /**
   * Key-prefix namespace inside the ONE shared `marketing-os-artifacts`
   * bucket. Objects live at `{keyPrefix}/{project uid}/{content_sha256}.md`.
   */
  keyPrefix: string;
  /** Hard per-object size cap (bytes); a document above it is never persisted. */
  maxDocumentBytes: number;
  /**
   * Log-operation namespace. The persistence layer derives `{ns}_persist` and
   * `{ns}_stored_read` from it, so an agent's storage logs sit beside its
   * existing `{ns}_generate` / `{ns}_result` / `{ns}_stored` lines under one
   * grep without colliding with the controller's `{ns}_stored` lifecycle.
   */
  logNamespace: string;
}

/**
 * The only envelope fields the persistence layer reads. Every Marketing OS
 * agent envelope already carries them, which is why one implementation can
 * persist all of them: the document bytes, the sha the caller already
 * recomputed and verified, the draft version, and how intake was collected.
 *
 * Structural on purpose — `BrandKitEnvelope`, `FoundationMessageEnvelope` and
 * every later contract satisfy it without declaring that they do.
 */
export interface MktgArtifactEnvelope {
  /** The validated document in Markdown — the exact bytes persisted. */
  document_markdown: string;
  /** Lowercase hex SHA-256 of the UTF-8 document bytes, ALREADY recomputed and verified by the caller. */
  content_sha256: string;
  /** Document draft version within a run, starting at 1. */
  version: number;
  /** Intake log; only `mode` is read, and it rides as object metadata. */
  intake: { mode: MktgArtifactIntakeMode };
}

/**
 * The envelope fields the document store reads from an agent that writes a
 * structured asset instead of a document (the Messaging Framework): the JSON
 * content, the sha the caller already recomputed over `JSON.stringify(content)`
 * and verified, the draft version, and how intake was collected. Such an
 * envelope is stored as a revision only — nothing is written to the
 * pre-revision `.md` partition. `T` is the agent's content type (e.g.
 * `FoundationMessageContent`), so a typed envelope passes without a cast.
 */
export interface MktgArtifactJsonEnvelope<T extends object = Record<string, unknown>> {
  /** The validated JSON content — serialized with `JSON.stringify` to the exact bytes persisted. */
  content: T;
  /** Lowercase hex SHA-256 of `JSON.stringify(content)` (UTF-8), ALREADY recomputed and verified by the caller. */
  content_sha256: string;
  /** Draft version within a run, starting at 1. */
  version: number;
  /** Intake log; only `mode` is read. */
  intake: { mode: MktgArtifactIntakeMode };
}

/**
 * Receipt of a successful persistence write, for ANY agent. The generic
 * run-flow receipt ({@link MktgRunPersistReceipt}) plus the intake provenance
 * every Marketing OS contract records. Field names are snake_case (unlike the
 * camelCase enclosing responses) on purpose: they mirror the downstream
 * Artifact contract verbatim so minting needs no normalization layer — do not
 * camelCase them.
 */
export interface MktgArtifactPersistReceipt extends MktgRunPersistReceipt {
  /** How the intake answers were collected. */
  intake_mode: MktgArtifactIntakeMode;
}

/**
 * Response of an agent's `GET /api/mktg-agents/{agent}/stored?project=<uid>`
 * endpoint — plain and sidecar reads select the project's approved current.
 * Entitlement-gated (project writer) and partitioned by the SERVER-resolved
 * project uid, never client input. No approved selection returns 404, even
 * when stored Drafts exist. Only the server's true pre-revision plain fallback
 * remains; browser drafts never substitute for an approved attachment.
 */
export interface MktgArtifactStoredResponse {
  /**
   * The persisted content, integrity-checked against the content-addressed
   * key: the Markdown document, or — when {@link format} is `json` — the JSON
   * text of the asset (the Messaging Framework), byte for byte as stored.
   */
  documentMarkdown: string;
  /** What {@link documentMarkdown} holds; absent means Markdown (every pre-revision object). */
  format?: MktgRevisionFormat;
  /**
   * Receipt metadata of the returned object — the same fields minted by the
   * write path. `version` / `intake_mode` are read back from the object's
   * metadata; objects persisted before metadata was written report the
   * documented defaults (version 1, `form`).
   */
  receipt: MktgArtifactPersistReceipt;
  /** ISO-8601 timestamp the object was stored (S3 LastModified), when the store reports one. */
  storedAt?: string;
  /**
   * The revision's number in Documents (its position among the document's
   * revisions, in write order), on plain and sidecar reads — what names the revision
   * a consumer attaches. Not `receipt.version`: that is the agent's draft
   * version within its run, which restarts at 1 on every fresh run.
   */
  revisionNumber?: number;
  /**
   * The revision's sidecar JSON — the envelope's structured fields — on a
   * sidecar read (`?sidecar=true`: the Kit's approved current framework),
   * which is what a consumer attaching the document as JSON needs. The
   * plain approved-current read carries content text without the sidecar: a Brand Kit sidecar holds
   * the logo artwork, and the marketplace resolves every dependency on
   * every load.
   */
  sidecar?: Record<string, unknown> | null;
}
