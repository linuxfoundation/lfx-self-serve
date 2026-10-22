// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Form-first agent run contract for the Marketing OS Agents marketplace
// (LFXAI-95 workstream). An agent run collects a batch intake form, submits it
// through the agent's validated generate endpoint (regenerations go through
// the existing chat/session BFF, `POST /api/mktg-agents/chat`), polls the
// agent's result endpoint for the schema-validated document — or, for agents
// that research first, for the questions it could not settle, answered on
// the same session — and stores each generated document as a browser-side
// version so the marketplace can badge agents that already have output.

import { FOUNDATION_MESSAGE_ANSWER_ORIGINS } from '../constants/foundation-message.constants';
import type { MKTG_RUN_ACTIVITY_KINDS } from '../constants/mktg-run-activity.constants';
import type { BoilerplatesChecks, BoilerplatesContent, BoilerplatesMode, BoilerplatesReport } from './boilerplates.interface';
import type { BrandKitRevision } from './brand-kit.interface';
import type { FaqChecks, FaqContent, FaqMode, FaqReport } from './faq.interface';
import type { FoundationMessageChecks, FoundationMessageContent, FoundationMessageMode, FoundationMessageReport } from './foundation-message.interface';
import type { MktgSessionInfo } from './mktg-chat.interface';
import type { MktgDocumentLocation, MktgDocumentPersistLocation } from './mktg-document-store.interface';

/**
 * How a single intake field is rendered on the run page: one line, several
 * lines, or a repeatable list of links (`url-list`: one `https://` link per
 * row with an "Add another link" control; the answer is the rows joined by
 * newlines, so it validates and travels like a `source-url-list` textarea).
 */
export type MktgIntakeFieldKind = 'text' | 'textarea' | 'url-list';

/**
 * LFX data source a field can be pre-filled from. Prefilled fields render a
 * "From LFX" chip and stay editable — the marketplace never re-asks what LFX
 * already knows.
 */
export type MktgIntakePrefillSource = 'project-name' | 'repository-url' | 'website-url' | 'project-description';

/**
 * Format rule enforced on a field's value. Unlike the agents' own contracts —
 * which keep these answers free text (dec-paul-prompt-fidelity) — the LFX
 * collection UI REFUSES a value that provably cannot do what the field is for:
 * the field shows why and submission stays disabled until it is corrected.
 * Product ruling; the question wording itself is still quoted verbatim.
 *
 * - `github-repo-url`: must name one repository (`github.com/<owner>/<repo>`).
 *   For the intakes whose BFF fetches that repository's README.
 * - `github-url`: a repository OR an account URL (`github.com/<owner>`, e.g.
 *   a GitHub organization). For the Brand Kit, whose BFF sends the URL to
 *   the agent as text and fetches nothing, so an organization URL is a usable
 *   answer to "the project's GitHub repo or README" (hand test, 2026-10-12).
 * - `source-url`: a page the agent fetches itself (the Messaging Framework's
 *   website, the Brand Kit's brand page) — an `https://` link, or "none".
 * - `source-url-list`: several such links, one per line; blank lines are
 *   ignored. No intake uses it at present.
 * - `https-url`: one `https://` link, "none" not accepted (the Brand Kit's
 *   website, which the agent must read).
 */
export type MktgIntakeFieldFormat = 'github-repo-url' | 'github-url' | 'source-url' | 'source-url-list' | 'https-url';

/**
 * Where a README the BFF fetched for an agent came from: the repository the
 * URL named, the organization-profile location (`<owner>/.github` →
 * `profile/README.md`), or the repository named after the account
 * (`<owner>/<owner>`, which serves a personal profile README and, for an
 * organization named after its flagship project, that project's overview).
 *
 * These name LOCATIONS, not account types. A `github.com/<owner>` URL says
 * nothing about whether the account is a person or an organization, so a
 * source that implied one would be recording a guess as provenance.
 */
export type MktgReadmeSource = 'repository' | 'org-profile' | 'owner-repo';

/**
 * Why the BFF's best-effort README fetch produced nothing. Carried to the UI
 * so a thin document is never a silent mystery: the run says which of these
 * happened instead of leaving the user to guess why the agent had no code
 * context.
 *
 * The reasons are distinct because their REMEDIES are: `not-a-repo-url` and
 * `no-readme` ask the user to change something, `not-public` says the repo is
 * not readable anonymously (the LFX token is deliberately never used as a
 * read oracle for it), and `fetch-failed` says GitHub itself failed and a
 * retry is the right move. Collapsing them tells users to fix a URL that was
 * never the problem.
 */
export type MktgReadmeSkipReason = 'not-a-repo-url' | 'no-readme' | 'not-public' | 'fetch-failed';

/**
 * Outcome of the server-side README fetch for one generation (agents with no
 * web access — the ICP's `readme_markdown` input). Reported on the generate
 * response and stored with the version it produced, because the fetch
 * happens per submission: a regeneration with a corrected URL must not
 * inherit the previous attempt's verdict.
 */
export interface MktgReadmeOutcome {
  /** True when a README was fetched and handed to the agent. */
  fetched: boolean;
  /** Where the README came from, when one was fetched. */
  source?: MktgReadmeSource;
  /** Why nothing was fetched, when none was. */
  skipReason?: MktgReadmeSkipReason;
}

