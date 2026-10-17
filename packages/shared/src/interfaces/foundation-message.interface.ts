// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Messaging Framework output envelope (messaging-framework-output/v1), the
// intake form contract and the questions/answers turns
// (messaging-framework-questions/v1, messaging-framework-answers/v1), shared
// between the Express BFF, the Angular run page and the framework view.
// Transcribed from marketing-os-agents agents/foundation-message 4.0.0
// (src/envelope.ts, src/form.ts, src/questions-turn.ts); the agent's JSON
// Schema (docs/contracts/messaging-framework-output.schema.json) is normative
// and this must stay in sync (reviewed at PR).

import {
  FOUNDATION_MESSAGE_ANSWER_KEYS,
  FOUNDATION_MESSAGE_DOCUMENT_KINDS,
  FOUNDATION_MESSAGE_ICP_KINDS,
  FOUNDATION_MESSAGE_MODES,
  FOUNDATION_MESSAGE_REVISION_MODES,
  FOUNDATION_MESSAGE_SOURCE_LABELS,
  FOUNDATION_MESSAGE_VIEW_TABS,
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

/** How a run is produced: a new draft, a redraft from comments, or a check of a hand-edited version. */
export type FoundationMessageMode = (typeof FOUNDATION_MESSAGE_MODES)[number];

/** The two revision modes a form may carry. */
export type FoundationMessageRevisionMode = (typeof FOUNDATION_MESSAGE_REVISION_MODES)[number];

/** What a document on the form is: a press release, a deck, any other document, the marketing plan, or a logo package. */
export type FoundationMessageDocumentKind = (typeof FOUNDATION_MESSAGE_DOCUMENT_KINDS)[number];

/** The intake answer keys the form collects. */
export type FoundationMessageAnswerKey = (typeof FOUNDATION_MESSAGE_ANSWER_KEYS)[number];

/** A proof point's source label. */
export type FoundationMessageSourceLabel = (typeof FOUNDATION_MESSAGE_SOURCE_LABELS)[number];

/** The two kinds of segment. */
export type FoundationMessageIcpKind = (typeof FOUNDATION_MESSAGE_ICP_KINDS)[number];

/** A tab of the framework view. */
export type FoundationMessageViewTab = (typeof FOUNDATION_MESSAGE_VIEW_TABS)[number]['id'];

/**
 * `[fact, source label]` — a proof point; `[role, what they care about]` — a
 * persona; `[avoid this, use this instead]` — an avoid pair; `[number,
 * label]` — a key number. A two-string array in the contract (never a
 * tuple), typed as one here for the view.
 */
export type FoundationMessagePair = [string, string];

/** One goal column of the framework. */
export interface FoundationMessageGoal {
  /** `events`, `adoption`, `community`, `membership`, or a slug of the plan's own goal name. */
  id: string;
  /** The goal's rank in the integrated plan. */
  n: number;
  /** The column title. */
  t: string;
  /** Value proposition, one sentence, benefit first. */
  vp: string;
  /** Key message: the belief we want, one sentence. */
  key: string;
  /** `[fact, source label]` proof points. */
  proof: FoundationMessagePair[];
  /** Sound bite, 3–10 words. */
  bite: string;
  /** Ids of the segments this column's message is for. */
  icps: string[];
}

/** The messaging framework itself (`mf`). */
export interface FoundationMessageMf {
  vision: string;
  mission: string;
  positioning: string;
  tagline: string;
  goals: FoundationMessageGoal[];
  /** The cross-cutting note (the goal with no column of its own). */
  crosscut: string;
  /** Words and phrases to say. */
  say: string[];
  /** `[avoid this, use this instead]`. */
  avoid: FoundationMessagePair[];
  /** The anchor questions every piece of content answers. */
  anchor: string[];
  /** Choices for the reviewer to check. */
  notes: string;
}

/** One ideal customer profile (`icp[]`). */
export interface FoundationMessageIcp {
  id: string;
  name: string;
  kind: FoundationMessageIcpKind;
  /** Who they are. */
  who: string;
  /** Ids of the goals this segment serves. */
  goals: string[];
  /** What they need. */
  need: string;
  /** The value for them. */
  value: string;
  /** The lead message. */
  lead: string;
  /** `[fact, source label]` proof points. */
  proof: FoundationMessagePair[];
  /** The call to action. */
  cta: string;
  channels: string[];
  /** `[objection, response or null]`. */
  objection: [string, string | null];
  /** `[role, what they care about]`. */
  personas: FoundationMessagePair[];
  /** A source label, or `Inferred`. */
  basis: string;
}

/** One pillar of the message house. */
export interface FoundationMessagePillar {
  /** Title. */
  t: string;
  /** Message. */
  m: string;
  /** `[fact, source label]` proof points. */
  p: FoundationMessagePair[];
}

/** The message house (`mh`). */
export interface FoundationMessageMh {
  /** The umbrella statement. */
  umbrella: string;
  /** The line, equal to `mf.tagline`. */
  line: string;
  pillars: FoundationMessagePillar[];
  /** The foundation line. */
  found: string;
  /** `[icp.name, icp.lead]` rows for the most important segments. */
  aud: FoundationMessagePair[];
}

/** The four keys of the bundle: the framework, the segments, the message house and the key numbers. */
export interface FoundationMessageContent {
  mf: FoundationMessageMf;
  icp: FoundationMessageIcp[];
  mh: FoundationMessageMh;
  /** `[number, label]` key numbers. */
  nums: FoundationMessagePair[];
}

/** What the run read, what it could not read, and what the sources do not state. */
export interface FoundationMessageReport {
  sources_read: string[];
  sources_failed: { name: string; reason: string }[];
  gaps: string[];
  /** Anything a person should check; on a check, one issue per line. */
  notes: string;
}

/** The finalize tool's mechanical findings: empty on a draft and a redraft, the list on a check. */
export interface FoundationMessageChecks {
  findings: string[];
}

/** One question of the round as the envelope records it. */
export interface FoundationMessageQuestionAsked {
  id: string;
  question: string;
  why: string;
  suggested_answer: string;
  basis: string;
  answered: boolean;
}

/** One answer of the round as the envelope records it. */
export interface FoundationMessageAnswerRecorded {
  id: string;
  question: string;
  answer: string;
  origin: string;
  date: string;
}

/** What this run was given and what it read. Loose: the agent may add keys. */
export interface FoundationMessageInputsRecord {
  date_read: string;
  website: { url: string; read: boolean } | null;
  links: { url: string; read: boolean }[];
  documents: { title: string; kind: FoundationMessageDocumentKind; url: string | null; text_supplied: boolean; read: boolean }[];
  notes_given: boolean;
  lfx_records: { slug: string; uid: string; name: string; date_read: string }[];
  questions_asked: FoundationMessageQuestionAsked[];
  answers: FoundationMessageAnswerRecorded[];
  web_searches: string[];
  fetched: { url: string; ok: boolean }[];
  [key: string]: unknown;
}

/** One comment a redraft applied, with how the agent resolved it. */
export interface FoundationMessageRevisionComment {
  number: number;
  field: string;
  comment: string;
  resolution: string;
}

/** How a redraft or a check came to be; null on a draft. */
export interface FoundationMessageRevisionRecord {
  mode: FoundationMessageRevisionMode;
  prior_version: number;
  /** The comments applied; empty on a check. */
  comments: FoundationMessageRevisionComment[];
}

/** How the run was produced, recorded by the agent wrapper. */
export interface FoundationMessageIntake {
  /** Always `form` (dec-qa-form-path-only). */
  mode: 'form';
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
 * The Messaging Framework output envelope: the JSON bundle, its report and
 * checks, the inputs record and the provenance. The exact payload the BFF
 * validates (schema gates and the sha256 recompute over the content JSON)
 * before storing it as a revision.
 */
export interface FoundationMessageEnvelope {
  /** Contract discriminator + version; consumers reject unknown majors. */
  contract: string;
  /** Always `messaging-framework`. */
  kind: string;
  /** Project slug (lowercase kebab-case) of `project_name`. */
  project: string;
  /** The project name exactly as the intake form gave it. */
  project_name: string;
  /** 1 on a draft; the stored version + 1 on a redraft or a check. */
  version: number;
  mode: FoundationMessageMode;
  content: FoundationMessageContent;
  /** Lowercase hex SHA-256 of `JSON.stringify(content)` (UTF-8). */
  content_sha256: string;
  report: FoundationMessageReport;
  checks: FoundationMessageChecks;
  inputs_record: FoundationMessageInputsRecord;
  intake: FoundationMessageIntake;
  revision: FoundationMessageRevisionRecord | null;
  /** The tool reality of the run. */
  capabilities: { web_fetch: boolean; lfx_mcp: boolean };
  /** ISO-8601 timestamp when the bundle was emitted. */
  generated_at: string;
  agent: FoundationMessageAgentProvenance;
}

/** One document as the agent's form takes it: an uploaded file's text, or a link the agent reads itself, tagged with what it is. */
export interface FoundationMessageFormDocument {
  /** Human label (one line): the file name or the link's title. */
  title?: string;
  kind: FoundationMessageDocumentKind;
  /** Link to the document; the agent fetches it. */
  url?: string;
  /** The document's text as LFX One read it from the uploaded file. */
  text?: string;
}

/**
 * How a single-link intake field that names a document (the press release,
 * the deck, the plan) reaches the agent: as a `documents[]` entry of this
 * kind, titled after the field so the agent knows what it is reading.
 */
export interface FoundationMessageUrlDocumentField {
  /** The agent's document kind. */
  kind: FoundationMessageDocumentKind;
  /** The document's title on the rendered form: the field's label. */
  title: string;
}

/** One reviewer comment on a redraft: the field it is about and what should change. */
export interface FoundationMessageReviewComment {
  /** A dotted / indexed path into the stored JSON (`mf.tagline`, `icp[0].cta`). */
  field: string;
  comment: string;
}

/** A redraft: the stored JSON plus the comments to apply. */
export interface FoundationMessageRedraftRevision {
  mode: 'redraft';
  prior_version: number;
  /** The stored `{ mf, icp, mh, nums }`. */
  previous: Record<string, unknown>;
  comments: FoundationMessageReviewComment[];
}

/** A check: the stored JSON a person edited by hand; no comments. */
export interface FoundationMessageCheckRevision {
  mode: 'check';
  prior_version: number;
  /** The stored `{ mf, icp, mh, nums }`, as edited. */
  previous: Record<string, unknown>;
}

/** The optional revision block of the form. */
export type FoundationMessageFormRevision = FoundationMessageRedraftRevision | FoundationMessageCheckRevision;

/**
 * The agent's `messaging_framework_intake_form` — what the BFF renders into
 * the one text message it sends (src/form.ts). Sources travel as URLs only:
 * the agent fetches and researches them itself. Every text passes through
 * verbatim.
 */
export interface FoundationMessageFormPayload {
  type: 'messaging_framework_intake_form';
  project_name: string;
  run_date?: string;
  /** The LFX project uid, for the agent's LFX lookups. */
  project_uid?: string;
  /** One line on what the project does. */
  description?: string;
  website_url?: string;
  /** Other links, in order. */
  links?: string[];
  documents?: FoundationMessageFormDocument[];
  /** Audience, segments and words to avoid — data, not instructions. */
  notes?: string;
  revision?: FoundationMessageFormRevision;
}

/** What the BFF layers onto the validated answers to build the form. */
export interface FoundationMessageFormInputs {
  /** The documents, as the agent takes them. */
  documents?: FoundationMessageFormDocument[];
  /** The LFX project uid the run belongs to. */
  projectUid?: string;
  /** The run date, YYYY-MM-DD; the renderer defaults it to today (UTC). */
  runDate?: string;
  /** A redraft or a check; absent on a draft. */
  revision?: FoundationMessageFormRevision;
}

/**
 * One question of the agent's questions turn (messaging-framework-questions/v1)
 * — a gap the sources and research left open, with the agent's best guess.
 * Field names mirror the agent's JSON block verbatim.
 */
export interface FoundationMessageQuestion {
  /** The agent's stable kebab-case id (`ranked-goals`); the answer travels back under it. */
  id: string;
  /** The question itself, ending with a question mark. */
  question: string;
  /** One sentence: what was read or searched and what it lacked. */
  why: string;
  /** The agent's suggested answer; empty when it has none. */
  suggested_answer: string;
  /** The URL(s) the suggestion rests on, `inferred`, or empty. */
  basis: string;
}

/** The agent's questions block: the fenced JSON of the questions turn. */
export interface FoundationMessageQuestionsBlock {
  /** Always `messaging-framework-questions/v1`. */
  contract: string;
  /** The project name as on the form. */
  project: string;
  /** The gap questions, most important first. */
  questions: FoundationMessageQuestion[];
}

/** One answer of the answers turn (messaging-framework-answers/v1): the run shell's answer shape, rendered per id with its origin. */
export type FoundationMessageAnswer = MktgRunAnswer;

/** Request body for `POST /api/mktg-agents/foundation-message/generate` — the form answers plus the documents. */
export type FoundationMessageGenerateRequest = MktgRunGenerateBody;

/** Response of `POST /api/mktg-agents/foundation-message/generate` — the session to poll. */
export type FoundationMessageGenerateResponse = MktgRunSessionResponse;

/** Request body for `POST /api/mktg-agents/foundation-message/answers` — the answers to the session's questions turn. */
export type FoundationMessageAnswersRequest = MktgRunAnswersBody;

/** Response of `POST /api/mktg-agents/foundation-message/answers`. */
export type FoundationMessageAnswersResponse = MktgRunAnswersResponse;

/** Request body for `POST /api/mktg-agents/foundation-message/result`. */
export type FoundationMessageResultRequest = MktgRunResultBody;

/** Receipt of a successful persistence write (the revision the framework was stored as). */
export type FoundationMessagePersistReceipt = MktgArtifactPersistReceipt;

/** Response of `GET /api/mktg-agents/foundation-message/stored?project=<uid>` — the latest stored revision. */
export type FoundationMessageStoredResponse = MktgArtifactStoredResponse;

/**
 * Response of `POST /api/mktg-agents/foundation-message/result`: `ready`
 * once the session holds a schema-valid, sha256-verified envelope, with the
 * framework as the run's asset and, when the write succeeded, the
 * persistence receipt of the stored revision; `questions` whenever the
 * session holds a questions block the agent wrote and no valid envelope yet
 * — the latest block, reported on every poll until a newer block or the
 * envelope appears, so the run shell tells an already-answered block apart
 * by its `questionsId`; `pending` otherwise.
 */
export interface FoundationMessageResultResponse extends MktgRunResultResponse {
  /** Project display name from the envelope. Present when ready. */
  projectName?: string;
  /** Project slug from the envelope. Present when ready. */
  project?: string;
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

/** One proof point as the framework view renders it. */
export interface FoundationMessageProofView {
  fact: string;
  /** The source label, as the agent wrote it. */
  source: string;
}

/** One goal column as the framework view renders it: the goal with its segments resolved to names. */
export interface FoundationMessageGoalView extends FoundationMessageGoal {
  proofRows: FoundationMessageProofView[];
  /** The names of the segments the column is for, in the framework's order. */
  segmentNames: string[];
}

/** One segment as the framework view renders it: the ICP with its goals resolved to titles. */
export interface FoundationMessageIcpView extends FoundationMessageIcp {
  proofRows: FoundationMessageProofView[];
  /** The titles of the goals the segment serves, in the framework's order. */
  goalTitles: string[];
  /** The personas as rows. */
  personaRows: { role: string; cares: string }[];
  /** The objection and its response, when there is one. */
  objectionText: string;
  objectionResponse: string;
}

/** One pillar as the framework view renders it. */
export interface FoundationMessagePillarView extends FoundationMessagePillar {
  proofRows: FoundationMessageProofView[];
}

/** One avoid pair as the framework view renders it. */
export interface FoundationMessageAvoidRow {
  avoid: string;
  instead: string;
}

/** One key number as the framework view renders it. */
export interface FoundationMessageNumberRow {
  number: string;
  label: string;
}

/** Where the framework view stands: the run is still working (the feed or the questions are projected in), or the framework is on screen. */
export type MktgFrameworkViewState = 'generating' | 'questions' | 'ready';

/** One tab of the framework view as its template binds it. */
export interface MktgFrameworkViewTab {
  id: FoundationMessageViewTab;
  label: string;
  selected: boolean;
  tabClass: string;
  panelId: string;
  tabId: string;
}

/** One audience row of the message house as the framework view renders it. */
export interface FoundationMessageAudienceRow {
  name: string;
  lead: string;
}
