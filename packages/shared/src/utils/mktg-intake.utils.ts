// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MktgAgentIntake } from '../interfaces';

/**
 * Renders a batch intake submission into the structured chat message a
 * Marketing OS agent's form mode expects — the agent's batch preamble, then
 * every question (verbatim) with its answer in order, then an optional
 * feedback block for regeneration.
 *
 * The Q/A and feedback wording mirrors the brand-kit agent's own
 * `renderFormMessage` (marketing-os-agents `agents/brand-kit-ts/src/form.ts`)
 * so the message parses identically whether composed there or here.
 */
export function renderMktgIntakeMessage(intake: MktgAgentIntake, answers: Record<string, string>, feedback?: string, priorVersion?: number): string {
  const lines: string[] = [...intake.batchPreamble, ''];

  intake.fields.forEach((field, i) => {
    lines.push(`Q${i + 1}. ${field.question}`);
    lines.push(`A${i + 1}. ${answers[field.key] ?? ''}`);
    lines.push('');
  });

  if (feedback !== undefined) {
    const prior = priorVersion ?? 1;
    lines.push(`FEEDBACK on draft v${prior} — regenerate incorporating it and finalize as version ${prior + 1}:`);
    lines.push(feedback);
    lines.push('');
  }

  return lines.join('\n');
}
