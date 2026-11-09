// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for the v2 report's rule and conflict reading: the rules grouped
// by chapter with their bases, the words each surface prints, the conflicts
// with their sources in words, and when a report deserves a look before it is
// approved. Every fixture is synthetic.

import { describe, expect, it } from 'vitest';

import type { BrandKitReport } from '../interfaces/brand-kit.interface';
import type { MktgAssetReport } from '../interfaces/mktg-asset.interface';
import { brandKitReportV2RulesFixture } from './__fixtures__/brand-kit-report-v2-rules.fixture';
import { boilerplatesReportV2Envelope, faqReportV2Envelope, frameworkReportV2Fixture } from './__fixtures__/mktg-report-v2.fixture';
import {
  brandKitApproveFindings,
  brandKitChapterBasisLabel,
  brandKitChapterRuleBases,
  brandKitColorConflictViews,
  brandKitLfReferenceRuleLines,
  brandKitReportColorConflicts,
  brandKitReportRules,
  mktgReportHasOpenGaps,
  mktgReportNeedsApprovalReview,
  mktgReportGapMirrorsReason,
  mktgReportUnmirroredGaps,
} from './brand-kit-rules.utils';

// A v1 kit report: the v1 fields and none of the v2 ones (typed as the kit's so the cases below may spread kit fields over it).
const V1_REPORT: BrandKitReport = { sources_read: ['https://one.example.org'], sources_failed: [], gaps: [], notes: '' };

describe('brandKitChapterRuleBases', () => {
  it('gives nothing for a v1 report, which has no rules', () => {
    expect(brandKitChapterRuleBases(undefined)).toEqual([]);
    expect(brandKitChapterRuleBases(brandKitReportRules(V1_REPORT))).toEqual([]);
  });

  it('groups the agent fixture’s 56 rules by chapter, in the kit’s order, with the project and LF-reference counts', () => {
    expect(brandKitChapterRuleBases(brandKitReportV2RulesFixture().rules)).toEqual([
      { id: 'logo', title: 'Logo', total: 21, project: 1, lfReference: 20 },
      { id: 'color', title: 'Color', total: 5, project: 1, lfReference: 4 },
      { id: 'type', title: 'Type', total: 11, project: 6, lfReference: 5 },
      { id: 'visual', title: 'Visual', total: 9, project: 0, lfReference: 9 },
      { id: 'usage', title: 'Usage', total: 2, project: 0, lfReference: 2 },
      { id: 'voice', title: 'Voice', total: 8, project: 7, lfReference: 1 },
    ]);
  });

  it('ignores a rule whose path names no chapter and leaves out a chapter with no rule', () => {
    const rules: BrandKitReport['rules'] = [
      { path: 'kit.colors', basis: 'project' },
      { path: 'chapters.logos.files', basis: 'project' },
      { path: 'chapters.typeface.family', basis: 'project' },
      { path: 'chapters.voice', basis: 'lf-reference' },
    ];
    expect(brandKitChapterRuleBases(rules)).toEqual([{ id: 'voice', title: 'Voice', total: 1, project: 0, lfReference: 1 }]);
  });
});

describe('brandKitChapterBasisLabel', () => {
  it.each([
    [{ id: 'voice', title: 'Voice', total: 1, project: 1, lfReference: 0 }, 'From the project'],
    [{ id: 'visual', title: 'Visual', total: 9, project: 0, lfReference: 9 }, 'LF reference default'],
    [{ id: 'logo', title: 'Logo', total: 21, project: 1, lfReference: 20 }, 'LF reference default for 20 of 21 rules'],
  ] as const)('names the basis of %o as "%s"', (chapter, label) => {
    expect(brandKitChapterBasisLabel(chapter)).toBe(label);
  });
});

describe('brandKitLfReferenceRuleLines', () => {
  it('writes one plain line per chapter the LF reference supplied rules to, never a path', () => {
    const lines = brandKitLfReferenceRuleLines(brandKitReportV2RulesFixture().rules);
    expect(lines).toEqual([
      { id: 'logo', text: 'Logo: 20 of 21 rules' },
      { id: 'color', text: 'Color: 4 of 5 rules' },
      { id: 'type', text: 'Type: 5 of 11 rules' },
      { id: 'visual', text: 'Visual: 9 of 9 rules' },
      { id: 'usage', text: 'Usage: 2 of 2 rules' },
      { id: 'voice', text: 'Voice: 1 of 8 rules' },
    ]);
    expect(lines.map((line) => line.text).join(' ')).not.toContain('chapters.');
  });

  it('counts one rule in the singular', () => {
    expect(brandKitLfReferenceRuleLines([{ path: 'chapters.voice', basis: 'lf-reference' }])).toEqual([{ id: 'voice', text: 'Voice: 1 of 1 rule' }]);
  });
});

