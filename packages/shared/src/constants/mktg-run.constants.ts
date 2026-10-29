// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { GithubRepoUrlErrorReason, MktgAgentIntake, MktgIntakeFieldFormat } from '../interfaces';
import { AEO_GEO_SECTIONS } from './aeo-geo.constants';
import { BOILERPLATES_ANSWERS_ENDPOINT, BOILERPLATES_FIELD_KEYS, BOILERPLATES_FRAMEWORK_ANSWER_KEY } from './boilerplates.constants';
import {
  BRAND_KIT_ANSWERS_ENDPOINT,
  BRAND_KIT_APPROVAL_REQUIRED_MESSAGE,
  BRAND_KIT_FIELD_KEYS,
  BRAND_KIT_FRAMEWORK_ANSWER_KEY,
  BRAND_KIT_LOGO_FILE_EXTENSIONS,
  BRAND_KIT_MAX_LOGO_FILE_CHARS,
  BRAND_KIT_MAX_LOGO_FILES,
  BRAND_KIT_MAX_LOGO_PAYLOAD_CHARS,
  BRAND_KIT_REQUIRED_HEADINGS,
} from './brand-kit.constants';
import {
  FAQ_ANSWERS_ENDPOINT,
  FAQ_DEFAULT_DOCUMENT_KIND,
  FAQ_DESCRIPTION_KEY,
  FAQ_DOCUMENT_KIND_OPTIONS,
  FAQ_FRAMEWORK_ANSWER_KEY,
  FAQ_GITHUB_KEY,
  FAQ_MAX_DOCUMENTS,
  FAQ_NOTES_KEY,
  FAQ_WEBSITE_KEY,
} from './faq.constants';
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
import { LINKEDIN_SHARE_LINK_ANSWER_KEY } from './linkedin-post.constants';

/** A start must explicitly discard the current active run before replacing it. */
export const MKTG_RUN_ACTIVE = 'MKTG_RUN_ACTIVE';
/** Another writer already accepted the answers for this exact questions turn. */
export const MKTG_RUN_ANSWERED = 'MKTG_RUN_ANSWERED';
/** A discarded or superseded session cannot accept another turn. */
export const MKTG_RUN_CLOSED = 'MKTG_RUN_CLOSED';
/** The questions turn was already claimed; never send another answers message. */
export const MKTG_RUN_ANSWERED = 'MKTG_RUN_ANSWERED';
/** Separate dialog hosts may coexist when a dedicated intake is rendered inside the catalog. */
export const MKTG_RUN_ACTIVE_DIALOG_KEYS = { linkedin: 'mktg-active-linkedin', member360: 'mktg-active-member360' } as const;

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
 * The kit runs AFTER the messaging framework is approved: the project's
 * approved current is attached automatically, with its version/date and a
 * link to the Messaging Framework page. With none approved (including a
 * stored but unapproved draft), Run is blocked with
 * BRAND_KIT_APPROVAL_REQUIRED_MESSAGE and the link. An approved revision
 * whose sidecar has no usable voice instead shows `incompleteNote`.
 * The attachment comes from the server sidecar read, never a browser-stored
 * run; its JSON supplies the Voice chapter. The generation endpoint still
 * validates the JSON the browser sends, without re-checking approval.
 * The agent itself refuses a run without a framework up front; that reply,
 * should it ever come, is shown as the run's outcome.
 *
 * The result is a JSON kit, not a Markdown document: the document route renders
 * it with the kit's web view (an app page, one tab per chapter), which prints
 * the reference kit's 16-page book with Download PDF. Every submission is a fresh generate
 * (`freshRunPerSubmission`); each result is stored as a new revision of the
 * project's Brand Kit document, whose Markdown rendering is what sibling
 * agents attach.
 */
