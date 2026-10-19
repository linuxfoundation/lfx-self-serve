// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Boilerplates contract types (boilerplates-output/v1; Guild
// linux-foundation~boilerplates 1.0.0). Mirrors marketing-os-agents
// docs/contracts/boilerplates-output.schema.json and agents/boilerplates
// src/envelope.ts and src/form.ts.

import type { BOILERPLATES_FORM_TYPE, BOILERPLATES_MODES, BOILERPLATES_VIEW_TABS } from '../constants/boilerplates.constants';
import type { MktgArtifactPersistReceipt } from './mktg-artifact.interface';
import type {
  MktgRunAnswersBody,
  MktgRunAnswersResponse,
  MktgRunGenerateBody,
  MktgRunResultBody,
  MktgRunResultResponse,
  MktgRunSessionResponse,
} from './mktg-run.interface';

/** What produced a version. */
export type BoilerplatesMode = (typeof BOILERPLATES_MODES)[number];

/** One tab of the Boilerplates view. */
export type BoilerplatesViewTabId = (typeof BOILERPLATES_VIEW_TABS)[number]['id'];

/** One length of the boilerplates: its label, its word limit and its text. */
export interface BoilerplatesEntry {
  /** The length's label (`One-liner`, `25 words`, `50 words`, `100 words`). */
  l: string;
  /** Its word limit. */
  max: number;
  /** The boilerplate itself. */
  t: string;
}

/** The asset: exactly four lengths, in the contract's order. */
export interface BoilerplatesContent {
  bp: BoilerplatesEntry[];
}

/** What the run read and could not, and what a person should check — shown to the reviewer, never part of the content. */
export interface BoilerplatesReport {
  sources_read: string[];
  sources_failed: { name: string; reason: string }[];
  gaps: string[];
  notes: string;
}

/** The finalize tool's own checks: each length's word count, in order, and the mechanical findings. */
export interface BoilerplatesChecks {
  word_counts: number[];
  findings: string[];
}

/** One comment a redraft answered, with how it was resolved. */
export interface BoilerplatesRevisionComment {
  number: number;
  field: string;
  comment: string;
  resolution: string;
}

/** What a redraft or a check revised; null on a draft. */
export interface BoilerplatesRevisionRecord {
  mode: 'redraft' | 'check';
  prior_version: number;
  comments: BoilerplatesRevisionComment[];
}

/** The agent's provenance. */
export interface BoilerplatesAgentProvenance {
  identifier: string;
  agent_version: string;
  prompt_manifest_sha256: string;
}

/** The validated `boilerplates-output/v1` envelope. `inputs_record` is loose by contract (additive keys allowed). */
export interface BoilerplatesEnvelope {
  contract: string;
  kind: string;
  project: string;
  project_name: string;
  version: number;
  mode: BoilerplatesMode;
  content: BoilerplatesContent;
  content_sha256: string;
  report: BoilerplatesReport;
  checks: BoilerplatesChecks;
  inputs_record: Record<string, unknown>;
  intake: { mode: 'form'; completed_at: string };
  revision: BoilerplatesRevisionRecord | null;
  capabilities: { web_fetch: boolean; lfx_mcp: boolean };
  generated_at: string;
  agent: BoilerplatesAgentProvenance;
}

/**
 * The agent's draft form (`boilerplates_intake_form`, src/form.ts) as the
 * BFF builds it: the project, the website whose domain ends the 100-word
 * version, the notes, and the messaging framework's content. A redraft and a
 * check (comments, a hand edit) are later work, so the form carries no
 * revision.
 */
export interface BoilerplatesFormPayload {
  type: typeof BOILERPLATES_FORM_TYPE;
  project_name: string;
  run_date?: string;
  project_uid?: string;
  website_url?: string;
  notes?: string;
  /** The framework's content (`{mf, icp, mh, nums}`), unwrapped from the stored envelope. */
  messaging_framework?: Record<string, unknown>;
}

/** What the form payload takes besides the answers. */
export interface BoilerplatesFormInputs {
  /** The LFX project uid the run belongs to (the agent's own LFX lookups). */
  projectUid?: string;
  /** The run date, YYYY-MM-DD; today (UTC) when absent. */
  runDate?: string;
}

/** Request body for `POST /api/mktg-agents/boilerplates/generate`. */
export type BoilerplatesGenerateRequest = MktgRunGenerateBody;

/** Response of `POST /api/mktg-agents/boilerplates/generate`. */
export type BoilerplatesGenerateResponse = MktgRunSessionResponse;

/** Request body for `POST /api/mktg-agents/boilerplates/answers`. */
export type BoilerplatesAnswersRequest = MktgRunAnswersBody;

/** Response of `POST /api/mktg-agents/boilerplates/answers`. */
export type BoilerplatesAnswersResponse = MktgRunAnswersResponse;

/** Request body for `POST /api/mktg-agents/boilerplates/result`. */
export type BoilerplatesResultRequest = MktgRunResultBody;

/** Receipt of a successful persistence write (the revision the boilerplates were stored as). */
export type BoilerplatesPersistReceipt = MktgArtifactPersistReceipt;

/**
 * Response of `POST /api/mktg-agents/boilerplates/result`: `ready` once the
 * session holds a schema-valid, sha256-verified envelope, with the
 * boilerplates as the run's asset and, when the write succeeded, the
 * persistence receipt of the stored revision; `questions` while the session
 * holds the agent's questions block and no envelope; `refused` when the
 * agent ended the session with its one plain reply (no framework, or a run
 * that ended without a validated result); `pending` otherwise.
 */
export interface BoilerplatesResultResponse extends MktgRunResultResponse {
  /** Project display name from the envelope. Present when ready. */
  projectName?: string;
  /** Project slug from the envelope. Present when ready. */
  project?: string;
  /** Persistence receipt; absent on a ready result when the write did not happen (retried on the next poll). */
  persistence?: BoilerplatesPersistReceipt;
}

/** Structured result of validating a candidate envelope or a request body. */
export interface BoilerplatesValidationResult {
  /** True when every gate passed. */
  valid: boolean;
  /** Machine-readable failure reasons (empty when valid). */
  errors: string[];
}

/** One length as the Boilerplates view renders it. */
export interface BoilerplatesLengthRow {
  /** Position in the contract (0–3); the `@for` track key and the comment field index. */
  index: number;
  /** The length's label. */
  label: string;
  /** What the length carries. */
  hint: string;
  /** The boilerplate. */
  text: string;
  /** Its word count (whitespace-separated tokens, as the agent counts). */
  words: number;
  /** Its word limit. */
  max: number;
  /** True when the text is over its limit (a hand edit a check returned, or a length a redraft kept as stored). */
  over: boolean;
  /** "12 / 15 words". */
  countLabel: string;
}

/** One length as the view's template binds it: the row plus its count chip's look, chosen in the component so Tailwind's content scan keeps the classes. */
export interface BoilerplatesLengthView extends BoilerplatesLengthRow {
  /** Tailwind classes of the count chip: emerald within the limit, amber over it. */
  countClass: string;
}

/** One tab of the Boilerplates view as its template binds it. */
export interface BoilerplatesViewTab {
  id: BoilerplatesViewTabId;
  label: string;
  selected: boolean;
  tabClass: string;
  panelId: string;
  tabId: string;
}
