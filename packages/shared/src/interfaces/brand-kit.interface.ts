// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Brand Kit output envelope contract (brand-kit-output/v1) shared between the
// Express BFF session-consumer and the Angular intake-form surface. Transcribed
// from marketing-os-agents docs/contracts/brand-kit-output.schema.json — the
// JSON Schema file is normative; this must stay in sync (reviewed at PR).

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
  /** ISO-8601 UTC timestamp when intake completed. */
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
  /** ISO-8601 UTC timestamp when this draft was emitted. */
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
 */
export interface BrandKitGenerateRequest {
  /** Answers keyed by intake question key; all 7 required, non-empty. */
  answers: Record<string, string>;
}

/** Response of `POST /api/mktg-agents/brand-kit/generate` — the session to poll. */
export interface BrandKitGenerateResponse {
  /** Guild session id running the one-shot form-mode generation. */
  sessionId: string;
  /** Opaque creator-binding token; required to fetch the result. */
  ownerToken: string;
}

/** Request query/body for `POST /api/mktg-agents/brand-kit/result`. */
export interface BrandKitResultRequest {
  /** Guild session id returned by generate. */
  sessionId: string;
  /** Owner token returned by generate. */
  ownerToken: string;
}

/**
 * Response of `POST /api/mktg-agents/brand-kit/result`.
 * `pending` until the session emits a valid envelope; then `ready` with the
 * validated document. The document is DISPLAYED to the user only — no
 * server-side persistence in this iteration (persistence deferred).
 */
export interface BrandKitResultResponse {
  /** Generation state. */
  status: 'pending' | 'ready';
  /** The validated Brand Kit document (Paul's structure, Markdown). Present when ready. */
  documentMarkdown?: string;
  /** Project display name from the envelope (intake Q1 verbatim). Present when ready. */
  projectName?: string;
  /** Project slug from the envelope. Present when ready. */
  project?: string;
  /** Draft version from the envelope. Present when ready. */
  version?: number;
  /** How the intake answers were collected, from the envelope. Present when ready. */
  intakeMode?: BrandKitIntakeMode;
}

/** Structured result of validating a candidate envelope. */
export interface BrandKitValidationResult {
  /** True when every gate passed. */
  valid: boolean;
  /** Machine-readable failure reasons (empty when valid). */
  errors: string[];
}
