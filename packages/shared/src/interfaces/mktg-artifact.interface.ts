// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// ONE document-persistence contract for EVERY Marketing OS agent. The Brand
// Kit proved the shape (dec-brand-kit-storage-v2); these types are that shape
// with the agent-specific parts lifted into a spec, so the eight agents share
// one implementation instead of eight copies of it.

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
export type MktgArtifactKey = 'brand-kit' | 'foundation-message' | 'icp';

/**
 * How an agent's intake answers were collected. Every Marketing OS envelope
 * contract defines the same two modes, so the persistence layer can label a
 * stored object without knowing which agent wrote it.
 */
export type MktgArtifactIntakeMode = 'form' | 'conversational';

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
   * `{ns}_stored` from it, so an agent's storage logs sit beside its existing
   * `{ns}_generate` / `{ns}_result` lines under one grep.
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
 * endpoint — the project's LATEST server-persisted document for that agent
 * (the dec-agent-dependency-gating read path). Entitlement-gated (project
 * writer) and partitioned by the SERVER-resolved project uid, never client
 * input; a project with nothing persisted returns 404.
 *
 * "Latest" means most recently WRITTEN for the project — the only ordering
 * that holds across the multiple writers, browsers and sessions that share one
 * partition (see {@link MktgRunPersistReceipt.version}).
 */
export interface MktgArtifactStoredResponse {
  /** The persisted document (Markdown), integrity-checked against the content-addressed key. */
  documentMarkdown: string;
  /**
   * Receipt metadata of the returned object — the same fields minted by the
   * write path. `version` / `intake_mode` are read back from the object's
   * metadata; objects persisted before metadata was written report the
   * documented defaults (version 1, `form`).
   */
  receipt: MktgArtifactPersistReceipt;
  /** ISO-8601 timestamp the object was stored (S3 LastModified), when the store reports one. */
  storedAt?: string;
}
