// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { GithubRepoUrlErrorReason, MktgAgentIntake, MktgIntakeField, MktgIntakeFieldFormat, MktgReadmeSkipReason } from '../interfaces';
import { BRAND_KIT_FORM_PREAMBLE_LINES, BRAND_KIT_INTAKE_QUESTIONS } from './brand-kit.constants';
import {
  FOUNDATION_MESSAGE_DERIVATIVE_CHIPS,
  FOUNDATION_MESSAGE_DOCUMENT_ENDPOINTS,
  FOUNDATION_MESSAGE_FILE_EXTENSIONS,
  FOUNDATION_MESSAGE_MAX_DOCUMENTS,
  FOUNDATION_MESSAGE_MAX_FILE_BYTES,
  FOUNDATION_MESSAGE_QUESTIONS,
  FOUNDATION_MESSAGE_REQUIRED_HEADINGS,
  FOUNDATION_MESSAGE_SOURCE_FIELDS,
  FOUNDATION_MESSAGE_SOURCE_KINDS,
  FOUNDATION_MESSAGE_SOURCE_LABELS,
} from './foundation-message.constants';
import { ICP_FORM_PREAMBLE_LINES, ICP_GAP_FILL_QUESTIONS, ICP_Q_GITHUB_URL, ICP_Q_PROJECT_NAME, ICP_REQUIRED_HEADINGS } from './icp.constants';

/** Paul's questions whose answers run longer (proof points, objections, tagline and constraints) get a taller box. */
const FOUNDATION_MESSAGE_LONG_ANSWER_KEYS = new Set<string>(['proof_points', 'objections', 'tagline_ctas_constraints']);

// Form-first run-page configuration for the Marketing OS Agents marketplace
// (LFXAI-95 workstream): per-agent batch intake registry, running-phase stage
// labels, browser persistence key, and result polling cadence.

/**
 * Presentation layered onto Paul's verbatim brand-kit questions — control
 * kind, sizing, LFX prefill sources, and hints. Keyed by the question keys of
 * `BRAND_KIT_INTAKE_QUESTIONS`; the question wording itself is deliberately
 * NOT restated here (single verbatim copy, dec-paul-prompt-fidelity).
 */
const BRAND_KIT_FIELD_PRESENTATION: Record<(typeof BRAND_KIT_INTAKE_QUESTIONS)[number]['key'], Omit<MktgIntakeField, 'key' | 'question'>> = {
  project_name: { kind: 'text', prefill: 'project-name' },
  // Q2 asks for the repo or README URL. The Brand Kit BFF passes the answer
  // to the agent as text and fetches no README from it, so a GitHub
  // organization URL (e.g. https://github.com/opensearch-project) is a usable
  // answer too — accepted here (hand test, 2026-10-12); only a value that is
  // not a GitHub URL at all is refused.
  github_url: { kind: 'text', prefill: 'repository-url', format: 'github-url' },
  one_line_description: {
    kind: 'text',
    prefill: 'project-description',
    missingPrefillHint: 'Not set on your LFX project — describe it in your own words.',
  },
  primary_audience: { kind: 'textarea', rows: 2 },
  voice_adjectives: { kind: 'text', placeholder: 'In your own words — statements are fine too' },
  constraints: { kind: 'textarea', rows: 2 },
  reference_brands: { kind: 'textarea', rows: 2 },
};

/**
 * Brand Kit Agent batch intake. The seven questions are DERIVED from
 * `BRAND_KIT_INTAKE_QUESTIONS` — Paul's intake wording quoted verbatim from
 * the brand-kit agent's own `src/questions.ts` (marketing-os-agents
 * `agents/brand-kit-ts`), never paraphrased and never duplicated — with the
 * form presentation layered on top. The batch preamble is the same
 * `BRAND_KIT_FORM_PREAMBLE_LINES` the BFF's `renderBrandKitFormMessage` sends,
 * so the agent's MODE RULES trigger identically for regeneration follow-ups.
 */