/** What one server-side README fetch attempt produced: the content plus its honest outcome. */
export interface MktgReadmeFetchResult {
  /** The README markdown (size-capped), or null when none was obtained. */
  readme: string | null;
  /** Where it came from / why nothing came — reported on the generate response. */
  outcome: MktgReadmeOutcome;
}

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
   * Format rule the answer must satisfy. When it does not, the field shows the
   * reason and submission is blocked until it is fixed.
   */
  format?: MktgIntakeFieldFormat;
  /**
   * Optional answer: no required validator, no asterisk, and the key is
   * omitted from the submitted answers when the trimmed value is empty.
   */
  optional?: boolean;
  /**
   * The agent's BFF refuses a line break in this answer ("must be one line"),
   * so the form validates it where it is fixable. Only set on fields whose
   * BFF enforces it; the other agents accept multi-line text in their `text`
   * fields.
   */
  oneLine?: boolean;
  /**
   * Offers a file upload beside the control (the Messaging Framework's deck
   * and plan: "upload or URL"). A file picked here joins the intake's
   * documents section already tagged with this kind — the requester never
   * tags it by hand — and is read to text there like any other upload.
   * Needs an intake with a documents section.
   */
  uploadTag?: string;
  /** Most rows a `url-list` field takes; the "Add another link" control stops there. */
  maxItems?: number;
}

/**
 * A titled group of intake fields on the run page (e.g. the Messaging
 * Document's "Sources"). Intakes without groups render their fields as one
 * flat list.
 */
export interface MktgIntakeFieldGroup {
  /** Stable id; the `@for` track key and the test id suffix. */
  id: string;
  /** Section heading. */
  title: string;
  /** Short note beside the heading. */
  hint?: string;
  /** Helper paragraph under the group's fields. */
  footnote?: string;
  /** Keys of the intake fields in this group, in display order. */
  fieldKeys: string[];
  /**
   * The group comes after the documents section instead of before it (the
   * FAQ's notes, last on the form). Without it a group renders before.
   */
  afterDocuments?: boolean;
}

/** A field group with its fields resolved, as the run page renders it. */
export interface MktgResolvedFieldGroup {
  /** The group's id. */
  id: string;
  /** Section heading. */
  title: string;
  /** Short note beside the heading ('' when none). */
  hint: string;
  /** Helper paragraph under the fields ('' when none). */
  footnote: string;
  /** The group's fields, in display order. */
  fields: MktgIntakeField[];
  /** True when the group renders after the documents section. */
  afterDocuments: boolean;
}

/**
 * One existing document submitted with a generate request: a link the agent
 * fetches itself, or an uploaded file the BFF already turned into text (the
 * browser never parses a file).
 */
export interface MktgIntakeDocument {
  /** Where the document came from. */
  kind: 'link' | 'file';
  /** Human label (one line): the file name, or the link itself. */
  title: string;
  /** The link, for `kind: 'link'`. Sent to the agent as is; LFX One never reads it. */
  url?: string;
  /** The extracted text, for `kind: 'file'`. */
  text?: string;
  /**
   * What the document is, for intakes whose documents section offers tags
   * ({@link MktgIntakeDocumentsConfig.tags}): the Messaging Framework's press
   * release, deck, document, plan or logo package. Absent for intakes without
   * tags.
   */
  tag?: string;
}

/** An existing document on the form, with what reading it produced. */
export interface MktgIntakeDocumentEntry extends MktgIntakeDocument {
  /** Client-side id; the `@for` track key. */
  id: string;
  /** Whether LFX One read it to text (an uploaded file). A link is never read here: the agent fetches it. */
  read: boolean;
  /** Word count of the text read; 0 for a link. */
  words: number;
  /** True when the text was cut at the size cap. */
  truncated: boolean;
  /** Why it was not read, in words the user can act on. */
  reason?: string;
}

/** One existing document as the form lists it, precomputed so the template binds properties only. */
export interface MktgIntakeDocumentRow {
  /** The entry's id; the `@for` track key. */
  id: string;
  /** `LINK` or `FILE`. */
  badge: string;
  /** The document's title. */
  title: string;
  /** What the agent gets: "read · 6,100 words" for a file, "the agent reads it" for a link. */
  status: string;
  /** Tailwind colour class of the status. */
  statusClass: string;
  /** The tag picker's control name (the entry's id), for intakes with tags; '' otherwise. */
  tagControl: string;
}

/** One tag a document on the form can carry: the agent's kind and what the form calls it. */
export interface MktgIntakeDocumentTag {
  /** The agent's document kind, e.g. `press`. */
  value: string;
  /** What the form calls it, e.g. `Press release`. */
  label: string;
}

/** Response of the existing-document file endpoint: what LFX One read from an uploaded file. */
export interface MktgDocumentExtractResponse {
  /** Title to show: the file name. */
  title: string;
  /** Whether any text was read. */
  read: boolean;
  /** Word count of the text read. */
  words: number;
  /** True when the text was cut at the size cap. */
  truncated: boolean;
  /** The text, submitted back with the run. */
  text?: string;
  /** Why nothing was read, in words the user can act on. */
  reason?: string;
}

/**
 * Why LFX One could not read an uploaded file to text. Each has its own
 * remedy (export without a password, upload a text version, a shorter one),
 * which is why they are told apart.
 */
export type MktgReadTextReason = 'unsupported' | 'encrypted' | 'no-text' | 'too-complex' | 'too-large' | 'busy';

/** What reading one uploaded file to text produced on the server. */
export interface MktgReadText {
  /** The text, or null when nothing could be read. */
  text: string | null;
  /** True when the text was cut at its size cap. */
  truncated: boolean;
  /** Why nothing was read, when nothing was. */
  reason?: MktgReadTextReason;
}

/** A message from the BFF's PDF worker: ready for its PDF, then the PDF's text or why it has none. */
export interface MktgPdfWorkerReply {
  /** True once pdf.js has loaded and the worker waits for its PDF. */
  ready?: boolean;
  /** The PDF's text, page by page. */
  text?: string;
  /** Why there is no text. */
  reason?: MktgReadTextReason;
}

/**
 * The optional existing-documents section of an intake (the Messaging
 * Document's Step 0a): uploaded files, turned into text by the BFF before the
 * agent runs, and links the agent reads itself.
 */
