// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { MKTG_REPORT_ASSET_LABELS } from '../constants/mktg-asset.constants';
import type { MktgAssetReport, MktgReportInherited } from '../interfaces/mktg-asset.interface';
import { mktgRedraftReportFixture } from './__fixtures__/mktg-report-v2.fixture';
import { brandKitApproveFindings, mktgReportHasOpenGaps, mktgReportUnmirroredGaps } from './brand-kit-rules.utils';
import { brandKitFailedSourceTitle } from './brand-kit-sources.utils';
import { describeMktgAssetReadiness } from './mktg-asset.utils';
import { mktgReportInheritedErrors } from './mktg-previous-run.utils';
import { describeMktgInheritedRow, mktgReportInheritedView } from './mktg-report-inherited.utils';

const V1_REPORT: MktgAssetReport = { sources_read: ['https://one.example.org'], sources_failed: [], gaps: [], notes: '' };
const NOTHING: MktgReportInherited = {
  from_version: 2,
  sources_read: [],
  sources_failed: [],
  findings: { sources_failed: [], missing_assets: [], warnings: [] },
};
const PRESS = {
  title: 'https://aaif.io/press',
  text: 'This page does not exist on the site (the server answered 404).',
  detail: 'HTTP 404',
  marker: 'Could not be read in version 1',
};

describe('mktgReportInheritedView', () => {
  it('lists what the agent’s real block inherited from version 1: the LFX record and metrics as read in version 1, the failed page once, as its finding', () => {
    const report = mktgRedraftReportFixture();
    expect(mktgReportInheritedErrors({ ...report })).toEqual([]);
    const view = mktgReportInheritedView(report, MKTG_REPORT_ASSET_LABELS);
    expect(view.read).toHaveLength(6);
    expect(view.read.slice(-2)).toEqual([
      { source: 'LFX record: Agentic AI Foundation (agentic-ai-foundation)', marker: 'Read in version 1' },
      { source: 'LFX standard metrics', marker: 'Read in version 1' },
    ]);
    // The legacy row (`HTTP 404`) and the finding name one source: the finding's plain reason is the row.
    expect(view.failed).toEqual([PRESS]);
    expect(view.missing).toEqual([]);
    expect(view.warnings).toEqual([]);
  });

  it('keeps a legacy failed row no finding names, each row with its own version, and words the findings as the run’s own are', () => {
    const inherited: MktgReportInherited = {
      from_version: 2,
      sources_read: [{ source: 'https://example.org/', version: 2 }],
      sources_failed: [
        { name: 'https://WWW.example.org/press/', reason: 'HTTP 404', version: 1 },
        { name: 'https://example.org/members', reason: 'HTTP 503', version: 1 },
      ],
      findings: {
        sources_failed: [{ source: 'http://example.org/press', kind: 'link', reason: 'This page does not exist.', version: 1 }],
        missing_assets: [{ asset: 'press_release', reason: 'No press release was found.', fix: 'Add the launch release as a link.', version: 2 }],
        warnings: [
          { code: 'truncated_read', text: 'The page was cut short.', source: 'https://example.org/long', version: 2 },
          { code: 'lfx_record_by_name', text: 'The record was found by name.', version: 1 },
        ],
      },
    };
    expect(mktgReportInheritedView({ ...V1_REPORT, inherited }, { press_release: 'Press release' })).toEqual({
      read: [{ source: 'https://example.org/', marker: 'Read in version 2' }],
      failed: [
        { title: 'http://example.org/press', text: 'This page does not exist.', detail: null, marker: 'Could not be read in version 1' },
        { title: 'https://example.org/members', text: 'HTTP 503', detail: null, marker: 'Could not be read in version 1' },
      ],
      missing: [{ title: 'Press release', text: 'No press release was found.', fix: 'Add the launch release as a link.', marker: 'Missing in version 2' }],
      warnings: [
        { text: 'The page was cut short.', source: 'https://example.org/long', href: 'https://example.org/long', marker: 'Noted in version 2' },
        { text: 'The record was found by name.', source: null, href: null, marker: 'Noted in version 1' },
      ],
    });
  });

  it('titles a failed source as the view does (the Brand Kit names a logo package), and gives four empty lists for a report that inherited nothing', () => {
    const zip: MktgReportInherited = { ...NOTHING, sources_failed: [{ name: 'https://cdn.example.org/logos.zip', reason: 'Not readable.', version: 1 }] };
    expect(mktgReportInheritedView({ ...V1_REPORT, inherited: zip }, {}, brandKitFailedSourceTitle).failed[0].title).toBe(
      'Logo package (ZIP) — cdn.example.org'
    );
    const none = { read: [], failed: [], missing: [], warnings: [] };
    expect(mktgReportInheritedView(V1_REPORT, {})).toEqual(none);
    expect(mktgReportInheritedView(null, {})).toEqual(none);
    expect(describeMktgInheritedRow('read', 3)).toBe('Read in version 3');
  });
});

