// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// ICP & Target Markets output envelope contract (icp-output/v1) and batch
// intake form contract, shared between the Express BFF and the Angular
// form-first run shell. Transcribed from marketing-os-agents agents/icp-ts
// (src/envelope.ts, src/form.ts) — the agent's zod schemas are normative;
// this must stay in sync (reviewed at PR).

import type { MktgReadmeOutcome, MktgRunGenerateBody, MktgRunResultBody, MktgRunResultResponse, MktgRunSessionResponse } from './mktg-run.interface';

/** One verbatim intake Q/A pair from the variable-length interview log. */
export interface IcpIntakeAnswer {
  /** 1-based position in the order the question was asked, 1–8. */
  question_number: number;
  /** The question text as asked — Paul's exact Step 1 wording, stamped by the agent wrapper. */
  question: string;
  /** The user's answer, verbatim and untranslated. */
  answer: string;
}

/** How the intake answers were collected. */
export type IcpIntakeMode = 'form' | 'conversational';

/** Machine-readable log of the interview (3–8 answers; variable-length). */
export interface IcpIntake {
  /** How the answers were collected. */
  mode: IcpIntakeMode;
  /** ISO-8601 timestamp when intake completed — UTC by producer contract, but the shape gate accepts any offset. */
  completed_at: string;
  /** 3–8 entries, in the order asked. */
  answers: IcpIntakeAnswer[];
}

/** One organization-level ICP with its personas (contract structure gate G1). */
export interface IcpDefinition {
  /** ICP label, appearing verbatim inside `document_markdown` (gate G3). */
  label: string;
  /** 2–3 persona titles, each appearing verbatim inside `document_markdown`. */
  personas: string[];
}

/** How confident the disqualifier set is (gate G6). */
export type IcpDisqualifierState = 'confirmed' | 'inferred_draft';

/**
 * The machine-readable spine of the document the contract's structure gates
 * (G1–G6) are checked against — 1–2 ICPs with 2–3 personas each, the 4–6
 * fit/warmth attributes, and the disqualifier confidence.
 */
export interface IcpStructure {
  /** 1–2 organization-level ICPs. */
  icps: IcpDefinition[];
  /** 4–6 attributes an actual contact or org can be scored against. */
  fit_warmth_attributes: string[];
  /** Whether the disqualifier set was confirmed by the user or inferred by the agent. */
  disqualifiers: IcpDisqualifierState;
}

/** Which optional inputs the run consumed, as recorded by the agent wrapper. */
export interface IcpInputs {
  /** Whether a Brand Kit document was consumed for this run. */
  brand_kit_provided: boolean;
  /** SHA-256 of the consumed Brand Kit markdown, when one was provided. */
  brand_kit_sha256?: string;
  /** Whether a Message Foundation document was consumed for this run. */
  message_foundation_provided: boolean;
  /** SHA-256 of the consumed Message Foundation markdown, when one was provided. */
  message_foundation_sha256?: string;
  /** Whether already-pulled live member/adopter records were consumed. */
  live_membership_data_provided: boolean;
  /** SHA-256 of the consumed live membership data, when it was provided. */
  live_membership_data_sha256?: string;
}

/** Producer provenance, filled deterministically by the agent wrapper. */
export interface IcpAgentProvenance {
  /** Guild agent identifier (owner~name) — `linux-foundation~icp` for the live deploy. */
  identifier?: string;
  /** Published agent version that produced the document (semver). */
  agent_version?: string;
  /** SHA-256 of the FIDELITY-MANIFEST the prompt substance verified against. */
  prompt_manifest_sha256?: string;
}

/**
 * The ICP & Target Markets output envelope — the typed output of the
 * linux-foundation~icp agent and the exact payload the BFF validates (schema
 * gates + structure gates + sha256 recompute) before surfacing the document.
 */
export interface IcpEnvelope {
  /** Contract discriminator + version; consumers reject unknown majors. */
  contract: string;
  /** Document kind — always 'icp' for this contract. */
  kind: string;
  /** Project slug (lowercase kebab-case). */
  project: string;
  /** The project's display name exactly as given in intake Q1a. */
  project_name: string;
  /** Document draft version, starting at 1; regeneration increments by 1. */
  version: number;
  /** The complete ICP & Target Markets document in Markdown. */
  document_markdown: string;
  /** Lowercase hex SHA-256 of the UTF-8 bytes of document_markdown. */
  content_sha256: string;
  /** The business outcome the ICP was optimized toward (Paul's never-skip Q1d.1). */
  business_outcome: string;
  /** Machine-readable document spine the structure gates check. */
  structure: IcpStructure;
  /** Which optional inputs the run consumed. */
  inputs: IcpInputs;
  /** Verbatim intake log. */
  intake: IcpIntake;
  /** ISO-8601 timestamp when this draft was emitted — UTC by producer contract, but the shape gate accepts any offset. */
  generated_at?: string;
  /** Producer provenance. */
  agent?: IcpAgentProvenance;
}

