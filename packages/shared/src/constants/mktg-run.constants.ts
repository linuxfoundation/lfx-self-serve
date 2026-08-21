// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MktgAgentIntake, MktgIntakeField, MktgIntakeFieldGuidance, MktgReadmeSkipReason } from '../interfaces';
import { BRAND_KIT_FORM_PREAMBLE_LINES, BRAND_KIT_INTAKE_QUESTIONS } from './brand-kit.constants';
import {
  FOUNDATION_MESSAGE_DERIVATIVE_CHIPS,
  FOUNDATION_MESSAGE_FORM_PREAMBLE_LINES,
  FOUNDATION_MESSAGE_Q_GITHUB_URL,
  FOUNDATION_MESSAGE_Q_PROJECT_NAME,
  FOUNDATION_MESSAGE_REQUIRED_HEADINGS,
} from './foundation-message.constants';

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
  github_url: { kind: 'text', prefill: 'repository-url' },
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
    'How to Use This Document',
    '1. Project Definition',
    '2. Positioning',
    '3. Brand Personality & Voice',
    '4. Primary Audiences & Messaging',
    '5. Key Brand Strengths',
    '6. Competitive Differentiation & Guardrails',
    '7. Visual Identity — Five Components',
    '8. Tagline Options (Starter Set)',
    '9. Channel Quick Reference',
    'Appendix A: Document Architecture',
    'Appendix B: Source Intake',
  ],
  endpoints: {
    generate: '/api/mktg-agents/brand-kit/generate',
    result: '/api/mktg-agents/brand-kit/result',
  },
  // The result endpoint writes every validated document to the project's
  // storage partition and reports the receipt (dec-brand-kit-storage-v2), so a
  // receipt-less ready result is a failed write the run shell must retry —
  // without the server copy, this agent's own dependents stay locked for every
  // browser but the one that generated the kit.
  persistsDocument: true,
};

/**
 * Message Foundation batch intake (wi-mf-lfx-selfserve). Fixed question
 * wording is quoted VERBATIM from the agent's own `src/questions.ts`
 * (marketing-os-agents `agents/foundation-message-ts`), never paraphrased.
 * The agent consumes the Brand Kit as a dependency
 * (dec-agent-dependency-gating): the form never asks for it — the project's
 * stored Brand Kit document (server-persisted preferred, browser-stored run
 * fallback) is auto-attached as `brand_kit_markdown` at submit time, which
 * satisfies the agent's conditional contract (discovery answers are required
 * exactly when no Brand Kit is provided, so they are never collected here).
 * Every follow-up is a full resubmit through the generate endpoint
 * (`regenerateViaGenerate`): the BFF re-fetches the README and submits the
 * typed `message_foundation_intake_form` payload with `feedback` +
 * `prior_version`, so a chat-text follow-up (which could carry neither) is
 * never used.
 */
export const FOUNDATION_MESSAGE_INTAKE: MktgAgentIntake = {
  agentId: 'foundation-setup',
  formTitleAction: 'Build',
  documentName: 'Message Foundation',
  intro: 'One form, then the agent drafts the full document. Fields marked “From LFX” are pre-filled from your project — edit anything.',
  // The agent's own form-mode preamble (src/form.ts renderFormMessage),
  // verbatim — the same FOUNDATION_MESSAGE_FORM_PREAMBLE_LINES the BFF's
  // `renderFoundationMessageFormText` opens the batch submission with, so
  // the agent's MODE RULES trigger identically wherever the message is
  // composed.
  batchPreamble: [...FOUNDATION_MESSAGE_FORM_PREAMBLE_LINES],
  fields: [
    { key: 'project_name', question: FOUNDATION_MESSAGE_Q_PROJECT_NAME, kind: 'text', prefill: 'project-name' },
    {
      key: 'github_url',
      question: FOUNDATION_MESSAGE_Q_GITHUB_URL,
      kind: 'text',
      prefill: 'repository-url',
      hint: 'The README is fetched automatically from this repo and passed to the agent.',
      // Non-blocking: the agent tolerates a missing README (Paul's contract
      // keeps this field free text), but the user must SEE that an
      // organization URL or a typo will cost them the README before they
      // spend a generation on it.
      guidance: 'github-repo-url',
    },
    // Paul's Step 1d gap areas, offered as one optional free-text field — the
    // placeholder names his five areas so form mode never has to ask.
    {
      key: 'gap_fill_notes',
      question: 'Anything else the messaging should build on? (optional)',
      kind: 'textarea',
      rows: 3,
      optional: true,
      placeholder:
        'Proof points to cite (adopters, benchmarks) · audiences beyond technical personas + outreach goals · who this is positioned against (“unlike ___”) · a specific membership tier or CTA · an upcoming milestone or event to anchor to',
    },
  ],
  attachments: [{ sourceAgentId: 'brand-kit', answerKey: 'brand_kit_markdown', documentName: 'Brand Kit' }],
  derivativeChips: [...FOUNDATION_MESSAGE_DERIVATIVE_CHIPS],
  regenerateViaGenerate: true,
  sections: FOUNDATION_MESSAGE_REQUIRED_HEADINGS.map((heading) => heading.replace(/^## /, '')),
  endpoints: {
    generate: '/api/mktg-agents/foundation-message/generate',
    result: '/api/mktg-agents/foundation-message/result',
  },
};

/**
 * Batch intake registry, keyed by catalog agent id. The run-page shell renders
 * whatever is registered here — a second agent's form (e.g. the Message
 * Foundation intake, wi-mf-lfx-selfserve) slots in as a new entry.
 */
export const MKTG_AGENT_INTAKES: Record<string, MktgAgentIntake> = {
  [BRAND_KIT_INTAKE.agentId]: BRAND_KIT_INTAKE,
  [FOUNDATION_MESSAGE_INTAKE.agentId]: FOUNDATION_MESSAGE_INTAKE,
};

/** Max recursion depth when scanning event payloads for envelope candidates (all Marketing OS contracts). */
export const MKTG_ENVELOPE_EXTRACTION_MAX_DEPTH = 16;

/**
 * Inline, non-blocking guidance shown under an intake field whose typed value
 * will not do what the field promises. Keyed by the field's `guidance` check
 * and by what the value turned out to be, so the wording names the ACTUAL
 * problem instead of a generic "invalid" — an organization URL and a typo are
 * different mistakes with different fixes.
 */
export const MKTG_INTAKE_GUIDANCE_NOTES: Record<MktgIntakeFieldGuidance, Record<'organization' | 'unrecognized', string>> = {
  'github-repo-url': {
    organization:
      'That’s an organization URL — it has no repository README to read. Enter a repository URL, e.g. https://github.com/org/repo. (We’ll try the organization’s profile README as a fallback, but most organizations don’t have one.)',
    unrecognized: 'That doesn’t look like a GitHub repository URL. Enter one like https://github.com/org/repo so the agent can read the repository’s README.',
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
  'fetch-failed': 'Generated without a README — GitHub couldn’t be reached for that repository, so the agent had no README to work from.',
};

/** Running-phase stage checklist labels, in order. */
export const MKTG_RUN_STAGES = ['Submitting your intake', 'Agent drafting the document', 'Validating required sections'] as const;

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
 * generation budget. ONE policy for every Brand Kit surface — the form-first
 * run shell and the standalone intake form.
 */
export const MKTG_RUN_PERSIST_RETRY_MAX_ATTEMPTS = 3;