export interface MktgIntakeDocumentsConfig {
  /** Section heading. */
  title: string;
  /** Short note beside the heading. */
  hint: string;
  /** Helper paragraph under the controls. */
  footnote: string;
  /** Most documents one run takes. */
  maxDocuments: number;
  /** Largest file accepted, in bytes. */
  maxFileBytes: number;
  /** Accepted file extensions, lowercase with the dot. */
  fileExtensions: string[];
  /** BFF endpoint that reads an uploaded file (raw body) to text. */
  endpoints: { file: string };
  /**
   * Tags the requester picks per document (what it is), for agents whose
   * form takes a document kind. Without them a document carries no tag.
   */
  tags?: MktgIntakeDocumentTag[];
  /** The tag a new document gets until the requester changes it; required when `tags` is set. */
  defaultTag?: string;
}

/**
 * One logo file as an agent's form takes it (the Brand Kit's `logo_files[]`):
 * its name and exactly one of SVG text, base64 bytes (a PNG or a ZIP), or a
 * link the agent fetches itself.
 */
export interface MktgIntakeLogoFile {
  /** The file name as uploaded, with its extension; the reference the kit uses. */
  name: string;
  /** The SVG source text (an .svg upload). */
  text?: string;
  /** The file's bytes as base64 (a .png or .zip upload). */
  base64?: string;
  /** A link to the file instead of its content. */
  url?: string;
}

/** A logo file on the form, with how it will travel. */
export interface MktgIntakeLogoFileEntry {
  /** Client-side id; the `@for` track key. */
  id: string;
  /** The file as the generate request submits it. */
  file: MktgIntakeLogoFile;
  /** `SVG`, `PNG`, `ZIP` or `LINK`. */
  badge: string;
  /** What the agent gets: "12 KB, as text", "340 KB, as bytes" or "the agent fetches it". */
  status: string;
}

/**
 * The optional logo-files section of an intake (the Brand Kit's artwork):
 * SVG, PNG and ZIP files read in the browser and sent with the form, and
 * links the agent fetches itself. With none, the agent asks for them in its
 * question round.
 */
export interface MktgIntakeLogoFilesConfig {
  /** Section heading. */
  title: string;
  /** Short note beside the heading. */
  hint: string;
  /** Helper paragraph under the controls. */
  footnote: string;
  /** Most files one run takes. */
  maxFiles: number;
  /** Largest file, in characters once read (SVG text, or base64 bytes). */
  maxFileChars: number;
  /** All files together, in characters — one request body carries them. */
  maxPayloadChars: number;
  /** Accepted file extensions, lowercase with the dot. */
  fileExtensions: string[];
}

/**
 * A sibling agent's document auto-attached to an intake's submitted answers
 * (dec-agent-dependency-gating): agents that CONSUME another agent's output
 * (e.g. the Message Foundation consumes the Brand Kit) never ask for it —
 * the run page fetches the dependency's stored document at submit time
 * (server-approved current only, never a browser Draft) and submits it
 * under the agent's own schema key. The form shows a non-interactive
 * "Using <project>'s <document> (vN)" chip instead of any choice UI.
 */
export interface MktgIntakeAttachment {
  /**
   * Catalog agent id whose stored output is attached. A required attachment
   * gates the run page's submit (fail-closed until it resolves); listing its
   * source in the consuming agent's `dependsOn` as well locks the marketplace
   * card too. An `optional` one must appear in neither, or it becomes a hard gate.
   */
  sourceAgentId: string;
  /** Answer key the document is submitted under (the agent's own batch schema key, e.g. `brand_kit_markdown`). */
  answerKey: string;
  /** Human name of the attached document for the on-form chip, e.g. `Brand Kit`. */
  documentName: string;
  /**
   * The consuming agent works WITHOUT this document. An optional attachment is
   * submitted when the project has one stored and simply omitted when it does
   * not — it never appears in `dependsOn`, so it never gates the marketplace
   * card or blocks submission. The form still says which way it went: a
   * present document earns the usual "Using …" chip, an absent one an honest
   * "no … stored" chip, because the same intake produces a materially
   * different document depending on which inputs the agent actually had.
   *
   * Required attachments (the default) belong to agents that cannot run
   * without the document: the run page disables its submit and says what is
   * needed, with a link to the source agent's page.
   */
  optional?: boolean;
  /** Gate guidance when the stored read returns no usable selection. */
  missingNote?: string;
  /**
   * What is submitted under `answerKey`: the document's Markdown (the
   * default, what the ICP's attachments take) or the stored revision's
   * sidecar JSON — the envelope's structured fields — serialized (the
   * Brand Kit takes the messaging framework as JSON).
   *
   * All attachments resolve the server's approved current, never a browser
   * Draft. JSON attachments additionally request the sidecar and date.
   *
   * A resolved revision counts as the attachment only when the consuming
   * agent can read from its sidecar what it takes
   * (`mktgJsonAttachmentUsable` — the client-side copy of the agent's own
   * validator rule, e.g. a voice for the Brand Kit). A revision it cannot
   * read is neither submitted nor named on a chip: the run page shows
   * `incompleteNote` with the link instead, since submitting it would only
   * earn the server's 400 and a retry could never succeed.
   */
  format?: 'markdown' | 'json';
  /**
   * The note the run page shows, with the link to the source agent's page,
   * when the selected approved revision exists but the agent can read
   * nothing from it (a `json` attachment whose sidecar lacks the fields the
   * agent takes — the Brand Kit's framework with no positioning or tagline
   * yet). Defaults to "Finish the <document> first." Only read for a
   * required `json` attachment.
   */
  incompleteNote?: string;
  /**
   * For a `json` messaging framework attachment: the consuming agent reads
   * the framework's whole content (`{mf, icp, mh, nums}` — the Boilerplates
   * carry its positioning, its proof and its avoid list; the FAQ answers
   * from it), not only its voice (the Brand Kit). A revision then counts as
   * the attachment only when its sidecar carries that content
   * (`mktgJsonAttachmentUsable`), the rule the consuming agent's BFF
   * validator and the agent's own gate apply.
   */
  frameworkContent?: boolean;
}

