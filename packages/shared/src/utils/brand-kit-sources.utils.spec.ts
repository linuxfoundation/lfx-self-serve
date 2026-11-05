// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import type { MktgRevisionApproval } from '../interfaces/mktg-document-store.interface';
import { brandKitReportV2Fixture } from './__fixtures__/brand-kit-report-v2.fixture';
import { brandKitIsLight, brandKitLabelInk } from './brand-kit-book.utils';
import { brandKitConflictSourceLabel, brandKitFailedSourceTitle, brandKitSourceHref, brandKitSourcesView } from './brand-kit-sources.utils';
import { mktgAcceptedSnapshotOf } from './mktg-asset.utils';

describe('brandKitSourcesView', () => {
  const approvedAt = '2026-11-04T10:00:00Z';
  const DARK = '#171717';

  it('builds the four groups from a v2 report in the agent’s words, nothing rewritten', () => {
    const report = brandKitReportV2Fixture();
    const view = brandKitSourcesView(report, null, 3, DARK);
    expect(view.failed).toHaveLength(report.findings?.sources_failed.length ?? 0);
    expect(view.failed[0]).toEqual({
      key: report.findings?.sources_failed[0].source,
      title: report.findings?.sources_failed[0].source,
      text: 'This page does not exist on the site (the server answered 404).',
      detail: 'HTTP 404',
      fix: null,
      source: report.findings?.sources_failed[0].source,
      href: null,
      accepted: false,
    });
    // The logo package the agent could not read from a link is named in words; its address stays on the item.
    expect(view.failed[1].title).toBe('Logo package (ZIP) — cdn.sanity.io');
    expect(view.failed[1].source).toBe(report.findings?.sources_failed[1].source);
    expect(view.missing.map((item) => item.title)).toEqual(['Primary logo', 'Stacked logo', 'Symbol', 'Reversed logo']);
    const stacked = report.findings?.missing_assets[1];
    expect(view.missing[1]).toEqual({
      key: 'logo_stacked',
      title: 'Stacked logo',
      text: stacked?.reason,
      detail: null,
      fix: stacked?.fix,
      source: null,
      href: null,
      accepted: false,
    });
    expect(stacked?.fix).toBeTruthy();
    expect(view.warnings).toHaveLength(report.findings?.warnings.length ?? 0);
    expect(view.warnings[0]).toEqual({
      key: `color_conflict|${report.findings?.warnings[0].text}`,
      title: '',
      text: report.findings?.warnings[0].text,
      detail: null,
      fix: null,
      source: report.findings?.warnings[0].source,
      href: report.findings?.warnings[0].source,
      accepted: false,
    });
    // Every warning source in the agent's envelope is a web address, so each is also its own link.
    expect(view.warnings.map((warning) => warning.href)).toEqual(report.findings?.warnings.map((warning) => warning.source));
    expect(view.conflicts).toEqual(
      (report.color_conflicts ?? []).map((conflict) => ({
        key: conflict.name,
        name: conflict.name,
        values: conflict.values.map((value) => ({
          ...value,
          hexDigits: value.hex.slice(1),
          sourceLabel: brandKitConflictSourceLabel(value.source),
          light: expect.any(Boolean),
          ink: expect.any(String),
        })),
        chosen: conflict.chosen,
        accepted: false,
      }))
    );
    expect(view.conflicts[0]).toMatchObject({ name: 'Coral', chosen: '#FF702D' });
    // Each value's source in the palette's own words, the site by its host, never the full address.
    expect(view.conflicts[0].values.map((value) => value.sourceLabel)).toEqual(['From the brand page — aaif.io', 'From the site’s CSS — aaif.io']);
    // Each value is drawn as the Colour chapter draws a swatch: the kit's dark when it is legible on the ground, else white or black.
    expect(view.conflicts[0].values.map((value) => value.ink)).toEqual(report.color_conflicts?.[0].values.map((value) => brandKitLabelInk(value.hex, DARK)));
    expect(view.conflicts[0].values.map((value) => value.light)).toEqual(report.color_conflicts?.[0].values.map((value) => brandKitIsLight(value.hex)));
    expect(view.gaps).toEqual([{ text: report.gaps[0], accepted: false }]);
    expect(view.acceptedMarker).toBe('');
    expect(view.legacyApproval).toBe(false);
  });

  it('shows a v1 report’s legacy failed list where the findings would be, and nothing in the other groups', () => {
    const { version, findings, color_conflicts, rules, ...v1 } = brandKitReportV2Fixture();
    void version;
    void findings;
    void color_conflicts;
    void rules;
    const view = brandKitSourcesView(v1, null, 1, DARK);
    expect(view.failed.map((item) => [item.title, item.text, item.detail])).toEqual(v1.sources_failed.map((entry) => [entry.name, entry.reason, null]));
    expect(view.missing).toEqual([]);
    expect(view.warnings).toEqual([]);
    expect(view.conflicts).toEqual([]);
  });

  it('marks each item the approval’s snapshot lists, by its stable key, and nothing new since', () => {
    const report = brandKitReportV2Fixture();
    const approval: MktgRevisionApproval = { approvedAt, approvedBy: null, accepted: mktgAcceptedSnapshotOf(report) };
    report.findings?.warnings.push({ code: 'font_unverified', text: 'The typeface could not be verified.' });
    report.gaps.push('A newer gap.');
    const view = brandKitSourcesView(report, approval, 4, DARK);
    expect(view.acceptedMarker).toBe('Accepted when v4 was approved');
    expect(view.legacyApproval).toBe(false);
    const snapshot = approval.accepted;
    if (!snapshot) throw new Error('The approval lost its snapshot');
    expect(view.failed.map((item) => item.accepted)).toEqual(snapshot.sources_failed.map(() => true));
    expect(view.missing.map((item) => item.accepted)).toEqual(snapshot.missing_assets.map(() => true));
    expect(view.warnings.map((item) => item.accepted)).toEqual([...snapshot.warnings.map(() => true), false]);
    expect(view.conflicts.map((item) => item.accepted)).toEqual(snapshot.color_conflicts.map(() => true));
    expect(view.gaps.map((item) => item.accepted)).toEqual([...snapshot.gaps.map(() => true), false]);
  });

  it('marks nothing under an approval without a snapshot and says so, so the view keeps its derived line', () => {
    const view = brandKitSourcesView(brandKitReportV2Fixture(), { approvedAt, approvedBy: null }, 2, DARK);
    expect(view.legacyApproval).toBe(true);
    expect(view.acceptedMarker).toBe('');
    expect([...view.failed, ...view.missing, ...view.warnings].some((item) => item.accepted)).toBe(false);
  });

  it('says "Accepted at approval" when the version is unknown', () => {
    const report = brandKitReportV2Fixture();
    const view = brandKitSourcesView(report, { approvedAt, approvedBy: null, accepted: mktgAcceptedSnapshotOf(report) }, null, DARK);
    expect(view.acceptedMarker).toBe('Accepted at approval');
  });

  it('links a warning’s source only when it is a web address', () => {
    expect(brandKitSourceHref('https://synthetic.example/brand')).toBe('https://synthetic.example/brand');
    expect(brandKitSourceHref('http://synthetic.example/')).toBe('http://synthetic.example/');
    expect(brandKitSourceHref('logo.svg')).toBeNull();
    expect(brandKitSourceHref('javascript:alert(1)')).toBeNull();
    expect(brandKitSourceHref('data:text/html,hi')).toBeNull();
    expect(brandKitSourceHref(null)).toBeNull();
  });

  it('gives each warning its href in the view, so the template binds it and never computes it', () => {
    const report = brandKitReportV2Fixture();
    const warnings = [
      { code: 'palette_from_page_text' as const, text: 'Seen on the site.', source: 'https://synthetic.example/brand' },
      { code: 'palette_from_page_text' as const, text: 'Seen in a file.', source: 'logo.svg' },
      { code: 'palette_from_page_text' as const, text: 'Seen in a script.', source: 'javascript:alert(1)' },
      { code: 'palette_from_page_text' as const, text: 'Seen nowhere named.' },
    ];
    const view = brandKitSourcesView({ ...report, findings: { ...report.findings, sources_failed: [], missing_assets: [], warnings } }, null, null, DARK);
    expect(view.warnings.map((warning) => [warning.source, warning.href])).toEqual([
      ['https://synthetic.example/brand', 'https://synthetic.example/brand'],
      ['logo.svg', null],
      ['javascript:alert(1)', null],
      [null, null],
    ]);
  });

  it('names where a conflicting value was seen as the palette does, or by the host, or as written', () => {
    expect(brandKitConflictSourceLabel('brand_page: https://aaif.io/brand')).toBe('From the brand page — aaif.io');
    expect(brandKitConflictSourceLabel('site_css: https://aaif.io/_next/static/chunks/3tg274q-9atqx.css')).toBe('From the site’s CSS — aaif.io');
    expect(brandKitConflictSourceLabel('logo: https://cdn.synthetic.example/logo.svg')).toBe('From the logo artwork — logo.svg');
    expect(brandKitConflictSourceLabel('stylesheet: https://www.synthetic.example/a.css')).toBe('stylesheet: synthetic.example');
    expect(brandKitConflictSourceLabel('the printed guidelines, page 4')).toBe('the printed guidelines, page 4');
  });

  it('titles a failed logo package by its kind and host, and leaves every other failed source as written', () => {
    expect(brandKitFailedSourceTitle('https://cdn.sanity.io/files/x/production/abc.zip?dl=')).toBe('Logo package (ZIP) — cdn.sanity.io');
    expect(brandKitFailedSourceTitle('https://www.synthetic.example/brand/Logos.ZIP#top')).toBe('Logo package (ZIP) — synthetic.example');
    expect(brandKitFailedSourceTitle('https://aaif.io/brand-guidelines')).toBe('https://aaif.io/brand-guidelines');
    expect(brandKitFailedSourceTitle('https://synthetic.example/zip-archive-notes')).toBe('https://synthetic.example/zip-archive-notes');
    expect(brandKitFailedSourceTitle('logo.zip')).toBe('logo.zip');
  });
});
