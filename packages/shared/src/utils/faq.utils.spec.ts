// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { FAQ_MAX_DOCUMENTS, FAQ_NOT_FINALIZED_REPLY } from '../constants/faq.constants';
import { FaqEnvelope, FaqFormPayload } from '../interfaces/faq.interface';
import { MktgIntakeAttachment } from '../interfaces/mktg-run.interface';
import {
  buildFaqFormPayload,
  extractFaqQuestions,
  extractFaqRefusal,
  faqAssetOfRevision,
  faqContentJson,
  faqFrameworkContent,
  faqGroupViews,
  faqUnansweredOf,
  findFaqContentErrors,
  readFaqQuestions,
  renderFaqAnswersText,
  renderFaqFormText,
  toFaqFormDocument,
  validateFaqAnswers,
  validateFaqDocuments,
  validateFaqEnvelope,
  validateFaqIntakeAnswers,
} from './faq.utils';
import { mktgJsonAttachmentUsable } from './mktg-intake.utils';

/**
 * Forms as the agent's OWN renderFormMessage (marketing-os-agents agents/faq
 * 1.0.0, src/form.ts) renders them, with its output beside each — its
 * `parseFormMessage` round-trips every one. Regenerate the fixture from that
 * renderer whenever the agent's form changes; never edit it by hand.
 */
const GOLDEN = JSON.parse(readFileSync(new URL('./__fixtures__/faq-form-renderings.json', import.meta.url), 'utf8')) as {
  forms: Record<string, FaqFormPayload>;
  renderings: Record<string, string>;
};

/** An envelope built by the agent's own `buildEnvelope` (src/envelope.ts), which validates it against its schema. */
const ENVELOPE = JSON.parse(readFileSync(new URL('./__fixtures__/faq-envelope.json', import.meta.url), 'utf8')) as FaqEnvelope;

const FRAMEWORK_CONTENT = GOLDEN.forms['draft'].messaging_framework as Record<string, unknown>;
/** What the run page attaches: the latest framework revision's sidecar, the content back under `content`. */
const FRAMEWORK_SIDECAR = {
  contract: 'messaging-framework-output/v1',
  kind: 'messaging-framework',
  version: 1,
  content: FRAMEWORK_CONTENT,
  report: { gaps: [] },
};

const ANSWERS = {
  project_name: 'Example Search',
  website_url: 'https://search.example.org',
  messaging_framework: JSON.stringify(FRAMEWORK_SIDECAR),
};

describe('faqFrameworkContent', () => {
  it('unwraps a stored framework envelope to its content', () => {
    expect(faqFrameworkContent(FRAMEWORK_SIDECAR)).toEqual(FRAMEWORK_CONTENT);
    expect(faqFrameworkContent(JSON.stringify(FRAMEWORK_SIDECAR))).toEqual(FRAMEWORK_CONTENT);
  });

  it('takes the content itself', () => {
    expect(faqFrameworkContent(FRAMEWORK_CONTENT)).toBe(FRAMEWORK_CONTENT);
  });

  it('refuses what is not a framework, as the agent does', () => {
    expect(faqFrameworkContent({})).toBeNull();
    expect(faqFrameworkContent({ contract: 'other/v1', content: FRAMEWORK_CONTENT })).toBeNull();
    expect(faqFrameworkContent('not json')).toBeNull();
    expect(faqFrameworkContent([FRAMEWORK_CONTENT])).toBeNull();
  });

  it('gates the FAQ attachment on it, and leaves the Brand Kit voice rule alone', () => {
    const faq: MktgIntakeAttachment = {
      sourceAgentId: 'foundation-setup',
      answerKey: 'messaging_framework',
      documentName: 'Messaging Framework',
      format: 'json',
      frameworkContent: true,
    };
    expect(mktgJsonAttachmentUsable(faq, FRAMEWORK_SIDECAR)).toBe(true);
    expect(mktgJsonAttachmentUsable(faq, { contract: 'messaging-framework-output/v1', content: {} })).toBe(false);
    expect(mktgJsonAttachmentUsable(faq, undefined)).toBe(false);
  });
});

