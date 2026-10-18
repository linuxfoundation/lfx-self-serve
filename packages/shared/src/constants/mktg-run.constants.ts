// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { GithubRepoUrlErrorReason, MktgAgentIntake, MktgIntakeFieldFormat, MktgReadmeSkipReason } from '../interfaces';
import {
  BRAND_KIT_ANSWERS_ENDPOINT,
  BRAND_KIT_FIELD_KEYS,
  BRAND_KIT_FRAMEWORK_ANSWER_KEY,
  BRAND_KIT_LOGO_FILE_EXTENSIONS,
  BRAND_KIT_MAX_LOGO_FILE_CHARS,
  BRAND_KIT_MAX_LOGO_FILES,
  BRAND_KIT_MAX_LOGO_PAYLOAD_CHARS,
  BRAND_KIT_REQUIRED_HEADINGS,
} from './brand-kit.constants';
import {
  FOUNDATION_MESSAGE_ANSWER_MAX_CHARS,
  FOUNDATION_MESSAGE_ANSWERS_ENDPOINT,
  FOUNDATION_MESSAGE_BRAND_PAGE_KEY,
  FOUNDATION_MESSAGE_DECK_KEY,
  FOUNDATION_MESSAGE_DEFAULT_DOCUMENT_KIND,
  FOUNDATION_MESSAGE_DESCRIPTION_KEY,
  FOUNDATION_MESSAGE_DOCUMENT_ENDPOINTS,
  FOUNDATION_MESSAGE_DOCUMENT_KIND_OPTIONS,
  FOUNDATION_MESSAGE_FILE_EXTENSIONS,
  FOUNDATION_MESSAGE_GITHUB_KEY,
  FOUNDATION_MESSAGE_MAX_DOCUMENTS,
  FOUNDATION_MESSAGE_MAX_FILE_BYTES,
  FOUNDATION_MESSAGE_MEMBERS_PAGE_KEY,
  FOUNDATION_MESSAGE_PLAN_KEY,
  FOUNDATION_MESSAGE_PRESS_RELEASE_KEY,
  FOUNDATION_MESSAGE_PROJECTS_PAGE_KEY,
  FOUNDATION_MESSAGE_WEBSITE_KEY,
} from './foundation-message.constants';
import { ICP_FORM_PREAMBLE_LINES, ICP_GAP_FILL_QUESTIONS, ICP_Q_GITHUB_URL, ICP_Q_PROJECT_NAME, ICP_REQUIRED_HEADINGS } from './icp.constants';

// Form-first run-page configuration for the Marketing OS Agents marketplace
// (LFXAI-95 workstream): per-agent batch intake registry, running-phase stage
// labels, browser persistence key, and result polling cadence.

/**
 * Brand Kit intake (marketing-os-agents agents/brand-kit 2.1.0,
 * wi-brand-kit-page). The form asks for what a kit cannot be sourced
 * without: the project (from LFX), the website the agent reads for its CSS
 * and typeface, the logo files (SVG, PNG or ZIP, read in the browser and
 * sent with the form; or a link the agent fetches), an existing brand page
 * and notes. There are no questions on this form: after inspecting the
 * artwork and reading the site, the agent asks only the gaps it could not
 * settle — the logo files when none were uploaded, the colours, the
 * typeface — each with a suggested answer, on the same run
 * (`endpoints.answers`).
 *
 * The kit runs AFTER the messaging framework (the plugin's run order:
 * messaging framework, then brand kit): the project's LATEST stored
 * messaging framework revision is attached automatically — the chip names
 * it with its version and date and links to the Messaging Framework page —
 * and its JSON always goes to the agent, whose Voice chapter comes from it.
 * The latest revision regardless of its review status (product decision,
 * 17 Oct 2026: LFX One has no Approve action yet, so an approved-only gate
 * could never open; Approve is a later item). A project with no framework
 * revision at all cannot run the agent: the Run button is disabled with
 * "Run the messaging framework first" and that link. Nor can one whose
 * latest revision carries no voice the agent can read (positioning and
 * tagline both still "tbd", or a restored revision without its sidecar):
 * the same rule the BFF validator applies, so Run is disabled with the
 * attachment's `incompleteNote` and that link instead of a 400 the user
 * could never retry out of. The attachment is required and server-only, so
 * no site-derived voice ever stands in. The agent itself (2.1.0) refuses a
 * run without a framework up front; that reply, should it ever come, is
 * shown as the run's outcome.
 *
 * The result is a JSON kit, not a Markdown document: the run page renders it
 * with the kit view (the six chapters as the reference kit's 16 pages,
 * printed with Download PDF). Every submission is a fresh generate
 * (`freshRunPerSubmission`); each result is stored as a new revision of the
 * project's Brand Kit document, whose Markdown rendering is what sibling
 * agents attach.
 */