describe('brandKitColorConflictViews', () => {
  it('marks the kept value of every conflict and names each source in words', () => {
    const report = brandKitReportV2RulesFixture();
    const black = {
      name: 'Black',
      values: [
        { hex: '#171717', source: 'site_css: https://synthetic-foundation.example/site.css' },
        { hex: '#000000', source: 'brand_page: https://synthetic-foundation.example/brand' },
      ],
      chosen: '#000000',
    };
    report.color_conflicts = [...(report.color_conflicts ?? []), black];
    expect(brandKitColorConflictViews(report)).toEqual([
      {
        name: 'Coral',
        chosen: '#FF702D',
        values: [
          { hex: '#FF702D', source: 'From the brand page — synthetic-foundation.example', kept: true },
          { hex: '#FF7D2D', source: 'From the site’s CSS — synthetic-foundation.example', kept: false },
        ],
      },
      {
        name: 'Black',
        chosen: '#000000',
        values: [
          { hex: '#171717', source: 'From the site’s CSS — synthetic-foundation.example', kept: false },
          { hex: '#000000', source: 'From the brand page — synthetic-foundation.example', kept: true },
        ],
      },
    ]);
  });

  it('gives nothing for a v1 report or another agent’s', () => {
    expect(brandKitColorConflictViews(V1_REPORT)).toEqual([]);
    expect(brandKitReportColorConflicts(null)).toEqual([]);
    const withoutConflicts: BrandKitReport = { ...V1_REPORT, color_conflicts: undefined };
    expect(brandKitColorConflictViews(withoutConflicts)).toEqual([]);
  });
});

describe('brandKitApproveFindings', () => {
  it('lists the fixture’s failed sources with their plain reason and detail, and its missing assets by label with their fix', () => {
    const findings = brandKitApproveFindings(brandKitReportV2RulesFixture());
    expect(findings.failed).toEqual([
      {
        title: 'https://synthetic-foundation.example/brand-guidelines',
        text: 'This page does not exist on the site (the server answered 404).',
        detail: 'HTTP 404',
      },
      {
        title: 'Logo package (ZIP) — cdn.synthetic-foundation.example',
        text: 'The logo package on synthetic-foundation.example/brand is a ZIP file, which the agent can’t download from a link. Upload the stacked, reversed, symbol and primary files as SVG in the form, or a ZIP of the SVG files under 150 KB; a larger ZIP may not send.',
        detail: 'linked ZIP, not readable from a link',
      },
    ]);
    expect(findings.missing.map((item) => item.title)).toEqual(['Primary logo', 'Stacked logo', 'Symbol', 'Reversed logo']);
    expect(findings.missing[0]).toEqual({
      title: 'Primary logo',
      text: 'The site’s header links a logo image (synthetic-logo-838x203.svg) that was not read in this run, so the kit shows placeholder marks.',
      fix: 'Upload the primary file as SVG in the form, or a ZIP of the SVG files under 150 KB; the full package linked on synthetic-foundation.example/brand is likely too large to send.',
    });
  });

  it('leaves the detail and the fix null when the agent gives none', () => {
    const report: BrandKitReport = {
      ...V1_REPORT,
      findings: {
        sources_failed: [{ source: 'https://synthetic-foundation.example/fonts', kind: 'site_css', reason: 'The stylesheet could not be read.' }],
        missing_assets: [{ asset: 'font_weights', reason: 'No weights were found.' }],
        warnings: [],
      },
    };
    expect(brandKitApproveFindings(report)).toEqual({
      failed: [{ title: 'https://synthetic-foundation.example/fonts', text: 'The stylesheet could not be read.', detail: null }],
      missing: [{ title: 'Font weights', text: 'No weights were found.', fix: null }],
    });
  });

  it('gives nothing for a v1 report, no report, or another agent’s', () => {
    expect(brandKitApproveFindings(V1_REPORT)).toEqual({ failed: [], missing: [] });
    expect(brandKitApproveFindings(null)).toEqual({ failed: [], missing: [] });
  });

  it('lists another agent’s real v2 findings the same way: the framework’s failed source, the boilerplates’ open question titled from the family map, an unknown id as written', () => {
    const framework = frameworkReportV2Fixture();
    expect(brandKitApproveFindings(framework)).toEqual({
      failed: [{ title: 'https://aaif.io/press', text: 'This page does not exist on the site (the server answered 404).', detail: 'HTTP 404' }],
      missing: [],
    });
    const boilerplates = boilerplatesReportV2Envelope().report;
    expect(brandKitApproveFindings(boilerplates)).toEqual({
      failed: [],
      missing: [
        {
          title: 'Open question',
          text: 'The question "Should the 100-word boilerplate name individual member companies?" was not answered, so the boilerplates were written without it.',
          fix: 'Answer it on a redraft, or add the fact to the request notes.',
        },
      ],
    });
    const unknown: MktgAssetReport = {
      ...framework,
      findings: { sources_failed: [], missing_assets: [{ asset: 'something_new', reason: 'Not found.' }], warnings: [] },
    };
    expect(brandKitApproveFindings(unknown).missing).toEqual([{ title: 'something_new', text: 'Not found.', fix: null }]);
  });
});

