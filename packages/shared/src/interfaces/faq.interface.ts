// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// FAQ output envelope (faq-output/v1), the intake form contract and the
// questions/answers turns (faq-questions/v1, faq-answers/v1), shared between
// the Express BFF, the Angular run page and the FAQ view. Transcribed from
// marketing-os-agents agents/faq 1.0.0 (src/envelope.ts, src/form.ts,
// src/questions-turn.ts); the agent's JSON Schema
// (docs/contracts/faq-output.schema.json) is normative and this must stay in
// sync (reviewed at PR).

import { FAQ_DOCUMENT_KINDS, FAQ_MODES, FAQ_REVISION_MODES, FAQ_VIEW_TABS } from '../constants/faq.constants';
import type { MktgArtifactPersistReceipt } from './mktg-artifact.interface';
import type {
  MktgRunAnswersBody,
  MktgRunAnswersResponse,
  MktgRunGenerateBody,
  MktgRunQuestion,
  MktgRunResultBody,
  MktgRunResultResponse,
  MktgRunSessionResponse,
} from './mktg-run.interface';

/** How a run is produced: a new draft, a redraft from comments, or a check of a hand-edited version. */
export type FaqMode = (typeof FAQ_MODES)[number];

/** The two revision modes a form may carry. */
export type FaqRevisionMode = (typeof FAQ_REVISION_MODES)[number];

/** What a document on the form is: a press release, a deck, any other document, or the marketing plan. */
export type FaqDocumentKind = (typeof FAQ_DOCUMENT_KINDS)[number];

/** A tab of the FAQ view. */
export type FaqViewTab = (typeof FAQ_VIEW_TABS)[number]['id'];

/** `[question, answer | null, source | null]` — a null answer needs an answer from the team and has a null source. */
export type FaqQuestionEntry = [string, string | null, string | null];

/** Answered entries in the Slides exporter's object format, not the stored grouped tuples. */
export interface FaqSlidesExportQuestion {
  q: string;
  a: string;
}

/** `[groupName, questions]`. */
export type FaqGroup = [string, FaqQuestionEntry[]];

/** The FAQ itself: the skill's output schema, as the revision stores it. */
export interface FaqContent {
  faq: FaqGroup[];
}

/** What the run read, what it could not read, and what the sources do not state. */
export interface FaqReport {
  sources_read: string[];
  sources_failed: { name: string; reason: string }[];
  gaps: string[];
  /** Anything a person should check; on a check, one issue per line. */
  notes: string;
}

/** One question the sources did not answer, flagged for the team. */
export interface FaqUnanswered {
  /** `faq[g][1][q]`: the question entry with a null answer. */
  path: string;
  group: string;
  question: string;
}

/** The finalize tool's findings (the list on a check) and the unanswered questions the reviewer sees. */
export interface FaqChecks {
  findings: string[];
  unanswered: FaqUnanswered[];
}

/** What this run was given and what it read. Loose: the agent may add keys. */
export interface FaqInputsRecord {
  date_read: string;
  website: { url: string; read: boolean } | null;
  links: { url: string; read: boolean }[];
  documents: { title: string; kind: string; url: string | null; text_supplied: boolean; read: boolean }[];
  notes_given: boolean;
  framework: { given: boolean; avoid_phrases: string[]; open_objections: string[] };
  lfx_records: { slug: string; uid: string; name: string; date_read: string }[];
  questions_asked: unknown[];
  answers: unknown[];
  web_searches: string[];
  fetched: { url: string; ok: boolean }[];
  [key: string]: unknown;
}

/** One comment a redraft applied, with how the agent resolved it. */
export interface FaqRevisionComment {
  number: number;
  field: string;
  comment: string;
  resolution: string;
}

/** How a redraft or a check came to be; null on a draft. */
export interface FaqRevisionRecord {
  mode: FaqRevisionMode;
  prior_version: number;
  comments: FaqRevisionComment[];
}

/**
 * The FAQ output envelope: the FAQ, its report and checks, the inputs record
 * and the provenance — the exact payload the BFF validates (schema gates and
 * the sha256 recompute over the content JSON) before storing it as a revision.
 */
export interface FaqEnvelope {
  /** Contract discriminator + version; consumers reject unknown majors. */
  contract: string;
  /** Always `faq`. */
  kind: string;
  /** Project slug (lowercase kebab-case) of `project_name`. */
  project: string;
  /** The project name exactly as the intake form gave it. */
  project_name: string;
  /** 1 on a draft; the stored version + 1 on a redraft or a check. */
  version: number;
  mode: FaqMode;
  content: FaqContent;
  /** Lowercase hex SHA-256 of `JSON.stringify(content)` (UTF-8). */
  content_sha256: string;
  report: FaqReport;
  checks: FaqChecks;
  inputs_record: FaqInputsRecord;
  intake: { mode: 'form'; completed_at: string };
  revision: FaqRevisionRecord | null;
  capabilities: { web_fetch: boolean; lfx_mcp: boolean };
  generated_at: string;
  agent: { identifier: string; agent_version: string; prompt_manifest_sha256: string };
}