export const BRAND_KIT_INTAKE: MktgAgentIntake = {
  agentId: 'brand-kit',
  formTitleAction: 'Build',
  documentName: 'Brand Kit',
  intro:
    'Upload the logo files and give the agent the website: it inspects the artwork, reads the site’s CSS and the brand page, sources every colour, and comes back with questions only for what is still open — each with a suggested answer to accept or edit. Your project’s latest Messaging Framework is attached automatically; the Voice chapter comes from it. The kit is laid out as a 16-page book you can print to PDF. Every result is stored as a new revision in Documents.',
  // Never sent: the generate endpoint renders the agent's own intake form
  // server-side, and with fresh runs there is no chat follow-up to prefix.
  batchPreamble: [],
  fields: [
    { key: BRAND_KIT_FIELD_KEYS.projectName, question: 'Project name', kind: 'text', prefill: 'project-name' },
    {
      key: BRAND_KIT_FIELD_KEYS.websiteUrl,
      question: 'Website',
      kind: 'text',
      placeholder: 'https://…',
      hint: 'The agent reads the home page, its CSS and the font links for the typeface and the colours.',
      format: 'https-url',
    },
    {
      key: BRAND_KIT_FIELD_KEYS.brandPageUrl,
      question: 'Brand page or guidelines',
      kind: 'text',
      optional: true,
      placeholder: 'https://… or none',
      hint: 'Published palette values and the named typeface win over what the agent infers.',
      format: 'source-url',
    },
    {
      key: BRAND_KIT_FIELD_KEYS.notes,
      question: 'Notes',
      kind: 'textarea',
      rows: 3,
      optional: true,
      placeholder: 'Audience, words to avoid, anything the agent should know',
    },
  ],
  fieldGroups: [
    {
      id: 'sources',
      title: 'The project and its site',
      hint: 'links only — the agent reads them itself',
      fieldKeys: [BRAND_KIT_FIELD_KEYS.projectName, BRAND_KIT_FIELD_KEYS.websiteUrl, BRAND_KIT_FIELD_KEYS.brandPageUrl, BRAND_KIT_FIELD_KEYS.notes],
    },
  ],
  logoFiles: {
    title: 'Logo files',
    hint: 'the horizontal lockup, the stacked lockup and the symbol',
    footnote: `SVG, PNG or ZIP, up to ${BRAND_KIT_MAX_LOGO_FILES} files — read here and sent with the form. A file too big to send, or one on the site, goes as a link (SVG only); the agent fetches it. With no file, the agent asks for them. The kit never draws or reconstructs a mark.`,
    maxFiles: BRAND_KIT_MAX_LOGO_FILES,
    maxFileChars: BRAND_KIT_MAX_LOGO_FILE_CHARS,
    maxPayloadChars: BRAND_KIT_MAX_LOGO_PAYLOAD_CHARS,
    fileExtensions: [...BRAND_KIT_LOGO_FILE_EXTENSIONS],
  },
  // The messaging framework, required: the LATEST stored revision of the
  // project's messaging framework document (approved or not — Approve is a
  // later item), submitted as its JSON under the agent's own form key. Not
  // in the catalog's `dependsOn` on purpose — the marketplace card stays
  // open and the intake page itself says what is needed, with the link to
  // the Messaging Framework page.
  attachments: [
    {
      sourceAgentId: 'foundation-setup',
      answerKey: BRAND_KIT_FRAMEWORK_ANSWER_KEY,
      documentName: 'Messaging Framework',
      format: 'json',
      incompleteNote: 'The messaging framework has no positioning or tagline yet — finish it first.',
    },
  ],
  freshRunPerSubmission: true,
  liveActivity: true,
  submitsProject: true,
  fullWidth: true,
  sections: BRAND_KIT_REQUIRED_HEADINGS.map((heading) => heading.replace(/^## /, '')),
  endpoints: {
    generate: '/api/mktg-agents/brand-kit/generate',
    result: '/api/mktg-agents/brand-kit/result',
    answers: BRAND_KIT_ANSWERS_ENDPOINT,
    stored: '/api/mktg-agents/brand-kit/stored',
  },
  // The result endpoint stores every validated kit as a revision of the
  // project's Brand Kit document and reports the receipt, so a receipt-less
  // ready result is a failed write the run shell must retry — without the
  // server copy, this agent's dependents stay locked for every browser but
  // the one that generated the kit.
  persistsDocument: true,
};

/**
 * Messaging Framework intake (marketing-os-agents agents/foundation-message
 * 4.0.0, messaging-framework-output/v1; wi-messaging-framework-intake-and-run).
 * A GUIDED form (hand test, 17 Oct: the first cut was "too unguided — I did
 * not even know myself what to put there"), in two parts:
 *
 * - Project: the name and the one-line description, both from LFX.
 * - Sources: one labelled field per source the agent reads, each with a
 *   one-line explanation and an example, in this order — the website (the
 *   one required field), the GitHub repository or README (hand test, 18 Oct:
 *   "add the GitHub"), the launch press release, the members page, the
 *   projects page, the deck (upload or link), the plan (upload or link),
 *   and the brand page. Every link field
 *   maps to the agent's contract by key (`FOUNDATION_MESSAGE_URL_DOCUMENT_FIELDS`
 *   → `documents[]` with the matching kind; the repository and the pages →
 *   `links`); the agent fetches every one itself and researches the rest
 *   (web fetch, Exa search, the LF press archive when no press release is
 *   given).
 *
 * Other links and documents come last: files uploaded here (PDF, Word, PowerPoint,
 * Markdown or text, read to text by the BFF) and document links, each tagged
 * with what it is. A file picked on the deck or plan field lands here already
 * tagged (`uploadTag`).
 *
 * There are no notes and no questions on this form (hand test, 18 Oct:
 * "remove notes"). After reading and researching, the agent asks only the
 * gaps it could not settle — audiences, the goals for the year, words to
 * avoid — each with a suggested answer (`endpoints.answers`): the run shows
 * them one at a time on the same run, every answer required, and the
 * answers go back to the same session. The questions and answers are stored
 * with the version.
 *
 * The output is not a document but the framework's JSON bundle, so the run
 * lands on the framework's own view (`assetView`): the feed and the questions
 * while the run is live, then the rendered framework. Every submission is a
 * fresh draft (`freshRunPerSubmission`): the form carries no prior version or
 * feedback (a redraft from comments and a check of a hand-edited version are
 * later work), and each result is stored as a new revision of the project's
 * foundation-message document, as the JSON content. A dependent agent that
 * takes it as a document (the ICP's `message_foundation_markdown`) gets it
 * rendered to Markdown (`renderFoundationMessageMarkdown`), never the JSON.
 */
export const FOUNDATION_MESSAGE_INTAKE: MktgAgentIntake = {
  agentId: 'foundation-setup',
  formTitleAction: 'Build',
  documentName: 'Messaging framework',
  intro:
    'Give the agent its sources. It reads them, searches the web and LFX for the rest, and asks you only for what is still missing, with a suggested answer each time. Only the website is required. You get a messaging framework: vision, mission, positioning, tagline, goals, ICPs, message house and key numbers, saved as a new revision in Documents.',
  // Never sent: the generate endpoint renders the agent's own intake form
  // server-side, and with fresh runs there is no chat follow-up to prefix.
  batchPreamble: [],
  fields: [
    { key: 'project_name', question: 'Project name', kind: 'text', prefill: 'project-name', oneLine: true },
    {
      key: FOUNDATION_MESSAGE_DESCRIPTION_KEY,
      question: 'One-line description',
      kind: 'text',
      optional: true,
      oneLine: true,
      prefill: 'project-description',
      placeholder: 'What the project does, in one line',
      missingPrefillHint: 'Not set on your LFX project — describe it in one line, or leave it to the sources.',
    },
    {
      key: FOUNDATION_MESSAGE_WEBSITE_KEY,
      question: 'Website',
      kind: 'text',
      prefill: 'website-url',
      placeholder: 'https://aaif.io',
      hint: 'The project’s public site. The agent starts here and follows what it finds.',
      format: 'source-url',
    },
    {
      key: FOUNDATION_MESSAGE_GITHUB_KEY,
      question: 'GitHub repository or README',
      kind: 'text',
      optional: true,
      prefill: 'repository-url',
      placeholder: 'https://github.com/…',
      hint: 'The project’s repository or its README. Purpose, licence, governance and adopters come from there. Leave it empty and the agent looks for it itself.',
      format: 'source-url',
    },
    {
      key: FOUNDATION_MESSAGE_PRESS_RELEASE_KEY,
      question: 'Launch press release or announcement',
      kind: 'text',
      optional: true,
      placeholder: 'https://www.linuxfoundation.org/press/…',
      hint: 'The LF or project press release that announced the project. Leave it empty and the agent searches the LF press archive itself.',
      format: 'source-url',
    },
    {
      key: FOUNDATION_MESSAGE_MEMBERS_PAGE_KEY,
      question: 'Members or partners page',
      kind: 'text',
      optional: true,
      placeholder: 'https://aaif.io/members',
      hint: 'The page that lists who backs the project — members, partners, sponsors.',
      format: 'source-url',
    },
    {
      key: FOUNDATION_MESSAGE_PROJECTS_PAGE_KEY,
      question: 'Projects or products page',
      kind: 'text',
      optional: true,
      placeholder: 'https://aaif.io/projects',
      hint: 'The page that lists what the project ships or hosts — sub-projects, products, specifications.',
      format: 'source-url',
    },
    {
      key: FOUNDATION_MESSAGE_DECK_KEY,
      question: 'Existing deck or pitch',
      kind: 'text',
      optional: true,
      placeholder: 'https://docs.google.com/presentation/d/…',
      hint: 'A board deck, a pitch, a keynote. Upload the file (PDF, PowerPoint, Word, Markdown or text) or give its link; an upload appears under Other links and documents below, tagged Deck.',
      format: 'source-url',
      uploadTag: 'deck',
    },
    {
      key: FOUNDATION_MESSAGE_PLAN_KEY,
      question: 'Marketing or strategy plan',
      kind: 'text',
      optional: true,
      placeholder: 'https://docs.google.com/document/d/…',
      hint: 'The marketing plan, the strategy for the year, the goals as written down. Upload the file or give its link; an upload appears under Other links and documents below, tagged Marketing plan.',
      format: 'source-url',
      uploadTag: 'plan',
    },
    {
      key: FOUNDATION_MESSAGE_BRAND_PAGE_KEY,
      question: 'Brand page',
      kind: 'text',
      optional: true,
      placeholder: 'https://aaif.io/brand',
      hint: 'The brand or style guidelines page, when the project has one — how it already describes itself.',
      format: 'source-url',
    },
  ],
  fieldGroups: [
    { id: 'project', title: 'Project', fieldKeys: ['project_name', FOUNDATION_MESSAGE_DESCRIPTION_KEY] },
    {
      id: 'sources',
      title: 'Sources',
      hint: 'the website is required; the rest is optional',
      footnote:
        'The agent reads every link itself and researches the rest on its own, so it never asks you to restate what the sources say. Leave a field empty when you do not have it.',
      fieldKeys: [
        FOUNDATION_MESSAGE_WEBSITE_KEY,
        FOUNDATION_MESSAGE_GITHUB_KEY,
        FOUNDATION_MESSAGE_PRESS_RELEASE_KEY,
        FOUNDATION_MESSAGE_MEMBERS_PAGE_KEY,
        FOUNDATION_MESSAGE_PROJECTS_PAGE_KEY,
        FOUNDATION_MESSAGE_DECK_KEY,
        FOUNDATION_MESSAGE_PLAN_KEY,
        FOUNDATION_MESSAGE_BRAND_PAGE_KEY,
      ],
    },
  ],
  documents: {
    title: 'Other links and documents',
    hint: 'Anything else worth reading — the docs, a blog post, a talk — and the logo package. Add a link or upload a file, then tag it.',
    footnote: `Accepted: PDF, Word (.docx), PowerPoint (.pptx), Markdown and plain text, up to ${FOUNDATION_MESSAGE_MAX_FILE_BYTES / (1024 * 1024)} MB each — read here and sent as text. A link (a Google Doc, a wiki page) is sent as is; the agent reads it. A file uploaded on the deck or plan field above lands here with its tag. A logo package is passed on for later agents and never read as a source.`,
    maxDocuments: FOUNDATION_MESSAGE_MAX_DOCUMENTS,
    maxFileBytes: FOUNDATION_MESSAGE_MAX_FILE_BYTES,
    fileExtensions: [...FOUNDATION_MESSAGE_FILE_EXTENSIONS],
    endpoints: { ...FOUNDATION_MESSAGE_DOCUMENT_ENDPOINTS },
    tags: FOUNDATION_MESSAGE_DOCUMENT_KIND_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
    defaultTag: FOUNDATION_MESSAGE_DEFAULT_DOCUMENT_KIND,
  },
  requiredNote: '* required — everything else is optional',
  freshRunPerSubmission: true,
  liveActivity: true,
  submitsProject: true,
  assetView: 'messaging-framework',
  // The asset view shows the framework itself; there is no section checklist to tick.
  sections: [],
  endpoints: {
    generate: '/api/mktg-agents/foundation-message/generate',
    result: '/api/mktg-agents/foundation-message/result',
    answers: FOUNDATION_MESSAGE_ANSWERS_ENDPOINT,
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
    'One form, then the agent drafts the full ICP & Target Markets document. Fields marked “From LFX” are pre-filled from your project — edit anything. Your project’s Brand Kit and Messaging Framework are attached automatically when they exist.',
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
      // Blocking: Paul's contract keeps the answer free text for the AGENT, but a URL that
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
    { sourceAgentId: 'foundation-setup', answerKey: 'message_foundation_markdown', documentName: 'Messaging framework', optional: true },
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
 * Raw Guild session events whose `content` is a platform tool's input or
 * output (a fetched page, a search's results, an LFX lookup) — never the
 * agent speaking, never one of its own tool results. The event readers skip
 * them whole, so nothing a third-party page carries can pass for either.
 */
export const MKTG_SESSION_PLATFORM_TOOL_EVENT_TYPES = ['runtime_start', 'runtime_done'] as const;

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
    unrecognized: 'Enter the full link, starting with https://.',
  },
  'source-url-list': {
    unrecognized: 'Every link must be a full link, starting with https://.',
  },
  'https-url': {
    unrecognized: 'Enter the full link, starting with https://.',
  },
};

/**
 * Blocking field-error copy for a single-line intake field (`kind: 'text'`)
 * whose value holds a line break (`oneLineValidator`). The input hides the
 * break, so without this the form looks valid and the BFF refuses the run
 * with a cause the user cannot see.
 */
export const MKTG_INTAKE_ONE_LINE_ERROR = 'Keep this to one line — the line breaks in it would make the run fail.';

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
 * Validation of the questions step: an answer that is not one. There is no
 * skip and no TBD there — the agent already suggested what it could settle,
 * so what is left needs the requester's answer.
 */
export const MKTG_ANSWER_NOT_SUBSTANTIVE_ERROR =
  'An answer is needed here — the agent could not settle this from the sources, and “TBD” or “skip” leaves the gap.';

/**
 * Validation of the questions step: an answer longer than the answers turn
 * takes (`FOUNDATION_MESSAGE_ANSWER_MAX_CHARS`, the BFF's own cap), said
 * before it is sent rather than refused on the way out.
 */
export const MKTG_ANSWER_TOO_LONG_ERROR = `An answer can be at most ${FOUNDATION_MESSAGE_ANSWER_MAX_CHARS.toLocaleString('en-US')} characters — shorten this one.`;

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
 * Extra result polls spent in the background when a persisting agent's ready
 * result arrives WITHOUT its persistence receipt (dec-brand-kit-storage-v2).
 * Each poll re-runs the idempotent content-addressed server-side write, so a
 * transient storage outage still ends with the document persisted; the
 * document itself is already displayed, so this never delays the user.
 * Bounded because the condition can also be permanent (bucket intentionally
 * unconfigured, document over the size cap) and must not poll for the full
 * generation budget.
 */
export const MKTG_RUN_PERSIST_RETRY_MAX_ATTEMPTS = 3;
