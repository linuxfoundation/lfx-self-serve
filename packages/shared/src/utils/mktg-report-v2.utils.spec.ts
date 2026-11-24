// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { MKTG_REPORT_ASSET_LABELS } from '../constants/mktg-asset.constants';
import type { MktgAssetReport, MktgReportFindings } from '../interfaces/mktg-asset.interface';
import { boilerplatesReportV2Envelope, faqReportV2Envelope, frameworkReportV2Fixture } from './__fixtures__/mktg-report-v2.fixture';
import { mktgReportAssetLabel, mktgReportFindingsView, mktgReportSourceHref, mktgReportV2Errors } from './mktg-report-v2.utils';

const V1_REPORT: MktgAssetReport = { sources_read: ['https://one.example.org'], sources_failed: [{ name: 'Docs', reason: '404' }], gaps: [], notes: '' };

/** One well-formed entry per group, at the contract's shape; the malformed cases below each break one field of these. */
const FINDINGS: MktgReportFindings = {
  sources_failed: [
    { source: 'https://aaif.io/press', kind: 'link', reason: 'This page does not exist on the site (the server answered 404).', detail: 'HTTP 404' },
  ],
  missing_assets: [{ asset: 'unanswered_question', reason: 'How do I propose a new project to AAIF?', fix: 'Answer it on a redraft.' }],
  warnings: [{ code: 'revision_not_reread', text: 'The previous revision was not read again on this run.' }],
};

/** The v2 errors of `V1_REPORT` with these findings; a patch may hold a malformed entry, so it is untyped. */
function errorsWith(patch: Record<string, unknown>): string[] {
  return mktgReportV2Errors({ ...V1_REPORT, findings: { ...FINDINGS, ...patch } });
}

describe('mktgReportV2Errors', () => {
  it('accepts a v1 report (no v2 field), one of each group, and the three agents’ real v2 reports', () => {
    expect(mktgReportV2Errors({ ...V1_REPORT })).toEqual([]);
    expect(errorsWith({})).toEqual([]);
    expect(mktgReportV2Errors({ ...frameworkReportV2Fixture() })).toEqual([]);
    expect(mktgReportV2Errors({ ...boilerplatesReportV2Envelope().report })).toEqual([]);
    expect(mktgReportV2Errors({ ...faqReportV2Envelope().report })).toEqual([]);
  });

  it('rejects a version other than 2 when present', () => {
    expect(mktgReportV2Errors({ ...V1_REPORT, version: 3 })).toEqual(['report.version must be 2 when present']);
  });

  it.each([
    ['not an object', 'not findings'],
    ['a list', []],
    ['an extra key', { ...FINDINGS, extra: [] }],
  ])('rejects findings that is %s with the kit’s message', (_case, value) => {
    expect(mktgReportV2Errors({ ...V1_REPORT, findings: value })).toEqual([
      'report.findings must be an object of { sources_failed, missing_assets, warnings }',
    ]);
  });

  it('names the group a findings object lacks, as the kit does', () => {
    expect(mktgReportV2Errors({ ...V1_REPORT, findings: { sources_failed: [], missing_assets: [] } })).toEqual([
      'report.findings.warnings must be a list of { code, text, source? }',
    ]);
  });

  it('rejects a malformed present entry in each group, naming the group as the kit does', () => {
    const [failed] = FINDINGS.sources_failed;
    const [missing] = FINDINGS.missing_assets;
    const [warning] = FINDINGS.warnings;
    expect(errorsWith({ sources_failed: [{ ...failed, kind: '' }] })).toEqual([
      'report.findings.sources_failed must be a list of { source, kind, reason, detail? }',
    ]);
    expect(errorsWith({ sources_failed: [{ ...failed, reason: 'https://aaif.io/press' }] })).toHaveLength(1);
    expect(errorsWith({ sources_failed: [{ ...failed, reason: ' leading space' }] })).toHaveLength(1);
    expect(errorsWith({ missing_assets: [{ ...missing, fix: 'x'.repeat(301) }] })).toEqual([
      'report.findings.missing_assets must be a list of { asset, reason, fix? }',
    ]);
    expect(errorsWith({ missing_assets: [{ ...missing, extra: 1 }] })).toHaveLength(1);
    expect(errorsWith({ warnings: [{ ...warning, text: '' }] })).toEqual(['report.findings.warnings must be a list of { code, text, source? }']);
    expect(errorsWith({ warnings: [{ ...warning, source: 7 }] })).toHaveLength(1);
  });

  it('caps each group at 50 entries', () => {
    const many = Array.from({ length: 51 }, () => FINDINGS.warnings[0]);
    expect(errorsWith({ warnings: many })).toHaveLength(1);
    expect(errorsWith({ warnings: many.slice(1) })).toEqual([]);
  });

  it('leaves kind, asset and code open unless the caller closes them', () => {
    const report = { ...V1_REPORT, findings: { ...FINDINGS, missing_assets: [{ asset: 'something_new', reason: 'A new kind of gap.' }] } };
    expect(mktgReportV2Errors(report)).toEqual([]);
    expect(mktgReportV2Errors(report, { assets: ['website'] })).toEqual(['report.findings.missing_assets must be a list of { asset, reason, fix? }']);
    expect(mktgReportV2Errors(report, { kinds: ['link'], codes: ['revision_not_reread'] })).toEqual([]);
    expect(mktgReportV2Errors(report, { kinds: ['page'] })).toHaveLength(1);
  });
});

