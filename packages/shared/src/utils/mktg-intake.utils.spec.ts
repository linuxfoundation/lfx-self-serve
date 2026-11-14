// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { BRAND_KIT_INTAKE, ICP_INTAKE } from '../constants/mktg-run.constants';
import { MktgIntakeAttachment } from '../interfaces';
import { mktgJsonAttachmentUsable, renderMktgIntakeMessage } from './mktg-intake.utils';

// The ICP intake is the one with a batch preamble and a flat question list —
// the shape this renderer exists for (the Brand Kit and the Messaging
// Document render their own forms on the BFF).
const ANSWERS: Record<string, string> = {
  project_name: 'AgentX',
  github_url: 'https://github.com/agntcy/agentx',
  business_outcome: 'Membership growth',
  competitive_landscape: 'Hand-rolled orchestration.',
  disqualifiers: 'Teams without a platform function.',
  trigger_events: 'A second agent framework lands.',
  known_member_orgs: 'None named yet.',
};

describe('renderMktgIntakeMessage', () => {
  it('opens with the batch preamble followed by a blank line', () => {
    const message = renderMktgIntakeMessage(ICP_INTAKE, ANSWERS);
    expect(message.startsWith(`${ICP_INTAKE.batchPreamble.join('\n')}\n\n`)).toBe(true);
  });

  it('renders every question verbatim with its answer, in intake order', () => {
    const message = renderMktgIntakeMessage(ICP_INTAKE, ANSWERS);
    ICP_INTAKE.fields.forEach((field, i) => {
      expect(message).toContain(`Q${i + 1}. ${field.question}\nA${i + 1}. ${ANSWERS[field.key]}\n`);
    });
  });

  it('omits feedback and version directives on a first run', () => {
    const message = renderMktgIntakeMessage(ICP_INTAKE, ANSWERS);
    expect(message).not.toContain('FEEDBACK');
    expect(message).not.toContain('finalize as version');
  });

  it('appends the version directive when resubmitting without feedback (edit inputs)', () => {
    const message = renderMktgIntakeMessage(ICP_INTAKE, ANSWERS, undefined, 2);
    expect(message).toContain('REVISED INTAKE — the answers above replace draft v2; regenerate from the updated answers and finalize as version 3.');
    expect(message).not.toContain('FEEDBACK');
  });

  it('treats blank feedback as a resubmit, not a feedback block', () => {
    const message = renderMktgIntakeMessage(ICP_INTAKE, ANSWERS, '   ', 1);
    expect(message).not.toContain('FEEDBACK');
    expect(message).toContain('finalize as version 2');
  });

  it('appends the feedback block with prior_version and the next version', () => {
    const message = renderMktgIntakeMessage(ICP_INTAKE, ANSWERS, 'Tighten the taglines.', 2);
    expect(message).toContain('FEEDBACK on draft v2 — regenerate incorporating it and finalize as version 3:\nTighten the taglines.');
  });

  it('defaults prior_version to 1 when feedback is given without one', () => {
    const message = renderMktgIntakeMessage(ICP_INTAKE, ANSWERS, 'More color contrast.');
    expect(message).toContain('FEEDBACK on draft v1 — regenerate incorporating it and finalize as version 2:');
  });

  it('renders a missing answer as an empty string rather than "undefined"', () => {
    const { project_name: _omitted, ...partial } = ANSWERS;
    const message = renderMktgIntakeMessage(ICP_INTAKE, partial);
    expect(message).toContain('A1. \n');
    expect(message).not.toContain('undefined');
  });
});

describe('mktgJsonAttachmentUsable — the run page applies the BFF validator’s rule before it submits', () => {
  const framework = BRAND_KIT_INTAKE.attachments?.find((attachment) => attachment.format === 'json') as MktgIntakeAttachment;
  const tbd = { value: 'Needs input', source: 'Asked', status: 'tbd' };

  it('takes the Brand Kit’s framework only when a voice can be read from the sidecar', () => {
    expect(mktgJsonAttachmentUsable(framework, { fields: { 'md.tagline': { value: 'Open standards', source: 'Site', status: 'draft' } } })).toBe(true);
    expect(mktgJsonAttachmentUsable(framework, { mf: { positioning: 'Open standards for orbital computing' } })).toBe(true);
  });

  it('refuses a framework whose positioning and tagline are both still tbd, and one without a sidecar at all', () => {
    expect(mktgJsonAttachmentUsable(framework, { fields: { 'md.positioning': tbd, 'md.tagline': tbd } })).toBe(false);
    expect(mktgJsonAttachmentUsable(framework, undefined)).toBe(false);
  });

  it('takes any other json attachment whenever it has a sidecar', () => {
    const other: MktgIntakeAttachment = { sourceAgentId: 'brand-kit', answerKey: 'brand_kit_json', documentName: 'Brand Kit', format: 'json' };
    expect(mktgJsonAttachmentUsable(other, { anything: true })).toBe(true);
    expect(mktgJsonAttachmentUsable(other, undefined)).toBe(false);
  });
});
