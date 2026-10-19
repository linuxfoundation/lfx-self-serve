// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Messaging Document output envelope (messaging-document-output/v1), the
// generate form contract and the questions/answers turns
// (messaging-document-questions/v1, messaging-document-answers/v1), shared
// between the Express BFF and the Angular run page. Transcribed from
// marketing-os-agents agents/foundation-message (src/envelope.ts, src/form.ts,
// src/questions-turn.ts); the agent's JSON Schema is normative and this must
// stay in sync (reviewed at PR).

import {
  FOUNDATION_MESSAGE_FIELD_STATUSES,
  FOUNDATION_MESSAGE_GENERATE_SHAPES,
  FOUNDATION_MESSAGE_SOURCE_KINDS,
} from '../constants/foundation-message.constants';
import type { MktgArtifactPersistReceipt, MktgArtifactStoredResponse } from './mktg-artifact.interface';
import type {
  MktgRunAnswer,
  MktgRunAnswersBody,
  MktgRunAnswersResponse,
  MktgRunGenerateBody,
  MktgRunResultBody,
  MktgRunResultResponse,
  MktgRunSessionResponse,
} from './mktg-run.interface';

/** One of Paul's four Step 0b sources. */
export type FoundationMessageSourceKind = (typeof FOUNDATION_MESSAGE_SOURCE_KINDS)[number];

/** The generate form's shape, which follows from the answers and documents present. */
export type FoundationMessageGenerateShape = (typeof FOUNDATION_MESSAGE_GENERATE_SHAPES)[number];

/** A sidecar field's review status. */
export type FoundationMessageFieldStatus = (typeof FOUNDATION_MESSAGE_FIELD_STATUSES)[number];

/** One field of the sidecar: a string, or a list of objects for the four multi-item fields. */
export interface FoundationMessageField {
  /** The field's value — verbatim from the document for the copy primitives. */
  value: string | Record<string, unknown>[];
  /** The provenance label plus its citation (`Asked` for the requester's own answer). */
  source: string;
  /** `approved` only after the reviewer's Approve; `draft`; `tbd` = Needs input. */
  status: FoundationMessageFieldStatus;
}

/** Paul's brand.json seed: logo URLs found in a source, palette and fonts only when a brand page states them. */
export interface FoundationMessageBrandSeed {
  project_name: string;
  logo: { light: string | null; dark: string | null };
  palette: Record<string, string> | null;
  fonts: Record<string, string> | null;
  _source: { logo: string; palette: string; fonts: string };
}

/** How the run was produced, recorded by the agent wrapper. */
export interface FoundationMessageIntake {
  /** Always `form` (dec-qa-form-path-only). */
  mode: 'form';
  /** The generate form's shape; null on a revise. */
  shape: FoundationMessageGenerateShape | null;
  /** ISO-8601 timestamp when the intake completed. */
  completed_at: string;
}

/** Producer provenance, filled deterministically by the agent wrapper. */
export interface FoundationMessageAgentProvenance {
  /** Guild agent identifier (owner~name). */
  identifier: string;
  /** Published agent version that produced the bundle (semver). */
  agent_version: string;
  /** SHA-256 of the FIDELITY-MANIFEST the prompt substance verified against. */
  prompt_manifest_sha256: string;
}

/**
 * The Messaging Document output envelope — Paul's bundle minus the deck: the
 * Markdown on his template, the field sidecar, the Project Inputs record and
 * the brand seed. The exact payload the BFF validates (schema gates and the
 * sha256 recompute) before storing it as a revision.
 */
export interface FoundationMessageEnvelope {
  /** Contract discriminator + version; consumers reject unknown majors. */
  contract: string;
  /** Always `messaging-document`. */
  kind: string;
  /** Project slug (lowercase kebab-case) of `project_name`. */
  project: string;
  /** The project name exactly as the intake form gave it. */
  project_name: string;
  /** 1 on a generate; the stored revision + 1 on a revise. */
  version: number;
  /** How the bundle was produced. */
  mode: 'generate' | 'revise';
  /** The front matter's Status cell — one of Paul's draft labels. */
  status: string;
  /** The complete Messaging Document in Markdown. */
  document_markdown: string;
  /** Lowercase hex SHA-256 of the UTF-8 bytes of document_markdown. */
  content_sha256: string;
  /** The field sidecar, keyed by md.* field id. */
  fields: Record<string, FoundationMessageField>;
  /** The brand.json seed. */
  brand_seed: FoundationMessageBrandSeed;
  /** The Project Inputs record (open: sibling agents append to it). */
  inputs_record: Record<string, unknown> | null;
  /** How the run was produced. */
  intake: FoundationMessageIntake;
  /** The comments a revise applied; null on a generate. */
  revision: { prior_version: number; comments: Record<string, unknown>[] } | null;
  /** The tool reality of the run. */
  capabilities: { web_fetch: boolean; lfx_mcp: boolean };
  /** ISO-8601 timestamp when the bundle was emitted. */
  generated_at: string;
  /** Producer provenance. */
  agent: FoundationMessageAgentProvenance;
}