/** One document as the agent's form takes it: an uploaded file's text, or a link the agent reads itself, tagged with what it is. */
export interface FaqFormDocument {
  /** Human label (one line): the file name or the link. */
  title?: string;
  kind: FaqDocumentKind;
  /** Link to the document; the agent fetches it. */
  url?: string;
  /** The document's text as LFX One read it from the uploaded file. */
  text?: string;
}

/**
 * The agent's `faq_intake_form` as a draft — what the BFF renders into the
 * one text message it sends (src/form.ts). Every text passes through
 * verbatim. A redraft from comments and a check of a hand-edited version
 * (the form's `revision`) are later work, so the BFF never sends one.
 */
export interface FaqFormPayload {
  type: 'faq_intake_form';
  project_name: string;
  run_date?: string;
  /** The LFX project uid, for the agent's LFX lookups. */
  project_uid?: string;
  /** One line on what the project does. */
  description?: string;
  website_url?: string;
  /** Other links, in order: the repository first. */
  links?: string[];
  documents?: FaqFormDocument[];
  /** Who asks what, words to avoid — data, not instructions. */
  notes?: string;
  /** The approved messaging framework's content (`{ mf, icp, mh, nums }`). */
  messaging_framework?: Record<string, unknown>;
}

/** What the BFF layers onto the validated answers to build the form. */
export interface FaqFormInputs {
  /** The documents, as the agent takes them. */
  documents?: FaqFormDocument[];
  /** The LFX project uid the run belongs to. */
  projectUid?: string;
  /** The run date, YYYY-MM-DD; the renderer defaults it to today (UTC). */
  runDate?: string;
}

/** Request body for `POST /api/mktg-agents/faq/generate` — the form answers (the framework among them) plus the documents. */
export type FaqGenerateRequest = MktgRunGenerateBody;

/** Response of `POST /api/mktg-agents/faq/generate` — the session to poll. */
export type FaqGenerateResponse = MktgRunSessionResponse;

/** Request body for `POST /api/mktg-agents/faq/answers` — the answers to the session's questions turn. */
export type FaqAnswersRequest = MktgRunAnswersBody;

/** Response of `POST /api/mktg-agents/faq/answers`. */
export type FaqAnswersResponse = MktgRunAnswersResponse;

/** Request body for `POST /api/mktg-agents/faq/result`. */
export type FaqResultRequest = MktgRunResultBody;

/**
 * Response of `POST /api/mktg-agents/faq/result`: `ready` with the FAQ as
 * the run's asset (and the receipt of the stored revision when the write
 * succeeded), `questions` while the session holds the agent's questions and
 * no valid envelope, `refused` when the run ended on a reply instead of an
 * FAQ (no approved framework, or a draft that never passed its checks),
 * `pending` otherwise.
 */
export interface FaqResultResponse extends MktgRunResultResponse {
  /** Project display name from the envelope. Present when ready. */
  projectName?: string;
  /** Project slug from the envelope. Present when ready. */
  project?: string;
  /** Persistence receipt; absent on a ready result when the write did not happen (retried on the next poll). */
  persistence?: MktgArtifactPersistReceipt;
}

/**
 * Where a session without a valid envelope stands, read from the agent's own
 * text turns: asking its questions, ended on a reply (no approved framework,
 * or a draft that never passed its checks), or still working.
 */
export type FaqSessionOutcome = { status: 'questions'; questions: MktgRunQuestion[] } | { status: 'refused'; reply: string } | { status: 'pending' };

/** Structured result of validating a candidate envelope or a request body. */
export interface FaqValidationResult {
  valid: boolean;
  errors: string[];
}

/** One question as the FAQ view renders it. */
export interface FaqQuestionView {
  /** `faq[g][1][q]` — the field a comment on the entry names. */
  path: string;
  question: string;
  /** The answer; '' when the sources did not give one. */
  answer: string;
  /** The source label; '' with no answer. */
  source: string;
  answered: boolean;
}

/** One group as the FAQ view renders it. */
export interface FaqGroupView {
  /** `faq[g]`; the `@for` track key. */
  path: string;
  name: string;
  questions: FaqQuestionView[];
  /** How many of its questions need an answer from the team. */
  unanswered: number;
}

/** One tab of the FAQ view as its template binds it. */
export interface MktgFaqViewTab {
  id: FaqViewTab;
  label: string;
  selected: boolean;
  tabClass: string;
  panelId: string;
  tabId: string;
}