/**
 * A dependency agent's stored output document resolved for one project —
 * what marketplace gating checks and intake attachments submit.
 */
export interface MktgDependencyDocument {
  /** Catalog agent id that produced the document. */
  agentId: string;
  /** New resolutions use server-approved current only; `browser` remains for legacy type compatibility. */
  source: 'server' | 'browser';
  /** Attached approved revision's number in Documents, not a session's draft version. */
  version: number;
  /**
   * The stored document as a dependent agent reads it: always Markdown. A
   * structured asset (the Messaging Framework's JSON) is rendered to
   * Markdown when it is resolved, never handed over as JSON text.
   */
  document: string;
  /** ISO-8601 timestamp the revision was stored, when the server reported one. */
  storedAt?: string;
  /** The revision's sidecar JSON (the envelope's structured fields), when the read carried it — what a `json` attachment submits. */
  sidecar?: Record<string, unknown>;
}

/**
 * The link the run page offers under its "Run the <document> first" note
 * (and on the attachment chip): the source agent's own page, where the
 * document is made.
 */
export interface MktgMissingDependencyLink {
  /** Button text, e.g. `Open the Messaging Framework page`. */
  label: string;
  /** Catalog agent id of the source agent — the sibling route segment. */
  agentId: string;
}

/**
 * One rendered attachment chip on the intake form — what the run is actually
 * submitting alongside the answers. Precomputed in the component rather than
 * expressed in the template because the present/absent decision drives BOTH
 * the wording and the styling, and the repo prohibits the nested conditional
 * a template-side derivation would need.
 */
