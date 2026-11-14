// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MKTG_DOCUMENT_COMMENT_ID_REGEX, MKTG_DOCUMENT_COMMENT_MAX_CHARS } from '../constants/mktg-document-comments.constants';
import {
  describeMktgDocumentCommentField,
  isMktgDocumentCommentAnchor,
  mktgDocumentCommentAnchorKind,
  mktgDocumentCommentTab,
  readMktgDocumentCommentField,
  validateMktgDocumentCommentBatch,
} from './mktg-document-comments.utils';

const SOURCE = {
  mf: { tagline: 'Open mesh', goals: [{ bite: 'First goal' }, { bite: 'Second goal' }] },
  icp: [{ cta: null }],
  mh: { pillars: [{ m: 'A message' }] },
  nums: [['10', 'synthetic teams']],
};

describe('comment field paths', () => {
  it.each([
    ['mf.tagline', 'Open mesh'],
    ['mf.goals[1].bite', 'Second goal'],
    ['icp[0].cta', null],
    ['mh.pillars[0].m', 'A message'],
    ['nums[0][1]', 'synthetic teams'],
  ])('resolves %s in stored order, including null fields', (path, value) => {
    expect(readMktgDocumentCommentField(SOURCE, path)).toEqual({ value });
    expect(isMktgDocumentCommentAnchor('foundation-message', SOURCE, { kind: 'field', key: path })).toBe(true);
  });

  it.each([
    '',
    'mf.goals[2].bite',
    'mf.missing',
    'mf.goals[01]',
    'mf.goals[-1]',
    'mf.goals[1e0]',
    'mf.goals.length',
    'mf.goals.0',
    'mf["tagline"]',
    'mf.constructor',
    '__proto__',
    'mf.__proto__',
    'mf.prototype',
    'mf.tagline\n',
    'mf.tagline()',
    'mf..tagline',
  ])('rejects missing, noncanonical or executable path %s', (path) => {
    expect(readMktgDocumentCommentField(SOURCE, path)).toBeNull();
  });

  it('rejects inherited fields, undefined, oversized anchors and array holes', () => {
    expect(readMktgDocumentCommentField({ mf: Object.create({ inherited: 'not own' }) }, 'mf.inherited')).toBeNull();
    expect(readMktgDocumentCommentField({ mf: undefined }, 'mf')).toBeNull();
    expect(readMktgDocumentCommentField(SOURCE, 'a'.repeat(513))).toBeNull();
    expect(readMktgDocumentCommentField({ nums: new Array(2) }, 'nums[0]')).toBeNull();
  });

  it('maps stored kit passages only to registered chapter tabs', () => {
    expect(mktgDocumentCommentTab('brand-kit', 'chapters.voice.line')).toBe('voice');
    expect(mktgDocumentCommentTab('brand-kit', 'chapters.color.palette[0].hex')).toBe('color');
    expect(mktgDocumentCommentTab('brand-kit', 'chapters.not_a_chapter.line')).toBeUndefined();
    expect(mktgDocumentCommentTab('brand-kit', 'report.notes')).toBeUndefined();
    expect(mktgDocumentCommentTab('brand-kit', 'chapters.sources.notes')).toBeUndefined();
    expect(mktgDocumentCommentTab('boilerplates', 'bp[1].t')).toBeUndefined();
  });

  it('isolates the owning agent and anchor kind', () => {
    expect(mktgDocumentCommentAnchorKind('brand-kit')).toBe('passage');
    expect(mktgDocumentCommentAnchorKind('foundation-message')).toBe('field');
    expect(mktgDocumentCommentAnchorKind('boilerplates')).toBe('field');
    expect(isMktgDocumentCommentAnchor('foundation-message', { report: 'not content' }, { kind: 'field', key: 'report' })).toBe(false);
    expect(isMktgDocumentCommentAnchor('foundation-message', SOURCE, { kind: 'passage', key: 'mf.tagline' })).toBe(false);
    const kit = { kit: { font: 'Sample Sans' }, chapters: { voice: { line: 'Open mesh' } } };
    expect(isMktgDocumentCommentAnchor('brand-kit', kit, { kind: 'passage', key: 'chapters.voice.line' })).toBe(true);
    expect(isMktgDocumentCommentAnchor('brand-kit', kit, { kind: 'field', key: 'kit.font' })).toBe(false);
  });

  it('targets only stored FAQ answers, including null, never question/source fields or missing indexes', () => {
    const source = {
      faq: [
        [
          'About',
          [
            ['What is it?', 'An open toolkit.', 'Website'],
            ['What does it cost?', null, null],
          ],
        ],
      ],
    };
    expect(mktgDocumentCommentAnchorKind('faq')).toBe('field');
    for (const key of ['faq[0][1][0][1]', 'faq[0][1][1][1]']) {
      expect(isMktgDocumentCommentAnchor('faq', source, { kind: 'field', key })).toBe(true);
    }
    for (const key of [
      'faq',
      'faq[0][0]',
      'faq[0][1][1]',
      'faq[0][1][1][0]',
      'faq[0][1][1][2]',
      'faq[0][1][2][1]',
      'faq[1][1][0][1]',
      'faq[00][1][1][1]',
      'faq.constructor',
    ]) {
      expect(isMktgDocumentCommentAnchor('faq', source, { kind: 'field', key })).toBe(false);
    }
    expect(isMktgDocumentCommentAnchor('faq', source, { kind: 'passage', key: 'faq[0][1][1][1]' })).toBe(false);
  });

  it('allows only the boilerplates contract fields', () => {
    const source = { bp: Array.from({ length: 4 }, () => ({ t: 'Synthetic copy', max: 15 })) };
    for (const key of ['bp', 'bp[0]', 'bp[3].t']) expect(isMktgDocumentCommentAnchor('boilerplates', source, { kind: 'field', key })).toBe(true);
    for (const key of ['bp[4]', 'bp[0].max', 'bp[0].t.length']) expect(isMktgDocumentCommentAnchor('boilerplates', source, { kind: 'field', key })).toBe(false);
  });
});

