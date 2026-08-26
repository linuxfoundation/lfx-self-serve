// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Message Foundation output envelope contract (message-foundation-output/v1)
// and batch intake form contract, shared between the Express BFF and the
// Angular form-first run shell. Transcribed from marketing-os-agents
// agents/foundation-message-ts (src/envelope.ts, src/form.ts) — the agent's
// zod schemas are normative; this must stay in sync (reviewed at PR).

import type { MktgRunGenerateBody, MktgRunResultBody, MktgRunResultResponse, MktgRunSessionResponse } from './mktg-run.interface';

/** One verbatim intake Q/A pair from the variable-length interview log. */
export interface FoundationMessageIntakeAnswer {
  /** 1-based position in the order the question was asked, 1–15. */
  question_number: number;
  /** The question text as asked (Paul's exact wording for fixed questions). */
  question: string;
  /** The user's answer, verbatim and untranslated. */
  answer: string;
}

/** How the intake answers were collected. */
export type FoundationMessageIntakeMode = 'form' | 'conversational';

/** Machine-readable log of the interview (2–15 answers; variable-length). */
export interface FoundationMessageIntake {
  /** How the answers were collected. */
  mode: FoundationMessageIntakeMode;
  /** ISO-8601 timestamp when intake completed — UTC by producer contract, but the shape gate accepts any offset. */
  completed_at: string;
  /** 2–15 entries, in the order asked. */
  answers: FoundationMessageIntakeAnswer[];
}

/**
 * The five word-count-locked derivative assets from the document's section
 * 1a — each a VERBATIM substring of `document_markdown` (contract gate G3).
 */
export interface FoundationMessageDerivatives {
  /** 25-word summary (hard cap 25 words). */
  summary_25: string;
  /** 50-word summary (hard cap 50 words). */
  summary_50: string;
  /** Boilerplate paragraph (~100–150 words; sanity band 50–250). */
  boilerplate: string;
  /** llms.txt content (starts with an `# ` H1 line). */
  llms_txt: string;
  /** Elevator pitch headline (hard cap 10 words). */
  elevator_pitch_headline: string;
}

/** Which inputs the run consumed, as recorded by the agent wrapper. */
export interface FoundationMessageInputs {
  /** Whether a Brand Kit document was consumed for this run. */
  brand_kit_provided: boolean;
  /** SHA-256 of the consumed Brand Kit markdown, when one was provided. */
  brand_kit_sha256?: string;
}

/** Producer provenance, filled deterministically by the agent wrapper. */
export interface FoundationMessageAgentProvenance {
  /** Guild agent identifier (owner~name). */
  identifier?: string;
  /** Published agent version that produced the document (semver). */
  agent_version?: string;
  /** SHA-256 of the FIDELITY-MANIFEST the prompt substance verified against. */
  prompt_manifest_sha256?: string;
}

/**
 * The Message Foundation output envelope — the typed output of the
 * linux-foundation~foundation-message agent and the exact payload the BFF
 * validates (schema gates + sha256 recompute) before surfacing the document.
 */
export interface FoundationMessageEnvelope {
  /** Contract discriminator + version; consumers reject unknown majors. */
  contract: string;
  /** Document kind — always 'message-foundation' for this contract. */
  kind: string;
  /** Project slug (lowercase kebab-case). */
  project: string;
  /** The project's display name exactly as given in intake Q1a. */
  project_name: string;
  /** Document draft version, starting at 1; regeneration increments by 1. */
  version: number;
  /** The complete Message Foundation document in Markdown. */
  document_markdown: string;
  /** Lowercase hex SHA-256 of the UTF-8 bytes of document_markdown. */
  content_sha256: string;
  /** The five word-count-locked derivative assets. */
  derivatives: FoundationMessageDerivatives;
  /** Which inputs the run consumed. */
  inputs: FoundationMessageInputs;
  /** Verbatim intake log. */
  intake: FoundationMessageIntake;
  /** ISO-8601 timestamp when this draft was emitted — UTC by producer contract, but the shape gate accepts any offset. */
  generated_at?: string;
  /** Producer provenance. */
  agent?: FoundationMessageAgentProvenance;
}

/**
 * The batch (form-mode) `agent_input` payload the BFF sends when creating the
 * Guild session — the agent's `message_foundation_intake_form` contract
 * (marketing-os-agents agents/foundation-message-ts src/form.ts). Discovery
 * answers are required exactly when no `brand_kit_markdown` is provided
 * (Paul's five brand-discovery questions apply); the BFF enforces the same
 * conditional contract before submission.
 */
export interface FoundationMessageFormPayload {
  /** Payload discriminator the agent's input preprocess keys on. */
  type: 'message_foundation_intake_form';
  /** Q1a: the name of the LF project (verbatim). */
  project_name: string;
  /** Q1b: URL of the project's GitHub repo or README. */
  github_url: string;
  /** README content fetched by the BFF (the agent has no web access). Omitted when the fetch fails. */
  readme_markdown?: string;
  /** Q1c: the full Brand Kit document (Markdown), when one exists. */
  brand_kit_markdown?: string;
  /** Discovery 1 (required when no brand kit): one line, what does it do. */
  one_line_description?: string;
  /** Discovery 2 (required when no brand kit): primary audience. */
  primary_audience?: string;
  /** Discovery 3 (required when no brand kit): three adjectives for the voice. */
  voice_adjectives?: string;
  /** Discovery 4 (required when no brand kit): constraints. */
  constraints?: string;
  /** Discovery 5 (required when no brand kit): reference brands or projects. */
  reference_brands?: string;
  /** Optional free-text answers to Paul's Step 1d gap areas. */
  gap_fill_notes?: string;
  /** Feedback on a prior draft; when present the agent regenerates incorporating it. */
  feedback?: string;
  /** Version of the prior draft being revised; the new envelope carries prior_version + 1. */
  prior_version?: number;
}

/**
 * Request body for `POST /api/mktg-agents/foundation-message/generate` — the
 * form answers keyed by intake field key (generic run-flow body; discovery
 * keys conditional, `gap_fill_notes` optional), plus `feedback`/`priorVersion`
 * on regenerations (regenerate-via-generate: every follow-up is a full
 * resubmit on a fresh session).
 */
export type FoundationMessageGenerateRequest = MktgRunGenerateBody;

/** Response of `POST /api/mktg-agents/foundation-message/generate` — the session to poll (generic run-flow shape). */
export type FoundationMessageGenerateResponse = MktgRunSessionResponse;

/** Request body for `POST /api/mktg-agents/foundation-message/result` — the owner token travels in the body, never the query string. */
export type FoundationMessageResultRequest = MktgRunResultBody;

/**
 * Response of `POST /api/mktg-agents/foundation-message/result`:
 * `pending` until the session emits a schema-valid, sha256-verified envelope,
 * then `ready` with the validated document, its version, and the five
 * word-count-locked derivatives (surfaced as copyable chips in the UI).
 */
export interface FoundationMessageResultResponse extends MktgRunResultResponse {
  /** Project display name from the envelope (intake Q1a verbatim). Present when ready. */
  projectName?: string;
  /** Project slug from the envelope. Present when ready. */
  project?: string;
  /** How the intake answers were collected, from the envelope. Present when ready. */
  intakeMode?: FoundationMessageIntakeMode;
}

/** Structured result of validating a candidate envelope or an answers record. */
export interface FoundationMessageValidationResult {
  /** True when every gate passed. */
  valid: boolean;
  /** Machine-readable failure reasons (empty when valid). */
  errors: string[];
}