export interface MktgAttachmentChip {
  /** Source agent id the chip describes; the `@for` track key. */
  key: string;
  /** Chip text — "Using <project>'s <document> (vN)", "Uses the approved <document> · vN · <date>" or the honest absent note. */
  label: string;
  /** Tailwind colour classes for the chip. */
  chipClass: string;
  /** Font Awesome icon class for the chip. */
  iconClass: string;
  /**
   * Catalog agent id of the page the chip links to (the source agent's own
   * page — the Messaging Framework page for the Brand Kit's framework chip).
   * A chip with one renders as a link; without, as plain text.
   */
  linkAgentId?: string;
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
  /**
   * POST — body {@link MktgRunAnswersBody}; responds `{ success: true }`. For
   * agents whose result can be `questions` (they research first and ask only
   * the gaps): the answers go to the SAME session, and the run polls on.
   */
  answers?: string;
  /**
   * GET `?project=<uid>` — approved current for plain and sidecar reads;
   * true pre-revision plain fallback is the only exception. Responds
   * `MktgArtifactStoredResponse`, 404 when none is approved, 403 without writer rights. Only agents
   * that declare {@link MktgAgentIntake.persistsDocument} can have one, and
   * every persisting agent that is CONSUMED as a dependency or attachment
   * must — it is what lets dependency resolution reach ANY agent's document
   * generically instead of knowing one agent's client by name. A persisting
   * agent nothing consumes yet may leave it unset until its first consumer.
   */
  stored?: string;
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
  /** Existing documents, for intakes with a documents section. */
  documents?: MktgIntakeDocument[];
  /** Logo files, for intakes with a logo-files section (the Brand Kit). */
  logoFiles?: MktgIntakeLogoFile[];
  /**
   * LFX project uid sent for every intake. The BFF resolves the writer grant
   * and canonical uid for the durable run scope; agents with LFX lookups use
   * that same resolved project.
   */
  project?: string;
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

/** Browser-local capability for resuming a pending one-off document; never placed in a URL. */
export interface MktgPendingDocumentRun {
  /** Optional LFX-side answers needed to resume the pending document. */
  answers?: Record<string, string>;
  agentId: string;
  projectUid: string;
  documentId: string;
  sessionId: string;
  ownerToken: string;
  savedAt: string;
}

/** Response of an agent's `generate` endpoint — the session to poll. */
export interface MktgRunSessionResponse {
  /** Stable destination for a one-off run's document, returned before storage. */
  documentId?: string;
  /** Public opaque run selector, not a Guild session id or capability. */
  runId?: string;
  /** Guild session id running the one-shot form-mode generation. */
  sessionId: string;
  /** Opaque creator-binding token; required to fetch the result. */
  ownerToken: string;
  /**
   * Outcome of the server-side README fetch, for agents whose BFF fetches one
   * (the ICP). Reported HERE rather than on the result because the fetch is
   * part of composing the submission — by the time the document is polled it
   * is long settled. Absent for agents that fetch no README.
   */
  readme?: MktgReadmeOutcome;
}

/** Where an answer on a questions step came from (the agent's answer origins). */
export type MktgRunAnswerOrigin = (typeof FOUNDATION_MESSAGE_ANSWER_ORIGINS)[number];

/**
 * One question an agent asks after researching the sources — a gap it could
 * not settle, with its best guess. Returned on a `questions` result and shown
 * as the run's second step; the requester accepts or edits every one.
 */
export interface MktgRunQuestion {
  /** The agent's stable id for the question (`ranked-goals`); the answer travels back under it. */
  key: string;
  /** Short label, derived from the id (`Ranked goals`). */
  label: string;
  /** The question itself. */
  question: string;
  /** Why the agent could not settle it from the sources. */
  why: string;
  /** The agent's suggested answer, pre-filled on the form; '' when it has none. */
  suggestedAnswer: string;
  /** Links (or source names) the suggestion rests on. */
  basis: string[];
}

/** One answer to a {@link MktgRunQuestion}. */
export interface MktgRunAnswer {
  /** The question's key. */
  key: string;
  /** The answer as the requester left it (never empty, never a skip). */
  text: string;
  /** Unchanged suggestion, an edited one, or the requester's own where there was none. */
  origin: MktgRunAnswerOrigin;
}

/**
 * Body POSTed to an agent's `answers` endpoint. The owner token travels in
 * the body like every session write: only the session's creator may answer.
 */
export interface MktgRunAnswersBody {
  /** Writer-resolved run scope for durable continuation; optional for legacy owner-only calls. */
  project?: string;
  /** Questions block being answered; accepted answers renew the recorded run budget. */
  questionsId?: string;
  /** Guild session id the questions came from. */
  sessionId: string;
  /** Creator-binding owner token returned by the generate endpoint. */
  ownerToken: string;
  /** One answer per question asked, in the questions' order. */
  answers: MktgRunAnswer[];
}

/** Response of an agent's `answers` endpoint. */
export interface MktgRunAnswersResponse {
  /** True once the answers turn reached the session. */
  success: true;
}

/** One link (or source name) a suggested answer rests on, as the questions step renders it. */
export interface MktgRunBasisLink {
  /** What to show. */
  text: string;
  /** The link, or null when the basis is a source name rather than a URL. */
  href: string | null;
}

/** One question as the questions step renders it, precomputed so the template binds properties only. */
export interface MktgRunQuestionRow {
  /** The question's key; the `@for` track key and the control name. */
  key: string;
  /** Short label. */
  label: string;
  /** The question itself. */
  question: string;
  /** Why the agent could not settle it ('' when it gave no reason). */
  why: string;
  /** True when a suggested answer pre-fills the box. */
  suggested: boolean;
  /** What the suggestion rests on. */
  basis: MktgRunBasisLink[];
  /** The textarea's element id. */
  controlId: string;
}

/** Where one question stands in the questions stepper's header. */
export type MktgRunQuestionChipState = 'current' | 'answered' | 'open';

/** One header chip of the questions stepper. */
export interface MktgRunQuestionChip {
  /** The question's key; the `@for` track key. */
  key: string;
  /** The question's label, shortened ("Vision", "Proof points"). */
  label: string;
  /** Its position, 0-based. */
  index: number;
  /** Current, answered or still open. */
  state: MktgRunQuestionChipState;
}

/**
 * Receipt of an agent's server-side persistence write, returned on a `ready`
 * result by every agent whose contract persists the validated document (the
 * Brand Kit, the Messaging Framework and the ICP). The run shell keeps its
 * `content_sha256` on the version (an export names the stored revision by
 * it), and a ready result WITHOUT a receipt means the object-store write
 * did not happen — transient by default, and because the keys are
 * content-addressed the next poll re-runs the same write idempotently.
 * Field names are snake_case (unlike the camelCase enclosing response) on
 * purpose: they mirror the downstream Artifact contract verbatim so minting
 * needs no normalization layer — do not camelCase them.
 */
export interface MktgRunPersistReceipt {
  /** Exact revision recorded by this result; absent on legacy artifact-only receipts. */
  document_location?: MktgDocumentPersistLocation;
  /** Content-addressed object key the document was written to, e.g. `brand-kit/{project}/{content_sha256}.md`. */
  s3_key: string;
  /** Validated + recomputed document SHA-256. */
  content_sha256: string;
  /**
   * Storage partition: the SERVER-RESOLVED LFX project uid the document was
   * written for (the caller held its writer grant), never an agent-emitted,
   * free-text-derived slug — the write and read paths must address the same
   * identifier or a persisted document is invisible to the project that owns it.
   */
  project: string;
  /**
   * Document draft version from the envelope — a label scoped to the run that
   * produced the document, not a project-wide sequence: it restarts at 1 for a
   * different writer, browser or expired stored run. Never order a project's
   * stored documents by it; the store's write time is the only ordering that
   * is monotonic across writers.
   */
  version: number;
}

/** Minimal server-side seam for catalog consumers with different output protocols. */
export interface MktgRunOutcomeSource {
  status: string;
}
export interface MktgFailedRunOutcome {
  status: 'failed';
  failure: MktgRunFailure;
}

/** Internal settled-error reader shared with Slides export; raw text stays server-side. */
export interface MktgSettledSessionError {
  eventType: string;
  text: string;
  /** Parsed event time; NaN when the provider omitted a readable timestamp. */
  at: number;
}

/** Requester-safe terminal failure; never contains raw Guild payloads or credentials. */
export interface MktgRunFailure {
  reason: string;
  /** Guild's non-tool error event type, or `session_failed` when none is safely nameable. */
  eventType: string;
}

/**
 * Response of an agent's `result` endpoint for the latest queued turn only:
 * `pending` until its schema-valid, integrity-checked envelope, then `ready`
 * with the validated document — or `questions` for its latest unanswered
 * block (`questionsId` distinguishes an already-answered block from a new one).
 * A later real reply after runtime end ends that pause as `failed`.
 * `refused` preserves a current-turn refusal instead of running (for example,
 * the Brand Kit without a messaging framework); its reply is the outcome.
 * `failed` also means an idle runtime ended without a valid envelope or an
 * outstanding questions pause. Its `failureText` is
 * the final plain-text reply (possibly empty), not a rendered document.
 * `refused` preserves an agent's explicit refusal contract in `reply`;
 * both end generation, but only `ready` can carry a persisted asset.
 */
export interface MktgRunResultResponse {
  /** Generation state. */
  status: 'pending' | 'ready' | 'questions' | 'refused' | 'failed';
  /** Final agent reply when its runtime ended without a valid asset; plain text only. */
  failureText?: string;
  /** Set when the session's own error events (runtime_error, llm_failed, …) ended the run before any output — this item's detection; `failureText` is main's idle-runtime-end reply. */
  failure?: MktgRunFailure;
  /** The agent's questions, present when `questions`. */
  questions?: MktgRunQuestion[];
  /** The agent's refusal reply, as the requester reads it. Present when `refused`. */
  reply?: string;
  /**
   * Stable id of the questions block (a content hash), present when
   * `questions`. The run shell answers a block once: a later poll that
   * reports the same id is the block it already answered, not a new one.
   */
  questionsId?: string;
  /** The validated document (Markdown). Present when ready, for agents that write a document. */
  documentMarkdown?: string;
  /**
   * The validated asset, for agents that write structured JSON instead of a
   * document (the Messaging Framework, the Boilerplates, the FAQ). Present when ready; a ready result
   * carries exactly one of `documentMarkdown` and `asset`.
   */
  asset?: MktgRunAsset;
  /** Draft version from the validated envelope. Present when ready. */
  version?: number;
  /** Word-count-locked derivatives from the validated envelope, when the agent's contract defines them. */
  derivatives?: Record<string, string>;
  /**
   * Persistence receipt for the returned document — present when ready AND
   * the server-side write succeeded, for the agents whose intake declares
   * {@link MktgAgentIntake.persistsDocument}. Absent on a ready result means
   * no server copy exists yet, which is what the run shell's bounded
   * persistence retry polls for.
   */
  persistence?: MktgRunPersistReceipt;
  /**
   * What the agent has done so far, in order, for agents whose intake
   * declares {@link MktgAgentIntake.liveActivity}: present on every status,
   * pending, questions and ready alike, so the run page can show the work as
   * it happens.
   */
  activity?: MktgRunActivity[];
  /**
   * The Brand Kit of a ready result: the tokens, the six chapters and the
   * report the kit view renders. The Brand Kit agent's revision is a JSON
   * kit, not a Markdown document — `documentMarkdown` still carries the
   * kit's Markdown rendering for the store and the sibling agents, but the
   * page shows this.
   */
  brandKit?: BrandKitRevision;
}

/**
 * Structured asset kinds selected by registered intakes on the document route.
 * The run route owns intake, research and questions, not these result views.
 * Brand Kit revisions use their own validated renderer on the document route.
 */
export type MktgAssetViewKind = 'messaging-framework' | 'boilerplates' | 'faq';

/**
 * The Messaging Framework as a validated structured output: the bundle with
 * the report and checks the framework view shows beside it.
 */
export interface MktgFrameworkAsset {
  kind: 'messaging-framework';
  content: FoundationMessageContent;
  report: FoundationMessageReport;
  checks: FoundationMessageChecks;
  mode: FoundationMessageMode;
}

/**
 * The Boilerplates as a validated structured output: the four lengths with
 * the report and the word counts the Boilerplates view shows beside them.
 */
export interface MktgBoilerplatesAsset {
  kind: 'boilerplates';
  content: BoilerplatesContent;
  report: BoilerplatesReport;
  checks: BoilerplatesChecks;
  mode: BoilerplatesMode;
}

/** The FAQ with its report and checks — the unanswered questions among them — as the FAQ view shows it. */
export interface MktgFaqAsset {
  kind: 'faq';
  content: FaqContent;
  report: FaqReport;
  checks: FaqChecks;
  mode: FaqMode;
}

/**
 * A validated structured output — what an agent that writes JSON returns
 * instead of a document, told apart by its `kind`. Stored with the run's
 * version and, by the BFF, as the revision's content.
 */
export type MktgRunAsset = MktgFrameworkAsset | MktgBoilerplatesAsset | MktgFaqAsset;

/** One kind of step in a run's live activity feed — also the header phase it belongs to. */
export type MktgRunActivityKind = (typeof MKTG_RUN_ACTIVITY_KINDS)[number];

/** Where one step of the feed stands. */
export type MktgRunActivityStatus = 'running' | 'done' | 'failed';

/**
 * One step of a run's live activity feed, built server-side from the
 * session's raw events. It carries only a plain sentence written by LFX One
 * and, for a web search, the query the agent typed: never a tool name, a
 * tool's output, an id, or the model's own reasoning.
 */
export interface MktgRunActivity {
  /** Position-based id, stable while the run goes on (`step-1`, `step-2`, … and `writing`). */
  id: string;
  /** What kind of work it is; picks the icon and the header phase. */
  kind: MktgRunActivityKind;
  /** The sentence, e.g. "Reading the aaif/spec README". */
  label: string;
  /** A muted second line, e.g. the search query in quotes. */
  detail?: string;
  /** Running, done or failed. */
  status: MktgRunActivityStatus;
  /** ISO-8601 time the step started. */
  startedAt: string;
  /** ISO-8601 time it ended, once it has. */
  endedAt?: string;
}

/** One step as the feed renders it: the activity plus its icon. */
export interface MktgRunActivityRow extends MktgRunActivity {
  /** Font Awesome classes of the kind's icon. */
  iconClass: string;
}

/** Where one header phase stands: under way, done, passed without a step, or not reached. */
export type MktgRunActivityPhaseState = 'active' | 'done' | 'skipped' | 'pending';

/** One phase of the feed's header. */
export interface MktgRunActivityPhase {
  /** The phase's id, e.g. `research`. */
  id: string;
  /** Its name, e.g. "Searching the web and LFX". */
  label: string;
  /** Where it stands. */
  state: MktgRunActivityPhaseState;
}

/** One phase of the feed's header and the kinds of step it groups. */
export interface MktgRunActivityPhaseDefinition {
  /** The phase's id, e.g. `research`. */
  id: string;
  /** Its name, e.g. "Searching the web and LFX". */
  label: string;
  /** The kinds of step it covers. */
  kinds: readonly MktgRunActivityKind[];
}

/**
 * A registered batch intake form for one agent. The run-page shell is driven
 * entirely by this definition, so a second agent's form slots in by adding a
 * new entry to the shared registry.
 */
export interface MktgAgentIntake {
  /** Dedicated one-off intake; no generic feedback/regeneration UI. */
  oneOffDocument?: boolean;
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
   * Sibling-agent documents auto-attached to the submitted answers at submit
   * time (dec-agent-dependency-gating), for agents that consume another
   * agent's stored output. A REQUIRED attachment gates the run page's submit
   * until it resolves (the Brand Kit needs the project's messaging
   * framework); listing its `sourceAgentId` in the catalog agent's `dependsOn`
   * as well locks the marketplace card too. An `optional` attachment appears
   * in neither, because the agent runs either way (the ICP consumes the
   * Brand Kit and the Message Foundation only when the project has them).
   */
  attachments?: MktgIntakeAttachment[];
  /**
   * The agent's result endpoint persists the validated document server-side
   * and reports a {@link MktgRunPersistReceipt} on `ready`
   * (dec-brand-kit-storage-v2). Set it for every persisting agent: it is what
   * tells the run shell that a ready result WITHOUT a receipt is a failed
   * write worth retrying, so a transient storage outage does not leave the
   * project without the server copy that dependency gating — and every other
   * browser and user — reads.
   */
  persistsDocument?: boolean;
  /**
   * Follow-ups (edit-inputs resubmit, feedback regeneration) go through the
   * agent's generate endpoint as a full resubmit (`feedback` + `priorVersion`
   * in the body, fresh Guild session) instead of a chat follow-up on the
   * stored session. Required for agents whose batch payload is a structured
   * `agent_input` object (server-side README fetch, typed form contract) —
   * a chat follow-up could carry neither.
   */
  regenerateViaGenerate?: boolean;
  /**
   * Every submission, the first and every edit-inputs resubmit, is a FRESH
   * generate with no prior version and no feedback: the agent's generate form
   * carries neither (for the Messaging Framework, a redraft from comments and
   * a check of a hand-edited version are later work). Intake submission carries
   * no inline feedback; browser history numbers versions independently because
   * each fresh envelope starts at version 1.
   */
  freshRunPerSubmission?: boolean;
  /** Titled field groups, in display order; without them the fields render as one list. */
  fieldGroups?: MktgIntakeFieldGroup[];
  /** The optional existing-documents section, shown after the fields. */
  documents?: MktgIntakeDocumentsConfig;
  /** The optional logo-files section, shown after the fields (the Brand Kit's artwork). */
  logoFiles?: MktgIntakeLogoFilesConfig;
  /**
   * Removes the run page's centred-container gutters for a wide intake, feed
   * and questions layout. The document route owns the rendered asset layout.
   */
  fullWidth?: boolean;
  /**
   * The result endpoint reports the agent's live activity
   * ({@link MktgRunResultResponse.activity}): the run page shows the research
   * timeline and transfers the owned attempt when writing begins.
   */
  liveActivity?: boolean;
  /**
   * Selects the structured renderer on the document route, never a Markdown
   * fallback. Intake, research and questions stay on the run route; writing
   * progress and the eventual stored revision belong to the document route.
   */
  assetView?: MktgAssetViewKind;
  /**
   * What the asterisk beside the submit button means, when the run page's
   * default ("answers are open-ended, in your own words") does not fit the
   * form — a sources form says that everything else is optional.
   */
  requiredNote?: string;
}

/** One generated document version for an agent run. */
export interface MktgRunVersion {
  /** Bounded content digest plus separate session/version keys; JSON assets may share empty Markdown. */
  source?: { sessionId: string; version: number; identity: string; payloadDigest?: string };
  documentLocation?: MktgDocumentLocation;
  /** 1-based version number; regeneration produces v+1. */
  version: number;
  /** The generated document (Markdown) returned by the agent; '' for an agent that writes an asset instead. */
  document: string;
  /** The validated asset, for agents whose intake declares an `assetView`. */
  asset?: MktgRunAsset;
  /** The feedback that produced this version, when it was a regeneration. */
  feedback?: string;
  /** Word-count-locked derivatives from the validated envelope, when the agent's contract defines them. */
  derivatives?: Record<string, string>;
  /**
   * Outcome of the server-side README fetch that fed this version, retained
   * per version in transport/cache bookkeeping. The retired Markdown result
   * surface's README outcome note is not shown or relocated to About.
   */
  readme?: MktgReadmeOutcome;
  /** The questions the agent asked before writing this version, when it asked any. */
  questions?: MktgRunQuestion[];
  /** The answers that went back, one per question. */
  answers?: MktgRunAnswer[];
  /** The Brand Kit this version is, for the Brand Kit agent: what the kit view renders (the document is its Markdown rendering). */
  brandKit?: BrandKitRevision;
  /**
   * SHA-256 of the content the server stored for this version (its
   * persistence receipt); absent without a receipt. Content equality does
   * not identify a revision or imply approval.
   */
  contentSha256?: string;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
}

/**
 * One intake answer remembered for a (user, project) pair so a LATER agent's
 * form never re-asks what the user already typed into an earlier one. Keyed by
 * intake field key, which is shared vocabulary across agents (`github_url`,
 * `project_name`, …) — the reason a Brand Kit answer can prefill the Message
 * Foundation form at all.
 */
export interface MktgRememberedAnswer {
  /** The submitted answer, trimmed. */
  value: string;
  /** Catalog agent id of the run the answer was submitted with — the provenance the chip states. */
  agentId: string;
  /** ISO-8601 timestamp of the submission that recorded it (the TTL clock). */
  savedAt: string;
}

/** A (user, project) answer memory: intake field key → the last answer given for it. */
export type MktgAnswerMemory = Record<string, MktgRememberedAnswer>;

/**
 * Browser-persisted record of an agent run for one project — the Guild session
 * plus the intake answers and every generated version. Because the record
 * carries the session's capability `ownerToken`, persistence is explicitly
 * time-bounded: records older than `MKTG_RUN_STORAGE_TTL_MS` (measured from
 * `savedAt`) are pruned on load rather than left at rest indefinitely.
 */
export interface MktgStoredAgentRun {
  /** Exact public run selector, retained with private creator history. */
  runId?: string;
  /** A failed attempt invalidates session reuse, never the successful version history. */
  sessionFailed?: boolean;
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

/** Saved history and the exact version selected by append/deduplication, including an older replay. */
export interface MktgRunAppendResult {
  run: MktgStoredAgentRun;
  version: number;
}

/**
 * Outcome of a generate submission — the Guild session the result poll must
 * query, paired with the version that poll must beat. Deriving them together
 * (follow-up → the stored draft's version; fresh session, including the
 * stale-session recovery fallback, → 0) means the poll gate can never demand a
 * version the session will not produce.
 */
export interface MktgRunAttempt {
  /** Exact public run selected by this accepted submission. */
  runId?: string;
  /** The Guild session whose result endpoint the document poll queries. */
  session: MktgSessionInfo;
  /** Version the polled envelope must exceed; 0 on a fresh session. */
  priorVersion: number;
  /**
   * Outcome of the server-side README fetch this submission triggered, when
   * the agent's BFF fetches one. Carried from the generate response to the
   * version the poll produces so the result can state, honestly, that the
   * document was written without a README.
   */
  readme?: MktgReadmeOutcome;
}

/** Run-page phase: intake → running/live research feed → (questions) → hand-off to the asset page. */
export type MktgRunPhase = 'form' | 'running' | 'questions';

/**
 * A questions turn waiting for the requester's answers: the session it came
 * from (with the poll gate the eventual document must beat), the block's id
 * and the questions. The run shell holds it between the `questions` progress
 * event and the answers submission.
 */
export interface MktgRunQuestionsPending {
  /** The generate attempt whose session asked the questions. */
  attempt: MktgRunAttempt;
  /** The block's stable id; the next poll ignores a block with this id. */
  questionsId: string;
  /** The questions to answer. */
  questions: MktgRunQuestion[];
}

/**
 * Progress events emitted while a generation request is in flight.
 *
 * `activity` repeats on every poll that reports the agent's live activity,
 * with the whole feed so far.
 *
 * `questions` ends the stream: the agent wants answers before it writes, and
 * the run continues through the service's `answerQuestions` on the same
 * session.
 *
 * `refused` ends the stream too: the agent did not run and replied why (the
 * Brand Kit's refusal without a messaging framework). The session is over;
 * nothing is stored, and the reply is shown as the run's outcome.
 *
 * `persisted` is emitted only by the bounded background persistence retry,
 * when a late server-side write finally lands. It matters because the SERVER
 * copy is what dependency gating reads for every browser and user: a document
 * announced on `document` alone can leave consumers holding the previous
 * server version until a page reload, and this is the event that says the
 * shared copy has caught up. It carries the stored run with the receipt's
 * hash on the version it persisted, which is what names that version's
 * stored revision (an export reads it), or null when this browser no longer
 * holds the run: the shared copy has still caught up.
 */
export type MktgGenerateProgress =
  | { type: 'submitted' }
  | { type: 'restored'; pending: MktgPendingGeneration; message: string }
  | { type: 'failed'; failureText?: string; failure?: MktgRunFailure }
  | { type: 'activity'; activity: MktgRunActivity[] }
  | { type: 'questions'; pending: MktgRunQuestionsPending }
  | { type: 'refused'; reply: string }
  /** The selected outcome, not necessarily the newest cached version; null location keeps its accepted attempt recoverable. */
  | { type: 'document'; run: MktgStoredAgentRun; documentLocation: MktgDocumentLocation | null; attempt: MktgRunAttempt }
  | { type: 'persisted'; run: MktgStoredAgentRun | null; documentLocation: MktgDocumentLocation | null; attempt: MktgRunAttempt | null };

/** Subject/project/agent-bound client attempt, retained BEFORE the first POST and through accepted answers. */
export interface MktgPendingGeneration {
  request: MktgGenerateRequest;
  state: 'draft' | 'writing' | 'questions' | 'failed';
  /** Uploaded bytes are memory-only; a restored intake needs its files reattached. */
  requiresReattachment?: boolean;
  attempt?: MktgRunAttempt;
  pendingQuestions?: MktgRunQuestionsPending;
  answered?: { questions: MktgRunQuestion[]; answers: MktgRunAnswer[]; questionsId: string };
  updatedAt: string;
}

/** Storage carries intake/context only, never uploaded document/logo bytes or serialized intake config. */
export interface MktgStoredPendingGeneration extends Omit<MktgPendingGeneration, 'request'> {
  request: Pick<MktgGenerateRequest, 'agentId' | 'projectUid' | 'answers' | 'feedback'>;
}

/** A pending navigation can be retried without repeating generation or answers. */
export interface MktgRunNavigation {
  projectUid: string;
  subject: string;
  agentKey: string;
  /** Canonical receipt document; prepared living intakes use the shared default until persisted. */
  documentId?: string;
  generation?: string;
  revisionId?: string;
  runId?: string;
}

/** In-memory navigation handoff; this is not a session capability and is never serialized into a URL. */
export interface MktgPreparedGeneration {
  subject: string;
  pending: MktgPendingGeneration;
}

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
  /** Existing documents, for intakes with a documents section. */
  documents?: MktgIntakeDocument[];
  /** Logo files, for intakes with a logo-files section. */
  logoFiles?: MktgIntakeLogoFile[];
  /**
   * Optional legacy/programmatic follow-up feedback; the current intake UI
   * has no Request changes form and does not send it. The prior draft's
   * version is NOT part of the request — the
   * run service derives it from the stored run so the follow-up message's
   * version directive and the result poll gate can never disagree.
   */
  feedback?: string;
}