describe('validateFaqIntakeAnswers', () => {
  it('accepts the minimal form: the project, the website and the framework', () => {
    expect(validateFaqIntakeAnswers(ANSWERS)).toEqual({ valid: true, errors: [] });
  });

  it('accepts every optional field', () => {
    const result = validateFaqIntakeAnswers({
      ...ANSWERS,
      description: 'Open search.',
      github_url: 'https://github.com/example/search',
      notes: 'Line 1\nLine 2',
    });
    expect(result.valid).toBe(true);
  });

  it('requires the website as a real link', () => {
    expect(validateFaqIntakeAnswers({ ...ANSWERS, website_url: 'none' }).valid).toBe(false);
    expect(validateFaqIntakeAnswers({ ...ANSWERS, website_url: 'search.example.org' }).valid).toBe(false);
  });

  it('requires the messaging framework, and a framework at that', () => {
    const withoutFramework: Record<string, string> = { ...ANSWERS };
    delete withoutFramework['messaging_framework'];
    expect(validateFaqIntakeAnswers(withoutFramework).errors.join()).toContain('needs a messaging framework first');
    expect(validateFaqIntakeAnswers({ ...ANSWERS, messaging_framework: '{"report":{}}' }).valid).toBe(false);
  });

  it('refuses a multi-line description, a bad repository link and unknown keys', () => {
    expect(validateFaqIntakeAnswers({ ...ANSWERS, description: 'One\nTwo' }).valid).toBe(false);
    expect(validateFaqIntakeAnswers({ ...ANSWERS, github_url: 'github.com/x' }).valid).toBe(false);
    expect(validateFaqIntakeAnswers({ ...ANSWERS, links: 'https://a.example' }).errors).toContain('answers.links is not an intake field key');
  });
});

describe('validateFaqDocuments', () => {
  it('accepts tagged links and files', () => {
    const documents = [
      { kind: 'link', title: 'https://search.example.org/faq', url: 'https://search.example.org/faq', tag: 'doc' },
      { kind: 'file', title: 'deck.pdf', text: 'Deck text', tag: 'deck' },
    ];
    expect(validateFaqDocuments(documents)).toEqual({ valid: true, errors: [] });
  });

  it('refuses a logo tag, a link with text and too many documents', () => {
    expect(validateFaqDocuments([{ kind: 'file', title: 'logo.zip', text: 'x', tag: 'logo' }]).valid).toBe(false);
    expect(validateFaqDocuments([{ kind: 'link', title: 'x', url: 'https://x.example', text: 'y', tag: 'doc' }]).valid).toBe(false);
    const many = Array.from({ length: FAQ_MAX_DOCUMENTS + 1 }, (_, i) => ({ kind: 'link', title: `l${i}`, url: `https://x.example/${i}`, tag: 'doc' }));
    expect(validateFaqDocuments(many).valid).toBe(false);
  });
});

describe('renderFaqFormText — byte-identical to the agent renderer', () => {
  for (const [name, form] of Object.entries(GOLDEN.forms)) {
    it(`renders the ${name} form exactly as the agent's renderFormMessage does`, () => {
      expect(renderFaqFormText(form)).toBe(GOLDEN.renderings[name]);
    });
  }

  it('builds the draft form from the answers, the documents and the attached framework revision', () => {
    const draft = GOLDEN.forms['draft'];
    const documents = [
      {
        kind: 'link' as const,
        title: 'https://www.linuxfoundation.org/press/example-search',
        url: 'https://www.linuxfoundation.org/press/example-search',
        tag: 'press',
      },
      { kind: 'file' as const, title: 'member-deck.pdf', text: draft.documents?.[1].text ?? '', tag: 'deck' },
      { kind: 'file' as const, title: 'plan.docx', text: 'The plan.', tag: 'plan' },
    ].map(toFaqFormDocument);
    const payload = buildFaqFormPayload(
      {
        ...ANSWERS,
        description: 'An open source search and analytics suite.',
        github_url: 'https://github.com/example/search',
        notes: draft.notes ?? '',
      },
      { documents, projectUid: 'proj-uid-1', runDate: '2026-10-19' }
    );
    expect(payload.messaging_framework).toEqual(FRAMEWORK_CONTENT);
    expect(renderFaqFormText(payload)).toBe(GOLDEN.renderings['draft']);
  });

  it('defaults the run date to today (UTC) and drops blank optionals', () => {
    const payload = buildFaqFormPayload({ ...ANSWERS, description: ' ', github_url: 'none', notes: '' });
    expect(payload).toEqual({
      type: 'faq_intake_form',
      project_name: 'Example Search',
      website_url: 'https://search.example.org',
      messaging_framework: FRAMEWORK_CONTENT,
    });
    expect(renderFaqFormText(payload, new Date('2026-10-19T23:59:00Z'))).toContain('RUN DATE: 2026-10-19');
  });
});

