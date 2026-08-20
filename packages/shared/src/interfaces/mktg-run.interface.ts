// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Form-first agent run contract for the Marketing OS Agents marketplace
// (LFXAI-95 workstream). An agent run collects a batch intake form, submits it
// through the agent's validated generate endpoint (regenerations go through
// the existing chat/session BFF, `POST /api/mktg-agents/chat`), polls the
// agent's result endpoint for the schema-validated document, and stores each
// generated document as a browser-side version so the marketplace can badge
// agents that already have output.

import type { MktgSessionInfo } from './mktg-chat.interface';

/** How a single intake field is rendered on the run page. */
export type MktgIntakeFieldKind = 'text' | 'textarea';

/**
 * LFX data source a field can be pre-filled from. Prefilled fields render a
 * "From LFX" chip and stay editable — the marketplace never re-asks what LFX
 * already knows.
 */
export type MktgIntakePrefillSource = 'project-name' | 'repository-url' | 'project-description';

/** One intake question rendered as a form field on the agent run page. */
export interface MktgIntakeField {
  /** Stable answer key — matches the agent's batch form schema key (e.g. `project_name`). */
  key: string;
  /**
   * The question label, quoted VERBATIM from the agent's own intake wording
   * (its `src/questions.ts`). Never paraphrased.
   */
  question: string;
  /** Input control to render. All intake answers are open-ended text. */
  kind: MktgIntakeFieldKind;
  /** Textarea rows; ignored for `text` fields. */
  rows?: number;
  /** Optional placeholder shown in the empty control. */
  placeholder?: string;
  /** LFX data source to pre-fill from, when the source has a value. */
  prefill?: MktgIntakePrefillSource;
  /** Honest hint shown when the prefill source has no value on the LFX project. */
  missingPrefillHint?: string;
  /** Always-visible helper text under the control (e.g. the README auto-fetch note). */
  hint?: string;
  /**
   * Optional answer: no required validator, no asterisk, and the key is
   * omitted from the submitted answers when the trimmed value is empty.
   */
  optional?: boolean;
}

/**
 * A dependency document auto-attached to an intake's submitted answers
 * (dec-agent-dependency-gating): agents that CONSUME another agent's output
 * (e.g. the Message Foundation consumes the Brand Kit) never ask for it —
 * the run page fetches the dependency's stored document at submit time
 * (server-persisted preferred, browser-stored run fallback) and submits it
 * under the agent's own schema key. The form shows a non-interactive
 * "Using <project>'s <document> (vN)" chip instead of any choice UI.
 */
export interface MktgIntakeAttachment {
  /** Catalog agent id whose stored output is attached — must appear in the consuming agent's `dependsOn`. */
  sourceAgentId: string;
  /** Answer key the document is submitted under (the agent's own batch schema key, e.g. `brand_kit_markdown`). */
  answerKey: string;
  /** Human name of the attached document for the on-form chip, e.g. `Brand Kit`. */
  documentName: string;
}

/**
 * A dependency agent's stored output document resolved for one project —
 * what marketplace gating checks and intake attachments submit.
 */
export interface MktgDependencyDocument {
  /** Catalog agent id that produced the document. */
  agentId: string;
  /** Where the document came from: BFF object-store persistence, or this browser's stored run. */
  source: 'server' | 'browser';
  /** Latest stored draft version. */
  version: number;
  /** The stored document (Markdown). */
  document: string;
}

/** One word-count-locked derivative surfaced as a copyable chip on the result. */
export interface MktgIntakeDerivativeChip {
  /** Derivative key in the agent's envelope `derivatives` record. */
  key: string;
  /** Human label, e.g. `25-word summary`. */
  label: string;
}

/**
 * BFF endpoints backing an agent's validated generation flow. Every agent with
 * an envelope contract exposes a generate/result pair (e.g.
 * `/api/mktg-agents/brand-kit/...`); the result endpoint returns only
 * schema-validated, integrity-checked documents, so the UI never has to trust
 * raw chat text as the generated document.
 */
export interface MktgRunEndpoints {
  /** POST — body {@link MktgRunGenerateBody}; responds {@link MktgRunSessionResponse}. */
  generate: string;
  /** POST — body {@link MktgRunResultBody}; responds {@link MktgRunResultResponse}. */
  result: string;
}

/**
 * Body POSTed to an agent's `generate` endpoint — the full intake answers,
 * keyed by field key. The server renders the batch message and validates the
 * answers against the agent's own intake schema.
 */
export interface MktgRunGenerateBody {
  /** Answers keyed by intake field key; conditional/optional keys may be absent per the agent's own contract. */
  answers: Record<string, string>;
  /**
   * Feedback on the prior draft (regenerate-via-generate intakes only): the
   * server renders it into the batch payload's feedback block so the agent
   * regenerates incorporating it.
   */
  feedback?: string;
  /**
   * Version of the prior draft being revised (regenerate-via-generate intakes
   * only); the agent finalizes the new draft as `priorVersion + 1`.
   */
  priorVersion?: number;
}

/**
 * Body POSTed to an agent's `result` endpoint. The owner token travels in the
 * body (never the query string) so it stays out of access logs and proxies.
 */
export interface MktgRunResultBody {
  /** Guild session id returned by the generate endpoint. */
  sessionId: string;
  /** Creator-binding owner token returned by the generate endpoint. */
  ownerToken: string;
  /**
   * LFX project uid the run is scoped to. Agents that persist their output
   * use the SERVER-RESOLVED project as the storage partition and require the
   * caller's writer grant on it before writing (dec-brand-kit-storage-v2);
   * omitting it (no active project) means the document is returned but never
   * persisted, never that it lands in an unverified partition.
   */
  project?: string;
}

