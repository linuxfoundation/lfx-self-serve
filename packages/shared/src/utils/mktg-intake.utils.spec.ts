// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { BRAND_KIT_INTAKE } from '../constants/mktg-run.constants';
import { renderMktgIntakeMessage } from './mktg-intake.utils';

const ANSWERS: Record<string, string> = {
  project_name: 'AgentX',
  github_url: 'https://github.com/agntcy/agentx',
  one_line_description: 'Multi-agent orchestration runtime.',
  primary_audience: 'AI/ML platform engineers',
  voice_adjectives: 'confident, technical, warm',
  constraints: 'Stay consistent with the LF AI look.',
  reference_brands: 'Kubernetes, Envoy',
};

describe('renderMktgIntakeMessage', () => {
  it('opens with the batch preamble followed by a blank line', () => {
    const message = renderMktgIntakeMessage(BRAND_KIT_INTAKE, ANSWERS);
    expect(message.startsWith(`${BRAND_KIT_INTAKE.batchPreamble.join('\n')}\n\n`)).toBe(true);
  });

  it('renders every question verbatim with its answer, in intake order', () => {
    const message = renderMktgIntakeMessage(BRAND_KIT_INTAKE, ANSWERS);
    BRAND_KIT_INTAKE.fields.forEach((field, i) => {
      expect(message).toContain(`Q${i + 1}. ${field.question}\nA${i + 1}. ${ANSWERS[field.key]}\n`);
    });
  });

  it('omits feedback and version directives on a first run', () => {
    const message = renderMktgIntakeMessage(BRAND_KIT_INTAKE, ANSWERS);
    expect(message).not.toContain('FEEDBACK');
    expect(message).not.toContain('finalize as version');
  });

  it('appends the version directive when resubmitting without feedback (edit inputs)', () => {
    const message = renderMktgIntakeMessage(BRAND_KIT_INTAKE, ANSWERS, undefined, 2);
    expect(message).toContain('REVISED INTAKE — the answers above replace draft v2; regenerate from the updated answers and finalize as version 3.');
    expect(message).not.toContain('FEEDBACK');
  });

  it('treats blank feedback as a resubmit, not a feedback block', () => {
    const message = renderMktgIntakeMessage(BRAND_KIT_INTAKE, ANSWERS, '   ', 1);
    expect(message).not.toContain('FEEDBACK');
    expect(message).toContain('finalize as version 2');
  });

  it('appends the feedback block with prior_version and the next version', () => {
    const message = renderMktgIntakeMessage(BRAND_KIT_INTAKE, ANSWERS, 'Tighten the taglines.', 2);
    expect(message).toContain('FEEDBACK on draft v2 — regenerate incorporating it and finalize as version 3:\nTighten the taglines.');
  });

  it('defaults prior_version to 1 when feedback is given without one', () => {
    const message = renderMktgIntakeMessage(BRAND_KIT_INTAKE, ANSWERS, 'More color contrast.');
    expect(message).toContain('FEEDBACK on draft v1 — regenerate incorporating it and finalize as version 2:');
  });

  it('renders a missing answer as an empty string rather than "undefined"', () => {
    const { project_name: _omitted, ...partial } = ANSWERS;
    const message = renderMktgIntakeMessage(BRAND_KIT_INTAKE, partial);
    expect(message).toContain('A1. \n');
    expect(message).not.toContain('undefined');
  });
});
