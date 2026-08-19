// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MktgAgentIntake } from '../interfaces';

// Form-first run-page configuration for the Marketing OS Agents marketplace
// (LFXAI-95 workstream): per-agent batch intake registry, running-phase stage
// labels, browser persistence key, and history polling cadence.

/**
 * Brand Kit Agent batch intake. The seven questions are Paul's intake wording
 * QUOTED VERBATIM from the brand-kit agent's own `src/questions.ts`
 * (marketing-os-agents `agents/brand-kit-ts`) — never paraphrase them. The
 * batch preamble mirrors the agent's `renderFormMessage` form-mode wording so
 * its MODE RULES skip the conversational intake and draft directly.
 */
export const BRAND_KIT_INTAKE: MktgAgentIntake = {
  agentId: 'brand-kit',
  formTitleAction: 'Develop',
  documentName: 'Brand Kit',
  intro:
    'Seven questions, answered in your own words. Fields marked “From LFX” are pre-filled from your project — edit anything. Logos, colors, and fonts are generated for you; they are not inputs.',
  batchPreamble: [
    'BATCH INTAKE SUBMISSION (form mode — see MODE RULES in your instructions).',
    'All seven intake answers were collected on a single LFX form and are',
    'provided below, in the same order as your Step 1 questions. Do NOT ask',
    'the intake questions; proceed directly to Step 2.',
  ],
  fields: [
    {
      key: 'project_name',
      question: "What's the name of the LF project?",
      kind: 'text',
      prefill: 'project-name',
    },
    {
      key: 'github_url',
      question: "What's the URL of the project's GitHub repo or README?",
      kind: 'text',
      prefill: 'repository-url',
    },
    {
      key: 'one_line_description',
      question: 'One-line description — what does it do, beyond the name?',
      kind: 'text',
      prefill: 'project-description',
      missingPrefillHint: 'Not set on your LFX project — describe it in your own words.',
    },
    {
      key: 'primary_audience',
      question: 'Primary audience — who does this brand need to speak to? (e.g., AI/ML platform engineers, enterprise buyers, agent-framework contributors)',
      kind: 'textarea',
      rows: 2,
    },
    {
      key: 'voice_adjectives',
      question: 'Three adjectives for the voice you want?',
      kind: 'text',
      placeholder: 'In your own words — statements are fine too',
    },
    {
      key: 'constraints',
      question: 'Any constraints — colors/marks to avoid, an existing LF-family look to stay consistent with, trademark concerns?',
      kind: 'textarea',
      rows: 2,
    },
    {
      key: 'reference_brands',
      question: 'One to three reference brands or projects — ones they admire, or want to differentiate from?',
      kind: 'textarea',
      rows: 2,
    },
  ],
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
};

/**
 * Batch intake registry, keyed by catalog agent id. The run-page shell renders
 * whatever is registered here — a second agent's form (e.g. the Message
 * Foundation intake, wi-mf-lfx-selfserve) slots in as a new entry.
 */
export const MKTG_AGENT_INTAKES: Record<string, MktgAgentIntake> = {
  [BRAND_KIT_INTAKE.agentId]: BRAND_KIT_INTAKE,
};

/** Running-phase stage checklist labels, in order. */
export const MKTG_RUN_STAGES: string[] = ['Submitting your intake', 'Agent drafting the document', 'Validating required sections'];

/** localStorage key prefix for stored runs; full key is `<prefix>:<projectUid>:<agentId>`. */
export const MKTG_RUN_STORAGE_KEY_PREFIX = 'lfx-mktg-agent-run';

/** Session-history polling cadence while a generation is in flight. */
export const MKTG_RUN_POLL = {
  /** Delay before the first history poll after the chat POST resolves. */
  initialDelayMs: 4000,
  /** Interval between subsequent polls. */
  intervalMs: 5000,
  /** Overall deadline for the agent's document to appear. */
  timeoutMs: 600000,
} as const;