describe('mktgReportUnmirroredGaps', () => {
  const FINDINGS = { sources_failed: [], warnings: [] };

  it('lists the gaps no missing asset mirrors, as written: mirrored by equality or by substring, kept when unmirrored', () => {
    const report: MktgAssetReport = {
      ...V1_REPORT,
      gaps: ['How much does membership cost?', 'Not answered: Should the boilerplate name member companies?', 'Whether to name the Gold members.'],
      findings: {
        ...FINDINGS,
        missing_assets: [
          { asset: 'unanswered_question', reason: 'How much does membership cost?' },
          { asset: 'unanswered_question', reason: ' Should the boilerplate name member companies? ' },
        ],
      },
    };
    expect(mktgReportUnmirroredGaps(report)).toEqual(['Whether to name the Gold members.']);
  });

  it('gives the real envelopes their lines: the boilerplates’ one gap no question stands for (its wrapped question is mirrored), nothing for the FAQ (its gap is its question) or the framework (no gap)', () => {
    expect(mktgReportUnmirroredGaps(boilerplatesReportV2Envelope().report)).toEqual(['Whether to name the Gold and Silver members: the framework names none.']);
    expect(mktgReportUnmirroredGaps(faqReportV2Envelope().report)).toEqual([]);
    expect(mktgReportUnmirroredGaps(frameworkReportV2Fixture())).toEqual([]);
  });

  describe('mktgReportGapMirrorsReason', () => {
    it('matches the agents’ current wording: the boilerplates’ "Not answered: …" gap against its straight-quoted reason, the framework’s bare question against its curly-quoted reason, the FAQ’s equal pair', () => {
      expect(
        mktgReportGapMirrorsReason(
          'Not answered: Should the 100-word boilerplate name individual member companies?',
          'The question "Should the 100-word boilerplate name individual member companies?" was not answered, so the boilerplates were written without it.'
        )
      ).toBe(true);
      expect(
        mktgReportGapMirrorsReason(
          'How many member organizations does the foundation have today?',
          'The question “How many member organizations does the foundation have today?” was left unanswered, so the framework fills that gap with a placeholder or an inference.'
        )
      ).toBe(true);
      expect(mktgReportGapMirrorsReason('How do I propose a new project to AAIF?', 'How do I propose a new project to AAIF?')).toBe(true);
    });

    it('reduces a reason to its quoted question only in the agents’ wrapper shape: a quoted word in a bare question hides no other gap, and a nested quote survives', () => {
      const bareWithQuotedWord = 'Should the boilerplate say "members" or "participants"?';
      expect(mktgReportGapMirrorsReason('Whether to name the Gold and Silver members: the framework names none.', bareWithQuotedWord)).toBe(false);
      expect(mktgReportGapMirrorsReason('Not answered: Should the boilerplate say "members" or "participants"?', bareWithQuotedWord)).toBe(true);
      expect(
        mktgReportGapMirrorsReason(
          'What does “open” mean here?',
          'The question “What does “open” mean here?” was left unanswered, so the framework fills that gap with a placeholder.'
        )
      ).toBe(true);
      expect(
        mktgReportGapMirrorsReason(
          'Whether to name the Gold and Silver members: the framework names none.',
          'The section "Pricing" asks "How much is it?" and no page answers it.'
        )
      ).toBe(false);
    });

    it('folds whitespace and case, matches containment either way, and keeps an unrelated gap', () => {
      expect(mktgReportGapMirrorsReason('not answered:  how  much does membership cost?', 'How much does MEMBERSHIP cost?')).toBe(true);
      expect(mktgReportGapMirrorsReason('How much does membership cost?', 'Not answered: how much does membership cost? (no page states it)')).toBe(true);
      expect(
        mktgReportGapMirrorsReason(
          'Whether to name the Gold and Silver members: the framework names none.',
          'The question "Should the boilerplate name member companies?" was not answered.'
        )
      ).toBe(false);
      expect(mktgReportGapMirrorsReason('', 'How much does membership cost?')).toBe(false);
    });
  });

  it('gives nothing for a v1 report or no report, and reads a Brand Kit’s report like any agent’s (the dialog, not the util, leaves the kit out)', () => {
    expect(mktgReportUnmirroredGaps({ ...V1_REPORT, gaps: ['Missing evidence'] })).toEqual([]);
    expect(mktgReportUnmirroredGaps(null)).toEqual([]);
    const kit: BrandKitReport = { ...brandKitReportV2RulesFixture(), gaps: ['A kit gap no asset mirrors.'] };
    expect(mktgReportUnmirroredGaps(kit)).toEqual(['A kit gap no asset mirrors.']);
  });
});

