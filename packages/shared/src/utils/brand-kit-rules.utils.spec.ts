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
} from './brand-kit-rules.utils';

const V1_REPORT: MktgAssetReport = { sources_read: ['https://one.example.org'], sources_failed: [], gaps: [], notes: '' };

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
