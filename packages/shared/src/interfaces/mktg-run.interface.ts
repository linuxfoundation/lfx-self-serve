// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Form-first agent run contract for the Marketing OS Agents marketplace
// (LFXAI-95 workstream). An agent run collects a batch intake form, submits it
// through the existing chat/session BFF (`POST /api/mktg-agents/chat`), and
// stores each generated document as a browser-side version so the marketplace
// can badge agents that already have output.

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
 * plus the intake answers and every generated version.
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
  /** Feedback on the prior draft; present only when regenerating. */
  feedback?: string;
  /** Version of the prior draft being revised; present only when regenerating. */
  priorVersion?: number;
}