describe('mktgReportHasOpenGaps', () => {
  const EMPTY_FINDINGS = { sources_failed: [], missing_assets: [], warnings: [] };
  const cases: [string, BrandKitReport | null, boolean][] = [
    ['no report', null, false],
    ['a clean v1 report', V1_REPORT, false],
    ['a v1 failed source', { ...V1_REPORT, sources_failed: [{ name: 'Docs', reason: '404' }] }, true],
    ['a v1 open gap', { ...V1_REPORT, gaps: ['Missing evidence'] }, true],
    // The findings are what the dialog lists; the legacy fields need not mirror them.
    ['findings with a failed source and nothing in the legacy fields', { ...V1_REPORT, findings: brandKitReportV2RulesFixture().findings }, true],
    [
      'findings with only a missing asset',
      { ...V1_REPORT, findings: { ...EMPTY_FINDINGS, missing_assets: [{ asset: 'logo_symbol', reason: 'No symbol was uploaded.' }] } },
      true,
    ],
    ['empty findings and a gap', { ...V1_REPORT, findings: EMPTY_FINDINGS, gaps: ['Missing evidence'] }, true],
    ['empty findings, no gap, a conflict', { ...V1_REPORT, findings: EMPTY_FINDINGS, color_conflicts: brandKitReportV2RulesFixture().color_conflicts }, false],
    // Both v2 groups empty: the legacy failed source the dialog's list falls back to counts.
    ['empty findings, no gap, a legacy failed source', { ...V1_REPORT, findings: EMPTY_FINDINGS, sources_failed: [{ name: 'Docs', reason: '404' }] }, true],
  ];
  it.each(cases)('with %s: %s', (_case, report, expected) => {
    expect(mktgReportHasOpenGaps(report)).toBe(expected);
  });

  it('counts another agent’s real v2 findings too: the framework’s failed source and the FAQ’s open question with nothing in the legacy fields; the FAQ’s warnings alone do not', () => {
    const framework: MktgAssetReport = { ...frameworkReportV2Fixture(), sources_failed: [], gaps: [] };
    expect(mktgReportHasOpenGaps(framework)).toBe(true);
    expect(mktgReportNeedsApprovalReview(framework)).toBe(true);
    const faq: MktgAssetReport = { ...faqReportV2Envelope().report, sources_failed: [], gaps: [] };
    expect(mktgReportHasOpenGaps(faq)).toBe(true);
    const warningsOnly: MktgAssetReport = { ...faq, findings: { ...EMPTY_FINDINGS, warnings: faq.findings?.warnings ?? [] } };
    expect(warningsOnly.findings?.warnings).toHaveLength(2);
    expect(mktgReportHasOpenGaps(warningsOnly)).toBe(false);
    expect(mktgReportNeedsApprovalReview(warningsOnly)).toBe(false);
  });
});

describe('mktgReportNeedsApprovalReview', () => {
  const cases: [string, BrandKitReport | null, boolean][] = [
    ['no report', null, false],
    ['a clean v1 report', V1_REPORT, false],
    ['a failed source', { ...V1_REPORT, sources_failed: [{ name: 'Docs', reason: '404' }] }, true],
    ['an open gap', { ...V1_REPORT, gaps: ['Missing evidence'] }, true],
    ['a colour conflict only', { ...V1_REPORT, color_conflicts: brandKitReportV2RulesFixture().color_conflicts, rules: [] }, true],
    ['an LF-reference rule only', { ...V1_REPORT, color_conflicts: [], rules: [{ path: 'chapters.voice', basis: 'lf-reference' }] }, true],
    ['project rules only', { ...V1_REPORT, color_conflicts: [], rules: [{ path: 'chapters.voice', basis: 'project' }] }, false],
    ['findings only, legacy fields empty', { ...V1_REPORT, findings: brandKitReportV2RulesFixture().findings }, true],
    [
      'empty findings, a legacy failed source only',
      { ...V1_REPORT, findings: { sources_failed: [], missing_assets: [], warnings: [] }, sources_failed: [{ name: 'Docs', reason: '404' }] },
      true,
    ],
  ];
  it.each(cases)('with %s: %s', (_case, report, expected) => {
    expect(mktgReportNeedsApprovalReview(report)).toBe(expected);
  });
});
