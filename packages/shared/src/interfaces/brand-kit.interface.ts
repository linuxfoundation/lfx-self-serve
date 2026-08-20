// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Brand Kit output envelope contract (brand-kit-output/v1) shared between the
// Express BFF session-consumer and the Angular intake-form surface. Transcribed
// from marketing-os-agents docs/contracts/brand-kit-output.schema.json — the
// JSON Schema file is normative; this must stay in sync (reviewed at PR).

import { MktgRunGenerateBody, MktgRunPersistReceipt, MktgRunResultBody, MktgRunResultResponse, MktgRunSessionResponse } from './mktg-run.interface';

/** One verbatim intake Q/A pair (Paul's fixed 7-question order). */
export interface BrandKitIntakeAnswer {
  /** Question position, 1–7. */
  question_number: number;
  /** The intake question text as asked (verbatim). */
  question: string;
  /** The user's answer, verbatim and untranslated. */
  answer: string;
}

/** How the intake answers were collected. */
export type BrandKitIntakeMode = 'form' | 'conversational';

/** Machine-readable log of the 7-question intake. */
export interface BrandKitIntake {
  /** How the 7 answers were collected. */
  mode: BrandKitIntakeMode;
  /** ISO-8601 timestamp when intake completed — UTC by producer contract, but the shape gate accepts any offset. */
  completed_at: string;
  /** Exactly 7 entries, in Paul's fixed question order. */
  answers: BrandKitIntakeAnswer[];
}

/** Producer provenance, filled by the agent wrapper. */
export interface BrandKitAgentProvenance {
  /** Guild agent identifier (owner~name). */
  identifier?: string;
  /** Published Guild agent version that produced the document (semver). */
  agent_version?: string;
  /** SHA-256 of the FIDELITY-MANIFEST.sha256 the prompt substance verified against. */
  prompt_manifest_sha256?: string;
}

/**
 * The Brand Kit output envelope — the typed output of the
 * linux-foundation~brand-kit agent and the exact payload the BFF validates
 * before surfacing the document (persistence per dec-brand-kit-storage-v1
 * is deferred; this iteration displays the document only).
 */
export interface BrandKitEnvelope {
  /** Contract discriminator + version; consumers reject unknown majors. */
  contract: string;
  /** Document kind — always 'brand-kit' for this contract. */
  kind: string;
  /** Project slug — storage partition (lowercase kebab-case). */
  project: string;
  /** The project's display name exactly as given in intake Q1. */
  project_name?: string;
  /** Document draft version within a session lifecycle, starting at 1. */
  version: number;
  /** The complete Brand Kit document in Markdown (Paul's template verbatim-structured). */
  document_markdown: string;
  /** Lowercase hex SHA-256 of the UTF-8 bytes of document_markdown. */
  content_sha256: string;
  /** Verbatim intake log. */
  intake: BrandKitIntake;
  /** ISO-8601 timestamp when this draft was emitted — UTC by producer contract, but the shape gate accepts any offset. */
  generated_at?: string;
  /** Producer provenance. */
  agent?: BrandKitAgentProvenance;
}

/** One question rendered on the LFX one-page intake form. */
export interface BrandKitIntakeQuestion {
  /** Position 1-7 in Paul's fixed order. */
  questionNumber: number;
  /** Paul's exact Step 1 wording (verbatim). */
  question: string;
  /** Stable form-control key for the answer. */
  key: string;
}

/**
 * Request body for `POST /api/mktg-agents/brand-kit/generate` — all 7 of
 * Paul's intake answers collected on a single page (dec-brand-kit-intake-form),
 * open-ended and verbatim, keyed by `BrandKitIntakeQuestion.key` in order.
 * Aliased to the generic run-flow body so the form-first run shell (driven by
 * `MktgAgentIntake.endpoints`) is compile-bound to this endpoint's contract.
 */
export type BrandKitGenerateRequest = MktgRunGenerateBody;