/**
 * The batch (form-mode) `agent_input` payload the BFF sends when creating the
 * Guild session — the agent's `icp_intake_form` contract (marketing-os-agents
 * agents/icp-ts src/form.ts). Only `project_name`, `github_url` and
 * `business_outcome` are required; the sibling documents, the live membership
 * data and the remaining four gap-fill answers are all optional, because Paul
 * explicitly allows proceeding without them (flagging the affected sections
 * lower-confidence).
 */
export interface IcpFormPayload {
  /** Payload discriminator the agent's input preprocess keys on. */
  type: 'icp_intake_form';
  /** Q1a: the name of the LF project (verbatim). */
  project_name: string;
  /** Q1b: URL of the project's GitHub repo or README. */
  github_url: string;
  /** README content fetched by the BFF (the agent has no web access). Omitted when the fetch fails. */
  readme_markdown?: string;
  /** Q1c: the full Brand Kit document (Markdown), when the project has one stored. */
  brand_kit_markdown?: string;
  /** Q1c: the full Message Foundation document (Markdown), when the project has one stored. */
  message_foundation_markdown?: string;
  /** Real member/adopter records already pulled by the caller (the agent has no LFX platform tools). */
  lfx_membership_data?: string;
  /** Gap-fill 1d.1 (REQUIRED — Paul marks it never-skip): the business outcome this ICP is optimized toward. */
  business_outcome: string;
  /** Gap-fill 1d.2: who ICP-fit orgs evaluate against or migrate from. */
  competitive_landscape?: string;
  /** Gap-fill 1d.3: who is clearly NOT a good fit. */
  disqualifiers?: string;
  /** Gap-fill 1d.4: what triggers an org or team to start evaluating/adopting. */
  trigger_events?: string;
  /** Gap-fill 1d.5: known member/contributor organizations to seed firmographics. */
  known_member_orgs?: string;
  /** Feedback on a prior draft; when present the agent regenerates incorporating it. */
  feedback?: string;
  /** Version of the prior draft being revised; the new envelope carries prior_version + 1. */
  prior_version?: number;
}

/** Options layered onto the answers when building the batch payload (`buildIcpFormPayload`). */
export interface IcpFormPayloadOptions {
  /** README content fetched server-side; omitted from the payload when absent. */
  readmeMarkdown?: string;
  /** User feedback on the prior draft (regeneration). */
  feedback?: string;
  /** Version of the prior draft being revised; the agent finalizes as `priorVersion + 1`. */
  priorVersion?: number;
}

/**
 * Request body for `POST /api/mktg-agents/icp/generate` — the form answers
 * keyed by intake field key (generic run-flow body; the auto-attached sibling
 * documents ride the same record), plus `feedback`/`priorVersion` on
 * regenerations (regenerate-via-generate: every follow-up is a full resubmit
 * on a fresh session).
 */
export type IcpGenerateRequest = MktgRunGenerateBody;

/**
 * Response of `POST /api/mktg-agents/icp/generate` — the session to poll
 * (generic run-flow shape). The generic shape carries the optional `readme`
 * outcome, which this agent always populates: its README is fetched
 * server-side while composing the submission, so the run can tell the user
 * when the document was written WITHOUT one.
 */
export type IcpGenerateResponse = MktgRunSessionResponse;

/**
 * What starting an ICP generation produced inside the BFF: the Guild session
 * to poll plus the README fetch outcome. The controller turns this into the
 * wire response by minting the creator-binding owner token for the session.
 */
export interface IcpGenerationStart {
  /** Guild session id running the one-shot form-mode generation. */
  sessionId: string;
  /** Outcome of the server-side README fetch that fed this submission. */
  readme: MktgReadmeOutcome;
}

/** Request body for `POST /api/mktg-agents/icp/result` — the owner token travels in the body, never the query string. */
export type IcpResultRequest = MktgRunResultBody;

/**
 * Response of `POST /api/mktg-agents/icp/result`: `pending` until the session
 * emits a schema-valid, sha256-verified envelope, then `ready` with the
 * validated document, its version, and — when the server-side write succeeded
 * — the persistence receipt.
 */
export interface IcpResultResponse extends MktgRunResultResponse {
  /** Project display name from the envelope (intake Q1a verbatim). Present when ready. */
  projectName?: string;
  /** Project slug from the envelope. Present when ready. */
  project?: string;
  /** How the intake answers were collected, from the envelope. Present when ready. */
  intakeMode?: IcpIntakeMode;
}

/** Structured result of validating a candidate envelope or an answers record. */
export interface IcpValidationResult {
  /** True when every gate passed. */
  valid: boolean;
  /** Machine-readable failure reasons (empty when valid). */
  errors: string[];
}