/** Response of an agent's `generate` endpoint — the session to poll. */
export interface MktgRunSessionResponse {
  /** Guild session id running the one-shot form-mode generation. */
  sessionId: string;
  /** Opaque creator-binding token; required to fetch the result. */
  ownerToken: string;
}

/**
 * Response of an agent's `result` endpoint: `pending` until the session emits
 * a schema-valid, integrity-checked envelope, then `ready` with the validated
 * document.
 */
export interface MktgRunResultResponse {
  /** Generation state. */
  status: 'pending' | 'ready';
  /** The validated document (Markdown). Present when ready. */
  documentMarkdown?: string;
  /** Draft version from the validated envelope. Present when ready. */
  version?: number;
  /** Word-count-locked derivatives from the validated envelope, when the agent's contract defines them. */
  derivatives?: Record<string, string>;
}

/**
 * A registered batch intake form for one agent. The run-page shell is driven
 * entirely by this definition, so a second agent's form slots in by adding a
 * new entry to the shared registry.
 */
export interface MktgAgentIntake {
  /** Catalog agent id this intake belongs to. */
  agentId: string;
  /** Verb opening the form title, e.g. `Develop` → "Develop the Foo Brand Kit". */
  formTitleAction: string;
  /** Generated document name, e.g. `Brand Kit` → doc title "Foo Brand Kit". */
  documentName: string;
  /** One-paragraph intro under the form title. */
  intro: string;
  /**
   * Batch-mode preamble lines prepended to the composed chat message — the
   * agent's own form-mode wording, quoted verbatim so its MODE RULES trigger.
   */
  batchPreamble: string[];
  /** Ordered intake fields; required unless marked `optional` or branched by the gate. */
  fields: MktgIntakeField[];
  /** Section labels the generated document is expected to contain. */
  sections: string[];
  /** BFF endpoints for the agent's validated generation flow. */
  endpoints: MktgRunEndpoints;
  /**
   * Dependency documents auto-attached to the submitted answers at submit
   * time (dec-agent-dependency-gating), for agents that consume another
   * agent's stored output. Every `sourceAgentId` must appear in the catalog
   * agent's `dependsOn`, which gates the marketplace card until the
   * dependency's stored output exists.
   */
  attachments?: MktgIntakeAttachment[];
  /** Copyable derivative chips shown on the result, when the agent's envelope carries derivatives. */
  derivativeChips?: MktgIntakeDerivativeChip[];
  /**
   * Follow-ups (edit-inputs resubmit, feedback regeneration) go through the
   * agent's generate endpoint as a full resubmit (`feedback` + `priorVersion`
   * in the body, fresh Guild session) instead of a chat follow-up on the
   * stored session. Required for agents whose batch payload is a structured
   * `agent_input` object (server-side README fetch, typed form contract) —
   * a chat follow-up could carry neither.
   */
  regenerateViaGenerate?: boolean;
}

/** One generated document version for an agent run. */
export interface MktgRunVersion {
  /** 1-based version number; regeneration produces v+1. */
  version: number;
  /** The generated document (Markdown) returned by the agent. */
  document: string;
  /** The feedback that produced this version, when it was a regeneration. */
  feedback?: string;
  /** Word-count-locked derivatives from the validated envelope, when the agent's contract defines them. */
  derivatives?: Record<string, string>;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
}

/**
 * Browser-persisted record of an agent run for one project — the Guild session
 * plus the intake answers and every generated version. Because the record
 * carries the session's capability `ownerToken`, persistence is explicitly
 * time-bounded: records older than `MKTG_RUN_STORAGE_TTL_MS` (measured from
 * `savedAt`) are pruned on load rather than left at rest indefinitely.
 */
export interface MktgStoredAgentRun {
  /** Catalog agent id. */
  agentId: string;
  /** LFX project uid the run belongs to. */
  projectUid: string;
  /** Guild session id backing the run. */
  sessionId: string;
  /** Opaque owner token proving this browser's user created the session. */
  ownerToken: string;
  /** Latest submitted intake answers, keyed by field key. */
  answers: Record<string, string>;
  /** Generated versions, oldest first. */
  versions: MktgRunVersion[];
  /** ISO-8601 timestamp of the last save — the TTL clock for pruning the persisted record. */
  savedAt: string;
}

/**
 * Outcome of a generate submission — the Guild session the result poll must
 * query, paired with the version that poll must beat. Deriving them together
 * (follow-up → the stored draft's version; fresh session, including the
 * stale-session recovery fallback, → 0) means the poll gate can never demand a
 * version the session will not produce.
 */
export interface MktgRunAttempt {
  /** The Guild session whose result endpoint the document poll queries. */
  session: MktgSessionInfo;
  /** Version the polled envelope must exceed; 0 on a fresh session. */
  priorVersion: number;
}

/** Run-page phase: intake form → staged running → document result. */
export type MktgRunPhase = 'form' | 'running' | 'result';

/** Progress events emitted while a generation request is in flight. */
export type MktgGenerateProgress = { type: 'submitted' } | { type: 'document'; run: MktgStoredAgentRun };

/** Request to generate (or regenerate) an agent document from intake answers. */
export interface MktgGenerateRequest {
  /** Catalog agent id — must be an `active` agent. */
  agentId: string;
  /** LFX project uid the run is scoped to. */
  projectUid: string;
  /** Registered intake definition for the agent. */
  intake: MktgAgentIntake;
  /** Full set of intake answers — regeneration resubmits the whole form. */
  answers: Record<string, string>;
  /**
   * Feedback on the prior draft; present only for "Request changes"
   * regenerations. The prior draft's version is NOT part of the request — the
   * run service derives it from the stored run so the follow-up message's
   * version directive and the result poll gate can never disagree.
   */
  feedback?: string;
}