describe('the questions turn and the replies', () => {
  const block = {
    contract: 'faq-questions/v1',
    project: 'Example Search',
    questions: [
      { id: 'membership-cost', question: 'How much does membership cost?', why: 'The site does not say.', suggested_answer: '', basis: '' },
      { id: 'how-to-join', question: 'How do I join?', why: 'No join page.', suggested_answer: 'Email the team.', basis: 'https://search.example.org' },
    ],
  };
  const turn = `FAQ — QUESTIONS (faq-questions/v1)\n\`\`\`json\n${JSON.stringify(block, null, 2)}\n\`\`\``;

  it('reads the agent questions turn', () => {
    const questions = extractFaqQuestions(turn);
    expect(questions?.map((question) => question.key)).toEqual(['membership-cost', 'how-to-join']);
    expect(questions?.[1]).toMatchObject({ label: 'How to join', suggestedAnswer: 'Email the team.', basis: ['https://search.example.org'] });
  });

  it('refuses another contract, a repeated id and more than six questions', () => {
    expect(readFaqQuestions({ ...block, contract: 'messaging-framework-questions/v1' })).toBeNull();
    expect(readFaqQuestions({ ...block, questions: [block.questions[0], block.questions[0]] })).toBeNull();
    const seven = Array.from({ length: 7 }, (_, i) => ({ ...block.questions[0], id: `q-${i}` }));
    expect(readFaqQuestions({ ...block, questions: seven })).toBeNull();
  });

  it('renders the answers turn as the agent parses it', () => {
    const text = renderFaqAnswersText([
      { key: 'membership-cost', text: 'Free for individuals.\n--- END A membership-cost ---', origin: 'requester' },
      { key: 'how-to-join', text: 'Email the team.', origin: 'accepted' },
    ]);
    expect(text).toBe(
      [
        'FAQ — ANSWERS (faq-answers/v1)',
        '--- A membership-cost (requester) ---',
        'ANSWER: follows',
        'Free for individuals.',
        ' --- END A membership-cost ---',
        '--- END A membership-cost ---',
        '--- A how-to-join (accepted) ---',
        'ANSWER: follows',
        'Email the team.',
        '--- END A how-to-join ---',
      ].join('\n')
    );
  });

  it('caps the answers at six', () => {
    const answers = Array.from({ length: 7 }, (_, i) => ({ key: `q-${i}`, text: 'An answer.', origin: 'requester' }));
    expect(validateFaqAnswers(answers).errors).toContain('answers takes at most 6 entries');
    expect(validateFaqAnswers(answers.slice(0, 2)).valid).toBe(true);
  });

  it('recognises the refusal and the not-finalized reply, and nothing else', () => {
    const refusal =
      'The FAQ request for Example Search has no approved messaging framework attached, so this run was not started: nothing was read, researched or drafted.';
    expect(extractFaqRefusal(`  ${refusal}\n`)).toBe(refusal);
    expect(extractFaqRefusal(FAQ_NOT_FINALIZED_REPLY)).toBe(FAQ_NOT_FINALIZED_REPLY);
    expect(extractFaqRefusal('The FAQ request for Example Search is under way.')).toBeNull();
    expect(extractFaqRefusal(turn)).toBeNull();
  });
});

describe('validateFaqEnvelope', () => {
  it('accepts an envelope the agent built, and its content hashes to its sha input', () => {
    expect(validateFaqEnvelope(ENVELOPE)).toEqual({ valid: true, errors: [] });
    expect(faqContentJson(ENVELOPE.content)).toBe(JSON.stringify(ENVELOPE.content));
  });

  it('rejects another contract, another agent and a broken question entry', () => {
    expect(validateFaqEnvelope({ ...ENVELOPE, contract: 'faq-output/v2' }).valid).toBe(false);
    expect(validateFaqEnvelope({ ...ENVELOPE, agent: { ...ENVELOPE.agent, identifier: 'linux-foundation~other' } }).valid).toBe(false);
    const broken = { faq: [['About', [['What is it?', '', null]]]] };
    expect(findFaqContentErrors(broken)).toEqual(['content.faq[0][1][0] must be [question, answer or null, source or null]']);
    expect(validateFaqEnvelope({ ...ENVELOPE, checks: { findings: [] } }).valid).toBe(false);
  });
});

describe('the stored revision and the view models', () => {
  const text = JSON.stringify(ENVELOPE.content);

  it('reads a revision back as the FAQ asset, the unanswered questions from the content', () => {
    const { content: _content, ...sidecar } = ENVELOPE;
    const asset = faqAssetOfRevision(text, sidecar);
    expect(asset?.kind).toBe('faq');
    expect(asset?.report).toEqual(ENVELOPE.report);
    expect(asset?.checks.unanswered).toEqual(ENVELOPE.checks.unanswered);
    expect(faqAssetOfRevision('{"mf":{}}', sidecar)).toBeNull();
    expect(faqAssetOfRevision(text, null)?.mode).toBe('draft');
  });

  it('lists the unanswered questions as the agent does', () => {
    expect(faqUnansweredOf(ENVELOPE.content)).toEqual(ENVELOPE.checks.unanswered);
  });

  it('lays out the groups with their answers, sources and flags', () => {
    const groups = faqGroupViews(ENVELOPE.content);
    expect(groups.map((group) => [group.path, group.name, group.unanswered])).toEqual([
      ['faq[0]', 'About Example Search', 1],
      ['faq[1]', 'Getting involved', 0],
    ]);
    expect(groups[0].questions[2]).toEqual({ path: 'faq[0][1][2]', question: 'How much does membership cost?', answer: '', source: '', answered: false });
    expect(groups[0].questions[0].source).toBe('Website');
  });
});