describe('inherited rows count as the run’s own', () => {
  it('counts them in the readiness line: the sources read and the one that could not be', () => {
    expect(describeMktgAssetReadiness(mktgRedraftReportFixture())).toBe('Ready — 1 of 7 sources could not be read.');
    const own: MktgAssetReport = { ...mktgRedraftReportFixture(), sources_read: ['Docs'], sources_failed: [{ name: 'Blog', reason: '404' }], gaps: ['A gap.'] };
    expect(describeMktgAssetReadiness(own)).toBe('Ready — 2 of 9 sources could not be read; 1 gap.');
    expect(describeMktgAssetReadiness({ ...V1_REPORT, inherited: NOTHING })).toBe('Ready.');
  });

  it('opens the approve dialog on an inherited failed source or missing asset, never on an inherited read or warning alone', () => {
    expect(mktgReportHasOpenGaps(mktgRedraftReportFixture())).toBe(true);
    const missing = { asset: 'press_release', reason: 'No press release was found.', fix: 'Add it as a link.', version: 1 };
    expect(mktgReportHasOpenGaps({ ...V1_REPORT, inherited: { ...NOTHING, findings: { ...NOTHING.findings, missing_assets: [missing] } } })).toBe(true);
    expect(mktgReportHasOpenGaps({ ...V1_REPORT, inherited: { ...NOTHING, sources_failed: [{ name: 'Docs', reason: '404', version: 1 }] } })).toBe(true);
    const quiet: MktgReportInherited = {
      ...NOTHING,
      sources_read: [{ source: 'Docs', version: 1 }],
      findings: { ...NOTHING.findings, warnings: [{ code: 'truncated_read', text: 'The page was cut short.', version: 1 }] },
    };
    expect(mktgReportHasOpenGaps({ ...V1_REPORT, inherited: quiet })).toBe(false);
  });

  it('lists them in the approve dialog after the run’s own, marked with their version, and never repeats a gap an inherited missing asset mirrors', () => {
    expect(brandKitApproveFindings(mktgRedraftReportFixture())).toEqual({ failed: [PRESS], missing: [] });
    const question = 'How do I propose a new project?';
    const report: MktgAssetReport = {
      ...mktgRedraftReportFixture(),
      gaps: [question, 'Whether to name the members.'],
      findings: { sources_failed: [{ source: 'https://aaif.io/blog', kind: 'link', reason: 'The page timed out.' }], missing_assets: [], warnings: [] },
    };
    report.inherited?.findings.missing_assets.push({ asset: 'unanswered_question', reason: question, fix: 'Answer it and redraft.', version: 1 });
    expect(brandKitApproveFindings(report)).toEqual({
      failed: [{ title: 'https://aaif.io/blog', text: 'The page timed out.', detail: null }, PRESS],
      missing: [{ title: 'Open question', text: question, fix: 'Answer it and redraft.', marker: 'Missing in version 1' }],
    });
    expect(mktgReportUnmirroredGaps(report)).toEqual(['Whether to name the members.']);
  });

  it('keeps a legacy report’s own failed sources and gaps in the dialog’s groups when it inherited rows but wrote no findings', () => {
    const legacy: MktgAssetReport = {
      ...V1_REPORT,
      sources_failed: [{ name: 'Blog', reason: '404' }],
      gaps: ['A gap.'],
      inherited: mktgRedraftReportFixture().inherited,
    };
    expect(brandKitApproveFindings(legacy).failed).toEqual([{ title: 'Blog', text: '404', detail: null }, PRESS]);
    expect(mktgReportUnmirroredGaps(legacy)).toEqual(['A gap.']);
  });
});