/** One existing document as the agent's generate form takes it: an uploaded file's text, or a link the agent reads itself. */
export interface FoundationMessageExistingDocument {
  /** Human label (one line). */
  title?: string;
  /** Link to the document; the agent fetches it. */
  url?: string;
  /** The document's text as LFX One read it from the uploaded file. */
  text?: string;
}

/**
 * The agent's `messaging_document_intake_form` — what the BFF renders into
 * the one text message it sends (src/form.ts). Sources travel as URLs only:
 * the agent fetches and researches them itself. Every text passes through
 * verbatim.
 */
export interface FoundationMessageFormPayload {
  type: 'messaging_document_intake_form';
  project_name: string;
  /** The LFX project uid, for the agent's LFX lookups. */
  project_uid?: string;
  run_date?: string;
  website_url?: string;
  github_url?: string;
  press_release_url?: string;
  brand_page_url?: string;
  /** Further links the requester gave, in order. */
  other_links?: string[];
  existing_documents?: FoundationMessageExistingDocument[];
}

/** What the BFF layers onto the validated answers to build the form. */
export interface FoundationMessageFormInputs {
  /** The existing documents, as the agent takes them. */
  documents?: FoundationMessageExistingDocument[];
  /** The LFX project uid the run belongs to. */
  projectUid?: string;
  /** The run date, YYYY-MM-DD; the renderer defaults it to today (UTC). */
  runDate?: string;
}

/**
 * One question of the agent's questions turn (messaging-document-questions/v1)
 * — a gap the sources and research left open, with the agent's best guess.
 * Field names mirror the agent's JSON block verbatim.
 */
export interface FoundationMessageQuestion {
  /** The field the answer fills (snake_case, e.g. `audiences`). */
  key: string;
  /** Short label. */
  label: string;
  /** The question itself. */
  question: string;
  /** Why the agent could not settle it from the sources. */
  why: string;
  /** The agent's suggested answer; empty when it has none. */
  suggested_answer: string;
  /** Links (or source names) the suggestion rests on. */
  basis: string[];
}

/** The agent's questions block: the fenced JSON of the questions turn. */
export interface FoundationMessageQuestionsBlock {
  /** Always `messaging-document-questions/v1`. */
  contract: string;
  /** The project name as the agent calls it. */
  project: string;
  /** The gap questions, in the agent's order. */
  questions: FoundationMessageQuestion[];
}

/** One answer of the answers turn (messaging-document-answers/v1): the run shell's answer shape, rendered per key with its origin. */
export type FoundationMessageAnswer = MktgRunAnswer;

/** Request body for `POST /api/mktg-agents/foundation-message/generate` — the sources plus the existing documents. */
export type FoundationMessageGenerateRequest = MktgRunGenerateBody;

/** Response of `POST /api/mktg-agents/foundation-message/generate` — the session to poll. */
export type FoundationMessageGenerateResponse = MktgRunSessionResponse;

/** Request body for `POST /api/mktg-agents/foundation-message/answers` — the answers to the session's questions turn. */
export type FoundationMessageAnswersRequest = MktgRunAnswersBody;

/** Response of `POST /api/mktg-agents/foundation-message/answers`. */
export type FoundationMessageAnswersResponse = MktgRunAnswersResponse;

/** Request body for `POST /api/mktg-agents/foundation-message/result`. */
export type FoundationMessageResultRequest = MktgRunResultBody;

/** Receipt of a successful persistence write (`foundation-message/{project}/{content_sha256}.md`). */
export type FoundationMessagePersistReceipt = MktgArtifactPersistReceipt;

/** Response of `GET /api/mktg-agents/foundation-message/stored?project=<uid>` — the latest stored revision. */
export type FoundationMessageStoredResponse = MktgArtifactStoredResponse;

/**
 * Response of `POST /api/mktg-agents/foundation-message/result`: `ready`
 * once the session holds a schema-valid, sha256-verified envelope, with the
 * document, its copy primitives (surfaced as copyable chips) and, when the
 * write succeeded, the persistence receipt of the stored revision;
 * `questions` whenever the session holds a questions block the agent wrote
 * and no valid envelope yet — the latest block, reported on every poll until
 * a newer block or the envelope appears, so the run shell tells an
 * already-answered block apart by its `questionsId`; `pending` otherwise.
 */
export interface FoundationMessageResultResponse extends MktgRunResultResponse {
  /** Project display name from the envelope. Present when ready. */
  projectName?: string;
  /** Project slug from the envelope. Present when ready. */
  project?: string;
  /** The document's draft status from the envelope. Present when ready. */
  documentStatus?: string;
  /** Persistence receipt; absent on a ready result when the write did not happen (retried on the next poll). */
  persistence?: FoundationMessagePersistReceipt;
}

/** Structured result of validating a candidate envelope or a request body. */
export interface FoundationMessageValidationResult {
  /** True when every gate passed. */
  valid: boolean;
  /** Machine-readable failure reasons (empty when valid). */
  errors: string[];
}
