// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { mktgSignOffChecks } from './mktg-sign-off-checks.utils';

function framework() {
  return {
    mf: {
      tagline: 'Build useful tools',
      vision: 'Open tools',
      mission: 'Work together',
      positioning: 'Useful community software',
      avoid: [['world class', 'useful']],
      goals: [{ id: 'adoption', icps: ['builders'], vp: 'Useful tools', key: 'Work together', bite: 'Build tools together' }],
    },
    mh: { line: 'Build useful tools' },
    icp: [{ id: 'builders', goals: ['adoption'] }],
  };
}
function status(checks: ReturnType<typeof mktgSignOffChecks>, id: string) {
  return checks.find((check) => check.id === id)?.status;
}

describe('mktgSignOffChecks', () => {
  it('returns the five checks in board order and never mutates stored JSON', () => {
    const asset = framework();
    const before = JSON.stringify(asset);
    const checks = mktgSignOffChecks('foundation-message', asset, null);
    expect(checks.map((row) => row.id)).toEqual(['tagline', 'audiences', 'avoid', 'words', 'faq']);
    expect(checks.map((row) => row.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'n/a']);
    expect(checks.every((row) => row.label && row.detail)).toBe(true);
    expect(JSON.stringify(asset)).toBe(before);
  });

  it('requires a verbatim tagline match rather than a case-folded or trimmed near match', () => {
    const asset = framework();
    asset.mh.line = 'Build useful tools ';
    expect(status(mktgSignOffChecks('foundation-message', asset, null), 'tagline')).toBe('fail');
  });

  it('checks the kit voice line against the approved framework and marks absent taglines n/a', () => {
    const asset = { chapters: { voice: { line: 'Build useful tools' } } };
    expect(status(mktgSignOffChecks('brand-kit', asset, framework()), 'tagline')).toBe('pass');
    expect(status(mktgSignOffChecks('brand-kit', asset, null), 'tagline')).toBe('n/a');
    expect(status(mktgSignOffChecks('brand-kit', {}, framework()), 'tagline')).toBe('n/a');
    expect(status(mktgSignOffChecks('boilerplates', { bp: [] }, framework()), 'tagline')).toBe('n/a');
  });

  it('requires both a goal audience list and a reverse audience-to-goal reference', () => {
    const asset = framework();
    asset.mf.goals[0].icps = [];
    expect(status(mktgSignOffChecks('foundation-message', asset, null), 'audiences')).toBe('fail');
    asset.mf.goals[0].icps = ['builders'];
    asset.icp[0].goals = [];
    expect(status(mktgSignOffChecks('foundation-message', asset, null), 'audiences')).toBe('fail');
  });

  it('scans framework prose, not its avoid definitions or the approved predecessor', () => {
    const asset = framework();
    expect(status(mktgSignOffChecks('foundation-message', asset, { mf: { avoid: [['useful']] } }), 'avoid')).toBe('pass');
    asset.mf.vision = 'WORLD CLASS tools for contributors';
    expect(status(mktgSignOffChecks('foundation-message', asset, null), 'avoid')).toBe('fail');
  });

  it('escapes regex metacharacters and uses case-insensitive Unicode word boundaries', () => {
    const approved = { mf: { avoid: [['AI'], ['C++']] } };
    expect(status(mktgSignOffChecks('boilerplates', { bp: [{ t: 'préAIpost and C toolkit', max: 20 }] }, approved), 'avoid')).toBe('pass');
    expect(status(mktgSignOffChecks('boilerplates', { bp: [{ t: 'An ai-driven C++ toolkit', max: 20 }] }, approved), 'avoid')).toBe('fail');
  });

  it('scans each prose field independently and ignores sidecar source/input provenance', () => {
    const asset = { faq: [['Overview', [['What is world?', 'A useful class of tools.', 'world class source']]]] };
    const sidecar = { inputs_record: { notes: 'world class' }, report: { sources_read: ['world class'] } };
    expect(status(mktgSignOffChecks('faq', asset, framework(), sidecar), 'avoid')).toBe('pass');
  });

  it('uses kit chapter prose without scanning SVG artwork, font/source URLs or token labels', () => {
    const asset = {
      kit: { font: 'world class' },
      chapters: {
        logo: { files: { primary: { svg: 'world class' } } },
        type: { source: 'https://world-class.example', summary: 'Clear typography' },
        voice: { line: 'Build useful tools', source: 'world class' },
      },
    };
    expect(status(mktgSignOffChecks('brand-kit', asset, framework()), 'avoid')).toBe('pass');
    asset.chapters.type.summary = 'World class typography';
    expect(status(mktgSignOffChecks('brand-kit', asset, framework()), 'avoid')).toBe('fail');
  });

  it('distinguishes an unavailable list/prose from a confirmed empty avoid-list', () => {
    const asset = { bp: [{ t: 'Useful tools', max: 10 }] };
    expect(status(mktgSignOffChecks('boilerplates', asset, null), 'avoid')).toBe('n/a');
    expect(status(mktgSignOffChecks('boilerplates', asset, { mf: { avoid: [] } }), 'avoid')).toBe('pass');
    expect(status(mktgSignOffChecks('boilerplates', {}, framework()), 'avoid')).toBe('n/a');
  });

  it('recomputes every boilerplate word count including the exact upper bound', () => {
    const asset = {
      bp: [
        { t: 'One two\nthree', max: 3 },
        { t: 'One two', max: 1 },
      ],
    };
    expect(status(mktgSignOffChecks('boilerplates', asset, framework(), { checks: { word_counts: [1, 1] } }), 'words')).toBe('fail');
    asset.bp[1].max = 2;
    expect(status(mktgSignOffChecks('boilerplates', asset, framework()), 'words')).toBe('pass');
  });

  it.each(['two words', 'one two three four five six seven eight nine ten eleven'])('fails a framework bite outside 3–10 words: %s', (bite) => {
    const asset = framework();
    asset.mf.goals[0].bite = bite;
    expect(status(mktgSignOffChecks('foundation-message', asset, null), 'words')).toBe('fail');
  });

  it('recomputes unanswered FAQ from actual null answers even with stale clean sidecar checks', () => {
    const asset = {
      faq: [
        [
          'Overview',
          [
            ['What is it?', 'Open tools.', 'Synthetic source'],
            ['Who maintains it?', null, null],
          ],
        ],
      ],
    };
    const checks = mktgSignOffChecks('faq', asset, framework(), { checks: { unanswered: [], findings: [] } });
    expect(status(checks, 'faq')).toBe('fail');
    expect(status(checks, 'agent')).toBe('pass');
    asset.faq = [['Overview', [['What is it?', 'Open tools.', 'Synthetic source']]]];
    expect(status(mktgSignOffChecks('faq', asset, framework()), 'faq')).toBe('pass');
  });

  it('reports empty/malformed applicable assets as missing checks, not successful empty loops', () => {
    expect(status(mktgSignOffChecks('foundation-message', {}, null), 'audiences')).toBe('fail');
    expect(status(mktgSignOffChecks('boilerplates', { bp: [] }, framework()), 'words')).toBe('fail');
    expect(status(mktgSignOffChecks('faq', { faq: [] }, framework()), 'faq')).toBe('fail');
  });

  it('adds agent findings only when stored sidecar findings are available', () => {
    expect(mktgSignOffChecks('foundation-message', framework(), null)).toHaveLength(5);
    const checks = mktgSignOffChecks('foundation-message', framework(), null, { checks: { findings: ['Review the source date.'] } });
    expect(checks[5]).toMatchObject({ id: 'agent', status: 'fail', detail: 'Review the source date.' });
  });
});