export const BRAND_KIT_INTAKE: MktgAgentIntake = {
  agentId: 'brand-kit',
  formTitleAction: 'Build',
  documentName: 'Brand Kit',
  intro:
    'Upload the logo files and give the agent the website: it inspects the artwork, reads the site’s CSS and the brand page, sources every colour, and comes back with questions only for what is still open — each with a suggested answer to accept or edit. Your project’s approved Messaging Framework is attached automatically; the Voice chapter comes from it. The kit opens here as a page, one tab per chapter, and downloads as a 16-page PDF. Every result is stored as a new revision in Documents.',
  // Never sent: the generate endpoint renders the agent's own intake form
  // server-side, and with fresh runs there is no chat follow-up to prefix.
  batchPreamble: [],
  fields: [
    { key: BRAND_KIT_FIELD_KEYS.projectName, question: 'Project name', kind: 'text', prefill: 'project-name' },
    {
      key: BRAND_KIT_FIELD_KEYS.websiteUrl,
      question: 'Website',
      kind: 'text',
      prefill: 'website-url',
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
  // The messaging framework, required: the project's approved current,
  // submitted as its JSON under the agent's own form key. Not
  // in the catalog's `dependsOn` on purpose — the marketplace card stays
  // open and the intake page itself says what is needed, with the link to
  // the Messaging Framework page.
  attachments: [
    {
      sourceAgentId: 'foundation-setup',
      answerKey: BRAND_KIT_FRAMEWORK_ANSWER_KEY,
      documentName: 'Messaging Framework',
      format: 'json',
      missingNote: BRAND_KIT_APPROVAL_REQUIRED_MESSAGE,
      incompleteNote: 'The messaging framework has no positioning or tagline yet — finish it first.',
    },
  ],
  freshRunPerSubmission: true,
  liveActivity: true,
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
 * Boilerplates intake (marketing-os-agents agents/boilerplates 1.0.0,
 * boilerplates-output/v1; wi-boilerplates-intake-and-run). A short form: the
 * project name from LFX, the website from LFX (its host is the domain the
 * 100-word version ends on: "Learn more at <domain>."; left empty, the agent
 * takes the LFX record's website or asks) and notes. The LFX project uid
 * is the writer-resolved run scope, also used for the agent's LFX lookups. The
 * agent reads the website, the launch press release and the LFX record
 * itself, then asks only the gaps it could not settle — the domain, the main
 * programs, the member names it may use — each with a suggested answer
 * (`endpoints.answers`), on the same run.
 *
 * The boilerplates carry the messaging framework's positioning and proof,
 * so they run AFTER it: approved current is attached automatically as JSON,
 * with its version/date on the chip. No approval means the Run button stays
 * gated with approval guidance. An unreadable framework (including a legacy
 * Markdown revision without structured content) gets `incompleteNote`. The agent itself refuses a run without a framework up front; that
 * reply, should it ever come, is shown as the run's outcome.
 *
 * The output is not a document but the boilerplates' JSON, so the run lands
 * on the Boilerplates view (`assetView`): the feed and the questions on their
 * own while the run is live, then the four lengths with their word counts.
 * Every submission is a fresh draft (`freshRunPerSubmission`): comments per
 * length (a redraft) and a check of a hand edit are later work. Each result is
 * stored as a new revision of the project's Boilerplates document, as the
 * JSON content with the report in the sidecar.
 */
export const BOILERPLATES_INTAKE: MktgAgentIntake = {
  agentId: 'boilerplates',
  formTitleAction: 'Write',
  documentName: 'Boilerplates',
  intro:
    'The agent writes the one-liner and the 25, 50 and 100-word boilerplates from your project’s Messaging Framework, which is attached automatically. It reads the website, the launch press release and the LFX record itself and asks you only for what is still missing, with a suggested answer each time. Every result is saved as a new revision in Documents.',
  // Never sent: the generate endpoint renders the agent's own intake form
  // server-side, and with fresh runs there is no chat follow-up to prefix.
  batchPreamble: [],
  fields: [
    {
      key: BOILERPLATES_FIELD_KEYS.projectName,
      question: 'Project name',
      kind: 'text',
      prefill: 'project-name',
      oneLine: true,
      hint: 'Every boilerplate names the project in full, as written here.',
    },
    {
      key: BOILERPLATES_FIELD_KEYS.websiteUrl,
      question: 'Website',
      kind: 'text',
      optional: true,
      prefill: 'website-url',
      placeholder: 'https://…',
      hint: 'The agent reads it, and its domain ends the 100-word boilerplate (“Learn more at …”).',
      missingPrefillHint: 'Not set on your LFX project — add the website, or the agent asks you for the domain.',
      format: 'source-url',
    },
    {
      key: BOILERPLATES_FIELD_KEYS.notes,
      question: 'Notes',
      kind: 'textarea',
      rows: 3,
      optional: true,
      placeholder: 'An audience to address, a fact to lead with, words to avoid',
    },
  ],
  fieldGroups: [
    {
      id: 'project',
      title: 'The project',
      hint: 'the agent reads its sources itself',
      fieldKeys: [BOILERPLATES_FIELD_KEYS.projectName, BOILERPLATES_FIELD_KEYS.websiteUrl, BOILERPLATES_FIELD_KEYS.notes],
    },
  ],
  // The required approved-current messaging framework, submitted as JSON
  // under the agent's own form key. Draft/browser copies never stand in.
  attachments: [
    {
      sourceAgentId: 'foundation-setup',
      answerKey: BOILERPLATES_FRAMEWORK_ANSWER_KEY,
      documentName: 'Messaging Framework',
      format: 'json',
      frameworkContent: true,
      incompleteNote: 'The approved messaging framework could not be read — generate and approve a new revision in Documents first.',
    },
  ],
  requiredNote: '* required — everything else is optional',
  freshRunPerSubmission: true,
  liveActivity: true,
  fullWidth: true,
  assetView: 'boilerplates',
  // The asset view shows the boilerplates themselves; there is no section checklist to tick.
  sections: [],
  endpoints: {
    generate: '/api/mktg-agents/boilerplates/generate',
    result: '/api/mktg-agents/boilerplates/result',
    answers: BOILERPLATES_ANSWERS_ENDPOINT,
  },
  // The result endpoint stores every validated result as a revision of the
  // project's Boilerplates document and reports the receipt, so a
  // receipt-less ready result is a failed write the run shell must retry.
  // No `stored` read endpoint yet: nothing attaches the boilerplates.
  persistsDocument: true,
};

/**
 * FAQ intake (marketing-os-agents agents/faq 1.0.0, faq-output/v1;
 * wi-faq-intake-and-run), built like the Messaging Framework's:
 *
 * - Project: the name and the one-line description, both from LFX.
 * - Sources: the website (the one required field) and the GitHub
 *   repository or README, both prefilled from LFX when the project has them.
 *   The repository reaches the agent as the first of its `links`.
 * - Other links and documents: links and uploads in one section (an
 *   existing FAQ page, the members page, the docs, a press release, a deck,
 *   the plan), each tagged press, deck, document or plan. An upload is read
 *   to text by the BFF; a link goes as its URL and the agent reads it.
 * - Notes, last: who asks what, words to avoid — data, not instructions.
 *
 * The approved messaging framework is attached automatically: the project's
 * LATEST stored framework revision, as on the Brand Kit page (LFX One has no
 * Approve action yet, so the latest stands in for the approved one; Approve
 * is a later item). The agent refuses a run without one, so a project with no
 * framework revision cannot run: the page says to run the messaging framework
 * first and links to it, and the chip names the revision it uses.
 *
 * After reading and researching, the agent asks only the questions the
 * sources leave open (at most six, each with a suggested answer), one at a
 * time on their own page, and the answers go back to the same session. The
 * output is the FAQ's JSON, not a document, so the run lands on the FAQ view
 * (`assetView`), where the questions the sources did not answer are flagged
 * for the team. Every submission is a fresh draft (`freshRunPerSubmission`:
 * a redraft from comments and a check of a hand-edited version are later
 * work), stored as a new revision of the project's FAQ document.
 */
export const FAQ_INTAKE: MktgAgentIntake = {
  agentId: 'faq',
  formTitleAction: 'Build',
  documentName: 'FAQ',
  intro:
    'Give the agent its sources. It reads them, searches the web and LFX for the rest, and asks you only for what is still missing, with a suggested answer each time. Your latest messaging framework is attached automatically: the questions and their wording come from it. Only the website is required. You get an FAQ of eight to ten questions in groups, each answer naming its source, saved as a new revision in Documents.',
  // Never sent: the generate endpoint renders the agent's own intake form
  // server-side, and with fresh runs there is no chat follow-up to prefix.
  batchPreamble: [],
  fields: [
    { key: 'project_name', question: 'Project name', kind: 'text', prefill: 'project-name', oneLine: true },
    {
      key: FAQ_DESCRIPTION_KEY,
      question: 'One-line description',
      kind: 'text',
      optional: true,
      oneLine: true,
      prefill: 'project-description',
      placeholder: 'What the project does, in one line',
      missingPrefillHint: 'Not set on your LFX project — describe it in one line, or leave it to the sources.',
    },
    {
      key: FAQ_WEBSITE_KEY,
      question: 'Website',
      kind: 'text',
      prefill: 'website-url',
      placeholder: 'https://aaif.io',
      hint: 'The project’s public site. The agent starts here and follows what it finds.',
      format: 'source-url',
    },
    {
      key: FAQ_GITHUB_KEY,
      question: 'GitHub repository or README',
      kind: 'text',
      optional: true,
      prefill: 'repository-url',
      placeholder: 'https://github.com/…',
      hint: 'The project’s repository or its README: how to contribute, the licence, who maintains it. Leave it empty and the agent looks for it itself.',
      format: 'source-url',
    },
    {
      key: FAQ_NOTES_KEY,
      question: 'Anything the agent should know',
      kind: 'textarea',
      rows: 3,
      optional: true,
      placeholder: 'Who asks what, the questions people already ask, words to avoid',
      hint: 'Read as information about the project, never as instructions.',
    },
  ],
  fieldGroups: [
    { id: 'project', title: 'Project', fieldKeys: ['project_name', FAQ_DESCRIPTION_KEY] },
    {
      id: 'sources',
      title: 'Sources',
      hint: 'the website is required; the rest is optional',
      footnote:
        'The agent reads every link itself and researches the rest on its own, so it never asks you to restate what the sources say. An existing FAQ page, the members page and the docs are worth adding below.',
      fieldKeys: [FAQ_WEBSITE_KEY, FAQ_GITHUB_KEY],
    },
    { id: 'notes', title: 'Notes', hint: 'optional', fieldKeys: [FAQ_NOTES_KEY], afterDocuments: true },
  ],
  documents: {
    title: 'Other links and documents',
    hint: 'An existing FAQ, the members page, the docs, a press release, a deck, the marketing plan. Add a link or upload a file, then tag it.',
    footnote: `Accepted: PDF, Word (.docx), PowerPoint (.pptx), Markdown and plain text, up to ${FOUNDATION_MESSAGE_MAX_FILE_BYTES / (1024 * 1024)} MB each — read here and sent as text. A link is sent as is; the agent reads it. Up to ${FAQ_MAX_DOCUMENTS} links and documents.`,
    maxDocuments: FAQ_MAX_DOCUMENTS,
    maxFileBytes: FOUNDATION_MESSAGE_MAX_FILE_BYTES,
    fileExtensions: [...FOUNDATION_MESSAGE_FILE_EXTENSIONS],
    // The same reader as the Messaging Framework's: turning an upload into text is the same for every agent.
    endpoints: { ...FOUNDATION_MESSAGE_DOCUMENT_ENDPOINTS },
    tags: FAQ_DOCUMENT_KIND_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
    defaultTag: FAQ_DEFAULT_DOCUMENT_KIND,
  },
  // The approved messaging framework, required: the LATEST stored revision
  // of the project's messaging framework, submitted under the agent's own
  // form key and unwrapped to its content by the BFF. Usable only when it
  // carries the framework itself (`mf` or `mh`), the agent's own rule.
  attachments: [
    {
      sourceAgentId: 'foundation-setup',
      answerKey: FAQ_FRAMEWORK_ANSWER_KEY,
      documentName: 'Messaging Framework',
      format: 'json',
      frameworkContent: true,
      incompleteNote: 'The latest messaging framework revision carries no framework the FAQ can read — run the messaging framework again.',
    },
  ],
  requiredNote: '* required — everything else is optional',
  freshRunPerSubmission: true,
  liveActivity: true,
  fullWidth: true,
  assetView: 'faq',
  // The FAQ view shows the questions themselves; there is no section checklist to tick.
  sections: [],
  endpoints: {
    generate: '/api/mktg-agents/faq/generate',
    result: '/api/mktg-agents/faq/result',
    answers: FAQ_ANSWERS_ENDPOINT,
  },
  // The result endpoint stores every validated FAQ as a revision of the
  // project's FAQ document and reports the receipt, so a receipt-less ready
  // result is a failed write the run shell must retry.
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

/** Dedicated per-user profile and source intake; no project dependencies or feedback round. */
export const LINKEDIN_POST_INTAKE: MktgAgentIntake = {
  agentId: 'linkedin-post',
  liveActivity: true,
  oneOffDocument: true,
  tracksDocumentRun: true,
  lastIntakeFields: ['content_source', 'content_text', 'content_url', LINKEDIN_SHARE_LINK_ANSWER_KEY],
  formTitleAction: 'Draft',
  documentName: 'LinkedIn post',
  intro: 'Three post options in your voice, from pasted text, a link or a file.',
  batchPreamble: [],
  fields: [],
  sections: [],
  endpoints: {
    generate: '/api/mktg-agents/linkedin-post/generate',
    result: '/api/mktg-agents/linkedin-post/result',
    answers: '/api/mktg-agents/linkedin-post/answers',
  },
  persistsDocument: true,
};

/** Domain-only audit; key pages are optional but must number 2–5 when supplied. */
export const AEO_GEO_INTAKE: MktgAgentIntake = {
  agentId: 'aeo-geo',
  formTitleAction: 'Run',
  documentName: 'AEO/GEO report',
  intro:
    'Scores how a website shows up in AI search and answer engines, with prioritised recommendations. One input: the site. Each audit is its own report; to update it, audit again.',
  batchPreamble: [],
  fields: [
    { key: 'domain', question: 'The website to audit', kind: 'text' },
    { key: 'key_pages', question: 'Key pages', kind: 'textarea', optional: true },
  ],
  sections: AEO_GEO_SECTIONS.map((heading) => heading.replace(/^## /, '')),
  endpoints: { generate: '/api/mktg-agents/aeo-geo/generate', result: '/api/mktg-agents/aeo-geo/result', answers: '/api/mktg-agents/aeo-geo/answers' },
  persistsDocument: true,
  oneOffDocument: true,
  liveActivity: true,
};

/** A last runtime error must settle before it is considered terminal. */
export const MKTG_RUN_ERROR_SETTLE_MS = 30_000;
/** Legacy exported timing retained for compatibility; passive events never prove recovery. */
export const MKTG_RUN_ERROR_TEARDOWN_MS = 5_000;

/** Safe failure copy: raw provider errors can contain private URLs or credentials. */
export const MKTG_RUN_FAILURE_REASON = 'The agent stopped before it could finish this run. Your inputs are kept — retry with a new run.';

/** Batch intake registry keyed by catalog agent id; dedicated surfaces declare oneOffDocument. */
export const MKTG_AGENT_INTAKES: Record<string, MktgAgentIntake> = {
  [BRAND_KIT_INTAKE.agentId]: BRAND_KIT_INTAKE,
  [FOUNDATION_MESSAGE_INTAKE.agentId]: FOUNDATION_MESSAGE_INTAKE,
  [BOILERPLATES_INTAKE.agentId]: BOILERPLATES_INTAKE,
  [ICP_INTAKE.agentId]: ICP_INTAKE,
  [FAQ_INTAKE.agentId]: FAQ_INTAKE,
  [LINKEDIN_POST_INTAKE.agentId]: LINKEDIN_POST_INTAKE,
  'member-360': {
    agentId: 'member-360',
    tracksDocumentRun: true,
    formTitleAction: 'Run',
    documentName: 'Member 360',
    intro: 'Scores member engagement for the active, entitlement-checked project.',
    batchPreamble: [],
    fields: [],
    sections: ['Member Ranking', 'Actions by Team', 'Evidence', 'Method'],
    endpoints: { generate: '/api/mktg-agents/member-360/generate', result: '/api/mktg-agents/member-360/result' },
    persistsDocument: true,
    regenerateViaGenerate: true,
  },
  [AEO_GEO_INTAKE.agentId]: AEO_GEO_INTAKE,
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
 * Raw Guild session events that carry the runtime's output — the agent's
 * final text and its progress notices. They are what the model wrote, never
 * a transcript, so the tool-result reader never enters them: a call and its
 * result written into an output prove nothing.
 */
export const MKTG_SESSION_AGENT_OUTPUT_EVENT_TYPES = ['agent_notification_message', 'agent_notification_progress'] as const;

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

/** localStorage key prefix for stored runs; full key is `<prefix>:<projectUid>:<agentId>`. */
export const MKTG_RUN_STORAGE_KEY_PREFIX = 'lfx-mktg-agent-run';
/** User/project/document-scoped capabilities for pending one-off documents. */
export const MKTG_PENDING_DOCUMENT_STORAGE_PREFIX = 'lfx-mktg-pending-document';
/** Separately scoped intake/attempt recovery, including submissions that never received an ACK. */
export const MKTG_PENDING_RUN_STORAGE_KEY_PREFIX = 'lfx-mktg-pending-run';

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
  /** Reconcile another writer's answers while a questions screen is open. */
  questionsIntervalMs: 10000,
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

/** Internal BFF marker: a capped event page cannot prove there is nothing pending. */
export const MKTG_SESSION_EVENTS_TRUNCATED = 'mktg_session_events_truncated';
/** Content-free BFF marker: a user/trigger turn queued before runtime_start appears. */
export const MKTG_SESSION_TURN_STARTED = 'mktg_session_turn_started';
/** Model reasoning is never a reply, a questions turn, or feed activity. */
export const MKTG_SESSION_REASONING_CONTENT_TYPE = 'application/guild-reasoning-progress';
/** Stable questions-block hash: catalog's short digest or LinkedIn's full SHA-256. */
export const MKTG_RUN_QUESTIONS_ID_REGEX = /^(?:[a-f0-9]{8}|[a-f0-9]{64})$/;

/** Plain validation message shared by every answers transport. */
export const MKTG_ANSWERS_INCOMPLETE_MESSAGE = 'Every question needs an answer before the agent can continue.';

/** Only LinkedIn's stable avoid question accepts a literal none answer. */
export const MKTG_NONE_ALLOWED_QUESTION_IDS: readonly string[] = ['avoid'];