export const BRAND_KIT_INTAKE: MktgAgentIntake = {
  agentId: 'brand-kit',
  formTitleAction: 'Develop',
  documentName: 'Brand Kit',
  intro:
    'Seven questions, answered in your own words. Fields marked “From LFX” are pre-filled from your project — edit anything. Logos, colors, and fonts are generated for you; they are not inputs.',
  batchPreamble: [...BRAND_KIT_FORM_PREAMBLE_LINES],
  fields: BRAND_KIT_INTAKE_QUESTIONS.map((question) => ({
    key: question.key,
    question: question.question,
    ...BRAND_KIT_FIELD_PRESENTATION[question.key],
  })),
  sections: [
    'Review Sheet',
    'How to Use This Document',
    '1. Project Definition',
    '2. Positioning',
    '3. Voice & Language',
    '4. Primary Audiences',
    '5. Key Brand Strengths',
    '6. Competitive Differentiation & Guardrails',
    '7. Visual Identity — Five Components',
    '8. Tagline Options (Starter Set)',
    'Appendix A: Document Architecture',
    'Appendix B: Source Intake',
    'Appendix C: LFX Project Record & Research Sweep',
  ],
  endpoints: {
    generate: '/api/mktg-agents/brand-kit/generate',
    result: '/api/mktg-agents/brand-kit/result',
    stored: '/api/mktg-agents/brand-kit/stored',
  },
  // The result endpoint writes every validated document to the project's
  // storage partition and reports the receipt (dec-brand-kit-storage-v2), so a
  // receipt-less ready result is a failed write the run shell must retry —
  // without the server copy, this agent's own dependents stay locked for every
  // browser but the one that generated the kit.
  persistsDocument: true,
};

/**
 * Messaging Document intake (marketing-os-agents agents/foundation-message
 * 2.0.0, Paul's messaging-document 1.0.0; wi-message-foundation-existing-documents-form).
 * The form from the design canvas, in three groups:
 *
 * - Sources: the project name and Paul's four Step 0b sources. LFX One
 *   fetches each page to text for the agent, which cannot fetch; "none" is a
 *   valid answer. The project name and the GitHub repo come from LFX.
 * - Paul's ten Step 1 questions, all required on this page, with his wording
 *   quoted VERBATIM from the agent's src/questions.ts (via
 *   FOUNDATION_MESSAGE_QUESTIONS); "skip" and "TBD" are answers.
 * - Existing documents, optional and last: links and PDF, Word, Markdown or
 *   text files, turned into text by the BFF. The agent maps them first and
 *   the answers override them.
 *
 * It runs first and needs no other document, so nothing is attached. Every
 * submission is a fresh generate (`freshRunPerSubmission`): the generate form
 * carries no prior version or feedback, and each result is stored as a new
 * revision of the project's foundation-message document.
 */