/** Response of `POST /api/mktg-agents/brand-kit/generate` — the session to poll (generic run-flow shape). */
export type BrandKitGenerateResponse = MktgRunSessionResponse;

/** Request body for `POST /api/mktg-agents/brand-kit/result` — the token travels in the body (never the query string) so it stays out of access logs (generic run-flow shape). */
export type BrandKitResultRequest = MktgRunResultBody;

/**
 * Receipt of a successful Brand Kit persistence write (dec-brand-kit-storage-v2).
 * The generic run-flow receipt ({@link MktgRunPersistReceipt}: `s3_key` —
 * here always `brand-kit/{project}/{content_sha256}.md` — plus
 * `content_sha256`, `project`, `version`) with the intake provenance this
 * contract adds. Together they carry exactly the fields needed for later
 * Artifact metadata minting (deferred behind wi-lfx-one-service-actor) — no
 * graph writes happen now. Field names are snake_case (unlike the camelCase
 * enclosing response) on purpose: they mirror the downstream Artifact
 * contract verbatim so minting needs no normalization layer — do not
 * camelCase them.
 */
export interface BrandKitPersistReceipt extends MktgRunPersistReceipt {
  /** How the intake answers were collected. */
  intake_mode: BrandKitIntakeMode;
}

/**
 * Response of `GET /api/mktg-agents/brand-kit/stored?project=<uid>` — the
 * project's LATEST server-persisted Brand Kit document (dec-agent-dependency-gating
 * read path). The endpoint is entitlement-gated (project writer) and the
 * storage partition is derived from the server-resolved project uid, never
 * client input; a project with nothing persisted returns 404.
 *
 * "Latest" means most recently written for the project — the only ordering
 * that holds across the multiple writers, browsers and sessions that share one
 * partition (see {@link BrandKitPersistReceipt.version}).
 */
export interface BrandKitStoredResponse {
  /** The persisted Brand Kit document (Markdown), integrity-checked against the content-addressed key. */
  documentMarkdown: string;
  /**
   * Receipt metadata of the returned object — the same fields minted by the
   * write path (dec-brand-kit-storage-v2). `version` / `intake_mode` are read
   * back from the object's metadata; objects persisted before metadata was
   * written report the documented defaults (version 1, `form`).
   */
  receipt: BrandKitPersistReceipt;
  /** ISO-8601 timestamp the object was stored (S3 LastModified), when the store reports one. */
  storedAt?: string;
}

/**
 * Response of `POST /api/mktg-agents/brand-kit/result`.
 * `pending` until the session emits a valid envelope; then `ready` with the
 * validated document. On `ready` the BFF also persists the document to
 * versioned object storage (the dec-brand-kit-storage-v2 write path) and
 * reports the receipt. A missing `persistence` on a `ready` response has two
 * causes: the write failed and will be retried on the next poll
 * (content-addressed keys make retries idempotent), or the document exceeds
 * `BRAND_KIT_MAX_DOCUMENT_BYTES` and is excluded from persistence — a
 * permanent condition no retry resolves.
 * Extends the generic run-flow result (status/documentMarkdown/version) the
 * form-first run shell polls, adding brand-kit envelope provenance fields.
 */
export interface BrandKitResultResponse extends MktgRunResultResponse {
  /** Project display name from the envelope (intake Q1 verbatim). Present when ready. */
  projectName?: string;
  /** Project slug from the envelope. Present when ready. */
  project?: string;
  /** How the intake answers were collected, from the envelope. Present when ready. */
  intakeMode?: BrandKitIntakeMode;
  /** Persistence receipt for the returned document. Present when ready AND the object-store write succeeded. */
  persistence?: BrandKitPersistReceipt;
}

/** Structured result of validating a candidate envelope. */
export interface BrandKitValidationResult {
  /** True when every gate passed. */
  valid: boolean;
  /** Machine-readable failure reasons (empty when valid). */
  errors: string[];
}
