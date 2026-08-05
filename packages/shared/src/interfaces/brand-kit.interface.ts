// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Brand Kit output envelope contract (brand-kit-output/v1) shared between the
// Express BFF session-consumer and any future Angular surfaces. Transcribed
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

/** Machine-readable log of the 7-question intake. */
export interface BrandKitIntake {
  /** How the 7 answers were collected. */
  mode: 'form' | 'conversational';
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
 * before persisting (dec-brand-kit-storage-v1).
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

/**
 * Persistence receipt returned by `POST /api/mktg-agents/brand-kit/persist`.
 * Carries exactly the fields needed for later Artifact minting in ai-brain
 * (deferred to wi-lfx-one-service-actor — the BFF writes no graph rows in v1).
 */
export interface BrandKitPersistReceipt {
  /** Content-addressed object key: brand-kit/{project}/{content_sha256}.md. */
  s3_key: string;
  /** Validated + recomputed document SHA-256. */
  content_sha256: string;
  /** Project slug (storage partition). */
  project: string;
  /** Document draft version from the envelope. */
  version: number;
  /** How the intake answers were collected. */
  intake_mode: 'form' | 'conversational';
}

/** Request body for `POST /api/mktg-agents/brand-kit/persist`. */
export interface BrandKitPersistRequest {
  /** Guild session id whose terminal output should be persisted. */
  sessionId: string;
  /**
   * Opaque owner token from the session-create response — the same
   * creator-binding proof required for follow-up posts.
   */
  ownerToken: string;
}

/** Structured result of validating a candidate envelope. */
export interface BrandKitValidationResult {
  /** True when every gate passed. */
  valid: boolean;
  /** Machine-readable failure reasons (empty when valid). */
  errors: string[];
}