describe('mktgReportFindingsView', () => {
  it('shows the agents’ real v2 reports in their own words: the framework’s failed source with its detail, the FAQ’s open question with its fix and its two warnings', () => {
    const framework = mktgReportFindingsView(frameworkReportV2Fixture(), MKTG_REPORT_ASSET_LABELS);
    expect(framework).toEqual({
      hasFindings: true,
      failed: [{ title: 'https://aaif.io/press', text: 'This page does not exist on the site (the server answered 404).', detail: 'HTTP 404' }],
      missing: [],
      warnings: [],
    });
    const faq = mktgReportFindingsView(faqReportV2Envelope().report, MKTG_REPORT_ASSET_LABELS);
    expect(faq.failed).toEqual([]);
    expect(faq.missing).toEqual([
      {
        title: 'Open question',
        text: 'How do I propose a new project to AAIF?',
        fix: 'Answer it in a comment on this question and redraft, or remove the question.',
      },
    ]);
    expect(faq.warnings.map((warning) => [warning.source, warning.href])).toEqual([
      [null, null],
      [null, null],
    ]);
    expect(faq.warnings.map((warning) => warning.text)).toEqual(faqReportV2Envelope().report.findings?.warnings.map((warning) => warning.text));
  });

  it('links a warning’s source only when it is an http(s) address, prints an unknown asset id as written, and leaves out an absent detail or fix', () => {
    const report: MktgAssetReport = {
      ...V1_REPORT,
      version: 2,
      findings: {
        sources_failed: [{ source: 'LFX record', kind: 'lfx_record', reason: 'The record could not be read.' }],
        missing_assets: [{ asset: 'something_new', reason: 'Not found.' }],
        warnings: [
          { code: 'truncated_read', text: 'The page was cut short.', source: 'https://aaif.io/' },
          { code: 'lfx_record_by_name', text: 'The record was found by name.', source: 'LFX record' },
        ],
      },
    };
    const view = mktgReportFindingsView(report, MKTG_REPORT_ASSET_LABELS);
    expect(view.failed).toEqual([{ title: 'LFX record', text: 'The record could not be read.', detail: null }]);
    expect(view.missing).toEqual([{ title: 'something_new', text: 'Not found.', fix: null }]);
    expect(view.warnings.map((warning) => warning.href)).toEqual(['https://aaif.io/', null]);
    expect(view.warnings[1].source).toBe('LFX record');
  });

  it('shows the framework’s LFX standard metrics refusal as any failed source: the source as title, the agent’s reason, the detail', () => {
    const lfxMetrics = {
      source: 'LFX standard metrics',
      kind: 'lfx_metrics',
      reason:
        'LFX standard metrics could not be read in this run, so no figure in the messaging framework comes from LFX; the figures shown come from the pages and documents read.',
      detail: 'scope guard refused',
    };
    const report: MktgAssetReport = { ...V1_REPORT, version: 2, findings: { sources_failed: [lfxMetrics], missing_assets: [], warnings: [] } };
    expect(mktgReportV2Errors({ ...report })).toEqual([]);
    expect(mktgReportFindingsView(report, MKTG_REPORT_ASSET_LABELS).failed).toEqual([
      { title: 'LFX standard metrics', text: lfxMetrics.reason, detail: 'scope guard refused' },
    ]);
  });

  it('gives a v1 report its legacy failed list as title and reason, nothing else, and no card to add', () => {
    expect(mktgReportFindingsView(V1_REPORT, MKTG_REPORT_ASSET_LABELS)).toEqual({
      hasFindings: false,
      failed: [{ title: 'Docs', text: '404', detail: null }],
      missing: [],
      warnings: [],
    });
    expect(mktgReportFindingsView(null, MKTG_REPORT_ASSET_LABELS)).toEqual({ hasFindings: false, failed: [], missing: [], warnings: [] });
  });
});

describe('mktgReportAssetLabel and mktgReportSourceHref', () => {
  it('names the kit’s and the family’s assets, and prints any other id as written', () => {
    expect(mktgReportAssetLabel('logo_primary', MKTG_REPORT_ASSET_LABELS)).toBe('Primary logo');
    expect(mktgReportAssetLabel('unanswered_question', MKTG_REPORT_ASSET_LABELS)).toBe('Open question');
    expect(mktgReportAssetLabel('pricing', MKTG_REPORT_ASSET_LABELS)).toBe('Membership prices');
    expect(mktgReportAssetLabel('toString', MKTG_REPORT_ASSET_LABELS)).toBe('toString');
    expect(mktgReportAssetLabel('not_a_label', {})).toBe('not_a_label');
  });

  it('links only http(s) addresses', () => {
    expect(mktgReportSourceHref('https://aaif.io/brand')).toBe('https://aaif.io/brand');
    expect(mktgReportSourceHref('HTTP://AAIF.IO')).toBe('HTTP://AAIF.IO');
    expect(mktgReportSourceHref('LFX record')).toBeNull();
    expect(mktgReportSourceHref('javascript:alert(1)')).toBeNull();
    expect(mktgReportSourceHref(null)).toBeNull();
  });
});