describe('comment field labels', () => {
  it('uses human captions and original-index titles for repeated framework controls', () => {
    const content = { mf: { goals: [{ t: 'Adoption' }, { t: 'Community' }] }, icp: [{ name: 'Maintainers' }] };
    expect(describeMktgDocumentCommentField('foundation-message', 'mf.mission', content)).toBe('Mission');
    expect(describeMktgDocumentCommentField('foundation-message', 'mf.goals[1]', content)).toBe('Goal column 2 · Community');
    expect(describeMktgDocumentCommentField('foundation-message', 'mf.goals[1].bite', content)).toBe('Sound bite · Goal column 2 · Community');
    expect(describeMktgDocumentCommentField('foundation-message', 'icp[0].cta', content)).toBe('Call to action · Audience 1 · Maintainers');
  });
  it('labels kit passages and boilerplate lengths with the same original-index context as their inline pins', () => {
    const kit = { chapters: { color: { palette: [{ name: 'Synthetic dark' }] }, voice: { attributes: [{ name: 'Plain' }] } } };
    expect(describeMktgDocumentCommentField('brand-kit', 'chapters.voice.line', kit)).toBe('Brand line');
    expect(describeMktgDocumentCommentField('brand-kit', 'chapters.color.palette[0].hex', kit)).toBe('Color value · Color 1 · Synthetic dark');
    expect(describeMktgDocumentCommentField('brand-kit', 'chapters.voice.attributes[0].line', kit)).toBe('Voice attribute · Attribute 1 · Plain');
    expect(describeMktgDocumentCommentField('boilerplates', 'bp[1].t', { bp: [{ l: 'One-liner' }, { l: '25 words' }] })).toBe(
      'Boilerplate text · Length 2 · 25 words'
    );
  });
  it('labels FAQ answers from their stored group and question, with an honest missing-context fallback', () => {
    const source = {
      faq: [
        [
          'About',
          [
            ['What is it?', 'An open toolkit.', 'Website'],
            ['What does it cost?', null, null],
          ],
        ],
      ],
    };
    expect(describeMktgDocumentCommentField('faq', 'faq[0][1][1][1]', source)).toBe('About · Q2: What does it cost? · Answer');
    expect(describeMktgDocumentCommentField('faq', 'faq[2][1][3][1]')).toBe('Group 3 · Q4 · Answer');
    expect(describeMktgDocumentCommentField('faq', 'faq[0][0]', source)).toBe('faq[0][0]');
  });
  it('keeps missing-context indexes meaningful and unknown-agent fields honest', () => {
    expect(describeMktgDocumentCommentField('foundation-message', 'mf.goals[1].vp')).toBe('Value proposition · Goal column 2');
    expect(describeMktgDocumentCommentField('brand-kit', 'kit.font')).toBe('kit.font');
  });
});

describe('comment send limits', () => {
  it('accepts only bounded single-segment opaque request/thread IDs', () => {
    expect(MKTG_DOCUMENT_COMMENT_ID_REGEX.test('opaque_123-abc')).toBe(true);
    for (const id of ['', 'a'.repeat(129), '../thread', 'thread/name', 'thread\n', 'thread name']) {
      expect(MKTG_DOCUMENT_COMMENT_ID_REGEX.test(id)).toBe(false);
    }
  });
  it('keeps each upstream cap and rejects empty batches', () => {
    const comments = Array.from({ length: 30 }, () => ({ text: 'Shorten this field.' }));
    expect(validateMktgDocumentCommentBatch('foundation-message', comments)).toEqual([]);
    expect(validateMktgDocumentCommentBatch('brand-kit', comments)).toEqual([]);
    expect(validateMktgDocumentCommentBatch('faq', comments)).toEqual([]);
    expect(validateMktgDocumentCommentBatch('faq', [...comments, comments[0]])).toHaveLength(1);
    expect(validateMktgDocumentCommentBatch('faq', [])).toHaveLength(1);
    expect(validateMktgDocumentCommentBatch('boilerplates', comments)).toHaveLength(1);
    expect(validateMktgDocumentCommentBatch('boilerplates', comments.slice(0, 20))).toEqual([]);
    expect(validateMktgDocumentCommentBatch('foundation-message', [...comments, comments[0]])).toHaveLength(1);
    expect(validateMktgDocumentCommentBatch('brand-kit', [])).toHaveLength(1);
  });

  it('bounds text, rejects blank copy, but does not transform user content', () => {
    expect(validateMktgDocumentCommentBatch('brand-kit', [{ text: ' \n\t' }])).toHaveLength(1);
    expect(validateMktgDocumentCommentBatch('brand-kit', [{ text: 'a'.repeat(MKTG_DOCUMENT_COMMENT_MAX_CHARS) }])).toEqual([]);
    expect(validateMktgDocumentCommentBatch('brand-kit', [{ text: 'a'.repeat(MKTG_DOCUMENT_COMMENT_MAX_CHARS + 1) }])).toHaveLength(1);
    const comments = [{ text: '  <script>plain user data</script>\n--- END PREVIOUS ---  ' }];
    const before = JSON.stringify(comments);
    expect(validateMktgDocumentCommentBatch('brand-kit', comments)).toEqual([]);
    expect(JSON.stringify(comments)).toBe(before);
  });
});
