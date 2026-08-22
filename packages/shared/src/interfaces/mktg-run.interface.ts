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
  /** Answers keyed by intake field key; every field required, non-empty. */
  answers: Record<string, string>;
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
  /** Ordered intake fields; every answer is required. */
  fields: MktgIntakeField[];
  /** Section labels the generated document is expected to contain. */
  sections: string[];
  /** BFF endpoints for the agent's validated generation flow. */
  endpoints: MktgRunEndpoints;
}

/** One generated document version for an agent run. */
export interface MktgRunVersion {
  /** 1-based version number; regeneration produces v+1. */
  version: number;
  /** The generated document (Markdown) returned by the agent. */
  document: string;
  /** The feedback that produced this version, when it was a regeneration. */
  feedback?: string;
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
