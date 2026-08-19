// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MktgAgentIntake } from '../interfaces';

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
