// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_INTAKE_GUIDANCE_NOTES } from '../constants/mktg-run.constants';
import { MktgAgentIntake, MktgIntakeField } from '../interfaces';
import { parseGithubUrlTarget } from './github-url.utils';

/**
 * Renders a batch intake submission into the structured chat message a
 * Marketing OS agent's form mode expects — the agent's batch preamble, then
 * every question (verbatim) with its answer in order, then a version
 * directive whenever a prior draft exists.
 *
 * The version directive is emitted for EVERY follow-up, not only feedback
 * regenerations: an edit-inputs resubmit must also instruct the agent to
 * finalize as version N+1, because the result endpoint only accepts an
 * envelope strictly newer than the prior draft. The Q/A and feedback wording
 * mirrors the brand-kit agent's own `renderFormMessage` (marketing-os-agents
 * `agents/brand-kit-ts/src/form.ts`) so the message parses identically
 * whether composed there or here.
 */
export function renderMktgIntakeMessage(intake: MktgAgentIntake, answers: Record<string, string>, feedback?: string, priorVersion?: number): string {
  const lines: string[] = [...intake.batchPreamble, ''];

  intake.fields.forEach((field, i) => {
    lines.push(`Q${i + 1}. ${field.question}`);
    lines.push(`A${i + 1}. ${answers[field.key] ?? ''}`);
    lines.push('');
  });

  const hasFeedback = feedback !== undefined && feedback.trim() !== '';
  if (hasFeedback || priorVersion !== undefined) {
    const prior = priorVersion ?? 1;
    if (hasFeedback) {
      lines.push(`FEEDBACK on draft v${prior} — regenerate incorporating it and finalize as version ${prior + 1}:`);
      lines.push(feedback);
    } else {
      lines.push(`REVISED INTAKE — the answers above replace draft v${prior}; regenerate from the updated answers and finalize as version ${prior + 1}.`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Inline guidance for one intake field's current value — empty string when
 * there is nothing to say (no guidance configured, an empty control, or a
 * value that checks out).
 *
 * Deliberately ADVISORY: it returns copy, never a validation error. The agents
 * keep these answers free text and tolerate an unusable one (the Message
 * Foundation simply generates without a README), so blocking submission would
 * contradict the agent contract. What the user must not experience is the
 * silent version — an organization URL like `https://github.com/some-org` was
 * accepted, dropped server-side, and surfaced only as a thinner document.
 */
export function mktgIntakeFieldGuidance(field: MktgIntakeField, value: string): string {
  if (!field.guidance) {
    return '';
  }
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return '';
  }
  const notes = MKTG_INTAKE_GUIDANCE_NOTES[field.guidance];
  const target = parseGithubUrlTarget(trimmed);
  if (!target) {
    return notes.unrecognized;
  }
  if (target.kind === 'organization') {
    return notes.organization;
  }
  return '';
}