export const FOUNDATION_MESSAGE_INTAKE: MktgAgentIntake = {
  agentId: 'foundation-setup',
  formTitleAction: 'Build',
  documentName: 'Messaging Document',
  intro:
    'Runs first; it needs no other document. The sources the agent reads, then Paul’s ten questions in your own words. Existing messaging or positioning documents can be attached at the end; the agent reads them first and treats your answers as the final word. Every result is stored as a new revision of the document in Documents.',
  // Never sent: the generate endpoint renders the agent's own intake form
  // server-side, and with fresh runs there is no chat follow-up to prefix.
  batchPreamble: [],
  fields: [
    { key: 'project_name', question: 'Project name', kind: 'text', prefill: 'project-name' },
    ...FOUNDATION_MESSAGE_SOURCE_KINDS.map((kind) => ({
      key: FOUNDATION_MESSAGE_SOURCE_FIELDS[kind].urlKey,
      // Paul's label, sentence-cased for the form.
      question: FOUNDATION_MESSAGE_SOURCE_LABELS[kind].charAt(0).toUpperCase() + FOUNDATION_MESSAGE_SOURCE_LABELS[kind].slice(1),
      kind: 'text' as const,
      optional: true,
      placeholder: 'https://… or none',
      format: 'source-url' as const,
      ...(kind === 'readme' ? { prefill: 'repository-url' as const } : {}),
    })),
    ...FOUNDATION_MESSAGE_QUESTIONS.map((question, index) => ({
      key: question.key,
      // "N. Label. Question" — a colon instead of the full stop when Paul's
      // wording is a description (questions 7 and 10 start lowercase).
      question: `${index + 1}. ${question.label}${/^[a-z]/.test(question.question) ? ':' : '.'} ${question.question}`,
      kind: 'textarea' as const,
      rows: FOUNDATION_MESSAGE_LONG_ANSWER_KEYS.has(question.key) ? 3 : 2,
      placeholder: 'Your answer',
    })),
  ],
  fieldGroups: [
    {
      id: 'sources',
      title: 'Sources',
      hint: '“none” is a valid answer',
      footnote:
        'LFX One fetches each page and passes the text to the agent, so the agent never asks you to restate what the sources say. Only https:// links can be fetched.',
      fieldKeys: ['project_name', ...FOUNDATION_MESSAGE_SOURCE_KINDS.map((kind) => FOUNDATION_MESSAGE_SOURCE_FIELDS[kind].urlKey)],
    },
    {
      id: 'questions',
      title: 'Paul’s ten questions',
      hint: '“skip” or “TBD” is recorded as such',
      fieldKeys: FOUNDATION_MESSAGE_QUESTIONS.map((question) => question.key),
    },
  ],
  documents: {
    title: 'Existing documents',
    hint: 'Messaging, positioning, brand, audience or competitive documents. Several allowed.',
    footnote: `Accepted: PDF, Word (.docx), Markdown and plain text, up to ${FOUNDATION_MESSAGE_MAX_FILE_BYTES / (1024 * 1024)} MB each; a Google Doc goes in as a link. Files and links are turned into text before the agent runs.`,
    maxDocuments: FOUNDATION_MESSAGE_MAX_DOCUMENTS,
    maxFileBytes: FOUNDATION_MESSAGE_MAX_FILE_BYTES,
    fileExtensions: [...FOUNDATION_MESSAGE_FILE_EXTENSIONS],
    endpoints: { ...FOUNDATION_MESSAGE_DOCUMENT_ENDPOINTS },
  },
  derivativeChips: FOUNDATION_MESSAGE_DERIVATIVE_CHIPS.map((chip) => ({ key: chip.key, label: chip.label })),
  freshRunPerSubmission: true,
  sections: FOUNDATION_MESSAGE_REQUIRED_HEADINGS.map((heading) => heading.replace(/^## /, '')),
  endpoints: {
    generate: '/api/mktg-agents/foundation-message/generate',
    result: '/api/mktg-agents/foundation-message/result',
    stored: '/api/mktg-agents/foundation-message/stored',
  },
  // The result endpoint stores every validated bundle as a revision of the
  // project's foundation-message document and reports the receipt, so a
  // receipt-less ready result is a failed write the run shell must retry.
  persistsDocument: true,
};

/**
 * ICP & Target Markets batch intake (wi-icp-lfx-selfserve). Fixed question
 * wording is quoted VERBATIM from the agent's own `src/questions.ts`
 * (marketing-os-agents `agents/icp-ts`), never paraphrased — every question
 * in Paul's ICP interview has fixed wording, so the whole form is canonical.
 *
 * Paul's Q1c (Brand Kit / Message Foundation) is NOT asked: both documents
 * are auto-attached from the project's stored output when it has them
 * (dec-agent-dependency-gating). They are OPTIONAL attachments — the agent's
 * own form contract makes both optional and Paul explicitly allows proceeding
 * on the interview answers plus the README, flagging the affected sections
 * lower-confidence — so the ICP card is deliberately NOT `dependsOn`-gated: a
 * project with no Brand Kit can still generate an ICP, and the form says
 * plainly which inputs the run actually had.
 *
 * `lfx_membership_data` (Paul's optional live-data enrichment) is not
 * collected here, not attached, and rejected by the generate endpoint: LFX
 * member records are not wired into this flow yet, so the agent takes its
 * documented no-live-data branch and template section 1.4 carries the TBD
 * wording rather than an invented roster.
 *
 * Every follow-up is a full resubmit through the generate endpoint
 * (`regenerateViaGenerate`): the BFF re-fetches the README and submits the
 * typed `icp_intake_form` payload with `feedback` + `prior_version`, so a
 * chat-text follow-up (which could carry neither) is never used.
 */
export const ICP_INTAKE: MktgAgentIntake = {
  agentId: 'icp',
  formTitleAction: 'Define',
  documentName: 'ICP & Target Markets',
  intro:
    'One form, then the agent drafts the full ICP & Target Markets document. Fields marked “From LFX” are pre-filled from your project — edit anything. Your project’s Brand Kit and Messaging Document are attached automatically when they exist.',
  // The agent's own form-mode preamble (src/form.ts renderFormMessage),
  // verbatim — the same ICP_FORM_PREAMBLE_LINES the BFF's `renderIcpFormText`
  // opens the batch submission with, so the agent's MODE RULES trigger
  // identically wherever the message is composed.
  batchPreamble: [...ICP_FORM_PREAMBLE_LINES],
  fields: [
    { key: 'project_name', question: ICP_Q_PROJECT_NAME, kind: 'text', prefill: 'project-name' },
    {
      key: 'github_url',
      question: ICP_Q_GITHUB_URL,
      kind: 'text',
      prefill: 'repository-url',
      hint: 'The README is fetched automatically from this repo and passed to the agent.',
      // Blocking, for the same reason as the Message Foundation's Q1b: Paul's
      // contract keeps the answer free text for the AGENT, but a URL that
      // provably cannot yield a README is refused by the LFX collection UI
      // rather than accepted and discovered minutes later as a thin document.
      format: 'github-repo-url',
    },
    // Paul's five Step 1d gap-fill questions, in his priority order. Only
    // 1d.1 is required — he marks it never-skip because it sets the fit and
    // warmth weighting of section 4; he allows skipping any of the rest that
    // is already answered or clearly inferable, and the agent's own form
    // contract mirrors that split.
    ...ICP_GAP_FILL_QUESTIONS.map((entry, index) => ({
      key: entry.key,
      question: entry.question,
      kind: 'textarea' as const,
      rows: 2,
      ...(index === 0 ? {} : { optional: true }),
    })),
  ],
  attachments: [
    { sourceAgentId: 'brand-kit', answerKey: 'brand_kit_markdown', documentName: 'Brand Kit', optional: true },
    { sourceAgentId: 'foundation-setup', answerKey: 'message_foundation_markdown', documentName: 'Messaging Document', optional: true },
  ],
  regenerateViaGenerate: true,
  sections: ICP_REQUIRED_HEADINGS.map((heading) => heading.replace(/^## /, '')),
  endpoints: {
    generate: '/api/mktg-agents/icp/generate',
    result: '/api/mktg-agents/icp/result',
  },
  // The result endpoint writes every validated document to the project's
  // storage partition and reports the receipt (dec-brand-kit-storage-v2
  // generalized), so a receipt-less ready result is a failed write the run
  // shell must retry. There is deliberately NO `stored` read endpoint yet:
  // nothing `dependsOn` or attaches the ICP, so no dependency resolution ever
  // asks for it. The first agent that consumes the ICP adds the BFF read
  // route and registers it here — resolution needs no other change.
  persistsDocument: true,
};

/**
 * Batch intake registry, keyed by catalog agent id. The run-page shell renders
 * whatever is registered here — a second agent's form (e.g. the Message
 * Foundation intake, wi-mf-lfx-selfserve) slots in as a new entry.
 */
export const MKTG_AGENT_INTAKES: Record<string, MktgAgentIntake> = {
  [BRAND_KIT_INTAKE.agentId]: BRAND_KIT_INTAKE,
  [FOUNDATION_MESSAGE_INTAKE.agentId]: FOUNDATION_MESSAGE_INTAKE,
  [ICP_INTAKE.agentId]: ICP_INTAKE,
};

/** Max recursion depth when scanning event payloads for envelope candidates (all Marketing OS contracts). */
export const MKTG_ENVELOPE_EXTRACTION_MAX_DEPTH = 16;

/**
 * Blocking field-error copy for an intake value that fails its `format` rule.
 * Keyed by the rule and by what the value turned out to be, so the message
 * names the ACTUAL problem instead of a generic "invalid" — an account
 * URL and a typo are different mistakes with different fixes. A rule only
 * lists the reasons its validator can raise: `github-url` accepts an account
 * URL, so it has no `owner` message.
 */
export const MKTG_INTAKE_FORMAT_ERRORS: Record<MktgIntakeFieldFormat, Partial<Record<GithubRepoUrlErrorReason, string>>> = {
  'github-repo-url': {
    // Neutral about WHAT the account is: `github.com/<owner>` is an
    // organization or a personal profile and the URL cannot say which, so
    // naming it an organization would be a guess told to the user as a fact.
    owner: 'That’s a GitHub account URL, not a repository — there’s no repository README behind it. Enter a repository URL, e.g. https://github.com/org/repo.',
    unrecognized: 'That doesn’t look like a GitHub repository URL. Enter one like https://github.com/org/repo so the agent can read the repository’s README.',
  },
  'github-url': {
    unrecognized:
      'That doesn’t look like a GitHub URL. Enter the project’s repository or organization URL, e.g. https://github.com/org/repo or https://github.com/org.',
  },
  'source-url': {
    unrecognized: 'Enter the full link, starting with https://, or “none”. LFX One can only fetch https:// pages.',
  },
};

/**
 * What the result says when the document was generated WITHOUT a README. The
 * agent tolerates a missing README by design — it marks the gaps TBD — but a
 * thinner document with no explanation reads as the agent underperforming.
 * Each reason states what actually happened so the user knows whether a
 * corrected URL and a regeneration would help.
 */
export const MKTG_README_SKIP_NOTES: Record<MktgReadmeSkipReason, string> = {
  'not-a-repo-url': 'Generated without a README — the repo URL didn’t resolve to a readable repository, so the agent had no README to work from.',
  'no-readme': 'Generated without a README — that repository has no README the agent could read.',
  'not-public':
    'Generated without a README — that repository isn’t publicly readable, so the agent couldn’t open its README. Use a public repository, or add the details by hand.',
  'fetch-failed': 'Generated without a README — GitHub couldn’t be reached for that repository, so the agent had no README to work from.',
};

/** Running-phase stage checklist labels, in order. */
export const MKTG_RUN_STAGES = ['Submitting your intake', 'Agent drafting the document', 'Validating required sections'] as const;

/**
 * The document review-status labels, as the re-pinned agents write them
 * inside `document_markdown` — on the cover and on the line above the Review
 * Sheet table (the templates' newer review labels; marketing-os-agents
 * `input-doc-mapping.md` §5): `Draft — pre-filled`, `Draft — from your
 * documents`, `Draft — from your answers` (the Brand Kit's no-document first
 * draft), the classic `Draft v1 — for review` (the Message Foundation's) and
 * `ED-reviewed — [name], [date]`. The envelope carries no status field —
 * "there is no gate; the status is information" — so the result page reads
 * the first label out of the document itself (`findMktgDocumentStatus`).
 *
 * Group 1 is the label: its opening word, the separator (em/en dash, or a
 * spaced hyphen), then the phrase up to a table cell, emphasis or code
 * delimiter, a `·` separator, or the end of the line. Case-insensitive, so
 * the template's own `DRAFT — pre-filled, awaiting ED review` variant also matches.
 */
export const MKTG_DOCUMENT_STATUS_LABEL_REGEX = /((?:Draft(?: v\d+)?|ED-reviewed)(?:\s*[—–]\s*|\s+-\s+)[^|*_`·\n]+)/i;

/**
 * What may precede a status label on its line for the match to count: only
 * Markdown decoration (heading marks, blockquote, table pipe, emphasis,
 * list dash, whitespace) — or that decoration around the word `Status`
 * itself (`Status:`, `**Status:**`, `| Status |`), with only a colon, a
 * dash, a pipe, emphasis or whitespace between the word and the label.
 * Prose is never a status line, whether it merely contains "draft —"
 * mid-sentence or mentions the word "status" somewhere before it.
 */
export const MKTG_DOCUMENT_STATUS_LEAD_REGEX = /^(?:[\s#>|*_-]*|[\s#>|*_-]*status[\s*_:|—–-]*)$/i;

/** Prefix of the reviewed label — the one status that is no longer a draft. */
export const MKTG_DOCUMENT_STATUS_REVIEWED_PREFIX = 'ED-reviewed';

/** localStorage key prefix for stored runs; full key is `<prefix>:<projectUid>:<agentId>`. */
export const MKTG_RUN_STORAGE_KEY_PREFIX = 'lfx-mktg-agent-run';

/**
 * TTL for browser-persisted runs. A stored run carries the session's
 * capability `ownerToken`, so it must not linger at rest indefinitely —
 * records older than this are pruned on load and the user simply starts a
 * fresh run. Generous enough to keep same-day/next-day restore working.
 */
export const MKTG_RUN_STORAGE_TTL_MS = 86400000;

/**
 * localStorage key prefix for the per-(user, project) intake answer memory;
 * full key is `<prefix>:<userSub>:<projectUid>`. Separate from the stored-run
 * prefix on purpose: a run record is per AGENT and carries a session
 * capability token, while this is the cross-agent answer vocabulary a project
 * has accumulated.
 */
export const MKTG_ANSWER_MEMORY_KEY_PREFIX = 'lfx-mktg-agent-answers';

/**
 * TTL for a remembered intake answer, measured from the submission that
 * recorded it. Longer than a stored run's (it holds no capability token, and
 * re-asking a user for the same repository URL a week later is exactly the
 * failure this exists to prevent) but still bounded — a year-old answer is
 * likelier to be wrong than helpful, and stale personal input should not sit
 * at rest forever.
 */
export const MKTG_ANSWER_MEMORY_TTL_MS = 2592000000;

/**
 * Longest answer worth remembering. The memory exists to carry short shared
 * identifiers (repository URL, project name) between agents, never document-
 * sized text — a cap keeps one verbose answer from consuming the origin's
 * storage quota and evicting the rest.
 */
export const MKTG_ANSWER_MEMORY_MAX_VALUE_CHARS = 2000;

/** Validated-result polling cadence while a generation is in flight. */
export const MKTG_RUN_POLL = {
  /** Delay before the first result poll after the generate/chat POST resolves. */
  initialDelayMs: 4000,
  /** Interval between subsequent polls. */
  intervalMs: 5000,
  /** Overall deadline for the agent's validated document to appear. */
  timeoutMs: 600000,
} as const;

/**
 * Result-polling cadence for the STANDALONE Brand Kit intake form. Separate
 * from {@link MKTG_RUN_POLL} because the two surfaces bound the wait
 * differently — the run shell holds a wall-clock deadline while this form
 * counts attempts — but it lives here, not as module-level state inside
 * `apps/lfx-one`, so the cadence is reviewable next to the run shell's and
 * both stay in the shared package where the repo's constants belong.
 */
export const MKTG_BRAND_KIT_FORM_POLL = {
  /** Interval between result polls. */
  intervalMs: 10000,
  /** Poll budget for one generation (~5 minutes at the interval above). */
  maxAttempts: 30,
  /** Consecutive transient poll failures tolerated before giving up. */
  maxConsecutiveErrors: 3,
} as const;

/**
 * Extra result polls spent in the background when a persisting agent's ready
 * result arrives WITHOUT its persistence receipt (dec-brand-kit-storage-v2).
 * Each poll re-runs the idempotent content-addressed server-side write, so a
 * transient storage outage still ends with the document persisted; the
 * document itself is already displayed, so this never delays the user.
 * Bounded because the condition can also be permanent (bucket intentionally
 * unconfigured, document over the size cap) and must not poll for the full
 * generation budget. ONE policy for every Brand Kit surface — the form-first
 * run shell and the standalone intake form.
 */
export const MKTG_RUN_PERSIST_RETRY_MAX_ATTEMPTS = 3;
