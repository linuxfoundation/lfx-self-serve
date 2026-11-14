// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import {
  LINKEDIN_MAX_QUESTIONS,
  LINKEDIN_PROFILE_GAP_LABELS,
  LINKEDIN_QUESTIONS_HEADER,
  LINKEDIN_QUESTIONS_CONTRACT,
} from '../constants/linkedin-post.constants';
import type { LinkedinForm, LinkedinSetup, LinkedinQuestionItem } from '../interfaces/linkedin-post.interface';
import { isLinkedinProfile } from './linkedin-post-envelope.utils';
import {
  linkedinProfileGapIds,
  linkedinProfileFromSetup,
  parseLinkedinContentSource,
  renderLinkedinProfileMarkdown,
  renderLinkedinProfileGaps,
  singleLine,
} from './linkedin-post.utils';
import { parseLinkedinQuestions, renderLinkedinAnswers, validLinkedinAnswers } from './linkedin-post-run.utils';

const setup: LinkedinSetup = { name: 'Example author', role: 'Maintainer', focus_areas: 'Open source', primary_audience: 'Developers' };
describe('LinkedIn profile and bounded gaps', () => {
  it.each(['text', 'url', 'file', 'invalid', 'https://source.example/private', undefined])('allow-lists public source navigation: %s', (value) => {
    expect(parseLinkedinContentSource(value)).toBe(value === 'url' || value === 'file' ? value : 'text');
  });
  it('normalizes 100k tabs in bounded time without changing single-line output', () => {
    const tabs = '\t'.repeat(100000);
    const started = performance.now();
    expect(singleLine(`before${tabs}after`)).toBe(`before${tabs}after`);
    expect(singleLine(` before${tabs}\r\n${tabs}after `)).toBe('before after');
    expect(singleLine('a\u0085\u0085b')).toBe('a  b');
    expect(performance.now() - started).toBeLessThan(1000);
  });
  it('applies the exact voice defaults and None for skipped projects', () => {
    const profile = linkedinProfileFromSetup(setup);
    expect(profile.about.associated_projects).toBe('None');
    expect(profile.voice.tendency).toBe('direct and data-driven, with occasional humor');
    expect(renderLinkedinProfileMarkdown(profile)).toContain('- Admired style: natural language, written as a conversation from person to person\n');
  });
  it('normalizes whitespace-only optional projects to a valid None', () => {
    const profile = linkedinProfileFromSetup({ ...setup, associated_projects: ' \r\n  ' });
    expect(profile.about.associated_projects).toBe('None');
    expect(isLinkedinProfile(profile)).toBe(true);
  });
  it('asks skipped first-run voice gaps but nothing for a complete saved profile', () => {
    const form: LinkedinForm = { today: '2026-10-19', setup, content_source: 'text', content_text: 'Synthetic release' };
    expect(linkedinProfileGapIds(form)).toEqual(['tone', 'tendency', 'admired-style', 'avoid']);
    expect(linkedinProfileGapIds({ ...form, setup: undefined, saved_profile: linkedinProfileFromSetup(setup) })).toEqual([]);
  });
  it('round-trips six prioritized gaps when all seven eligible fields are unknown or skipped', () => {
    const form: LinkedinForm = {
      today: '2026-10-19',
      setup: { ...setup, role: 'unknown', focus_areas: 'unknown', primary_audience: 'unknown' },
      content_source: 'text',
      content_text: 'Synthetic release',
    };
    const ids = linkedinProfileGapIds(form);
    expect(ids).toEqual(['role', 'focus-areas', 'primary-audience', 'tone', 'tendency', 'admired-style']);
    expect(ids).toHaveLength(LINKEDIN_MAX_QUESTIONS);
    const metadata = renderLinkedinProfileGaps(form);
    expect(metadata.startsWith('PROFILE GAPS: ')).toBe(true);
    expect(JSON.parse(JSON.parse(metadata.slice('PROFILE GAPS: '.length)))).toEqual(ids);
    const questions = Object.keys(LINKEDIN_PROFILE_GAP_LABELS).map(
      (id): LinkedinQuestionItem => ({
        id,
        question: `What is your preferred ${id}?`,
        why: 'Personalize the post.',
        suggested_answer: 'Keep the default.',
        basis: 'The provisional voice setting.',
      })
    );
    const render = (items: LinkedinQuestionItem[]) =>
      `${LINKEDIN_QUESTIONS_HEADER}\n\`\`\`json\n${JSON.stringify({ contract: LINKEDIN_QUESTIONS_CONTRACT, project: 'Synthetic project', questions: items })}\n\`\`\``;
    expect(parseLinkedinQuestions(render(questions.slice(0, LINKEDIN_MAX_QUESTIONS)))?.questions.map((question) => question.id)).toEqual(ids);
    const answers = ids.map((key) => ({ key, text: 'Keep the default.', origin: 'accepted' as const }));
    expect(validLinkedinAnswers(answers)).toBe(true);
    expect(renderLinkedinAnswers(answers)).toContain('Keep the default.');
    expect(parseLinkedinQuestions(render(questions))).toBeNull();
    expect(validLinkedinAnswers([...answers, { key: 'avoid', text: 'Keep the default.', origin: 'accepted' }])).toBe(false);
  });
});
