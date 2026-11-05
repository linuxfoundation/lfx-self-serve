// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import type { BrandKitReport, MktgAssetReport } from '@lfx-one/shared/interfaces';
import { brandKitReportV2RulesFixture } from '@lfx-one/shared/utils/__fixtures__/brand-kit-report-v2-rules.fixture';
import { DynamicDialogConfig } from 'primeng/dynamicdialog';
import { describe, expect, it } from 'vitest';
import { MktgApproveGapsDialogComponent } from './mktg-approve-gaps-dialog.component';

describe('Approval with open gaps dialog', () => {
  const render = async (report: MktgAssetReport): Promise<HTMLElement> => {
    TestBed.configureTestingModule({
      imports: [MktgApproveGapsDialogComponent],
      providers: [{ provide: DynamicDialogConfig, useValue: { data: report } }],
    });
    const fixture = TestBed.createComponent(MktgApproveGapsDialogComponent);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };
  const query = (root: HTMLElement, testId: string): HTMLElement | null => root.querySelector(`[data-testid="${testId}"]`);
  const queryAll = (root: HTMLElement, testId: string): HTMLElement[] => Array.from(root.querySelectorAll(`[data-testid="${testId}"]`));

  it('lists a v1 report as text', async () => {
    const report: MktgAssetReport = { sources_read: [], sources_failed: [{ name: 'Docs', reason: '404' }], gaps: ['<b>Missing</b>'], notes: '' };
    const root = await render(report);
    expect(root.textContent).toContain('Docs — 404');
    expect(root.textContent).toContain('<b>Missing</b>');
    expect(root.querySelector('b')).toBeNull();
    // A v1 report: only today's list, nothing about failed-source or missing-asset groups, conflicts or rules.
    expect(query(root, 'mktg-document-view-approve-failed')).toBeNull();
    expect(query(root, 'mktg-document-view-approve-missing')).toBeNull();
    expect(query(root, 'mktg-document-view-approve-conflicts')).toBeNull();
    expect(query(root, 'mktg-document-view-approve-rules')).toBeNull();
  });

  it('shows a v2 report’s failed sources and missing assets like the Sources tab, its colour conflicts with the one kept, and the chapters the LF reference supplied rules to', async () => {
    // The agent fixture carries one conflict; a second, hand-made one proves the per-conflict rendering (the kept value need not come first).
    const report = brandKitReportV2RulesFixture();
    report.color_conflicts = [
      ...(report.color_conflicts ?? []),
      {
        name: 'Black',
        values: [
          { hex: '#171717', source: 'site_css: https://synthetic-foundation.example/site.css' },
          { hex: '#000000', source: 'brand_page: https://synthetic-foundation.example/brand' },
        ],
        chosen: '#000000',
      },
    ];
    const root = await render(report);
    // The dialog opens read from its top: the content itself holds focus, not the footer button.
    expect(document.activeElement).toBe(query(root, 'mktg-document-view-approve-confirm'));
    // A v2 report: the top list is the Sources tab's two groups (source, plain reason, small detail; asset label, reason, fix), then the gaps.
    expect(root.textContent).not.toContain('brand-guidelines — HTTP 404');
    const failed = query(root, 'mktg-document-view-approve-failed');
    expect(failed?.querySelector('h3')?.textContent).toBe('Failed sources');
    const lines = (item: HTMLElement): string[] => Array.from(item.querySelectorAll('span')).map((span) => span.textContent?.trim() ?? '');
    expect(queryAll(root, 'mktg-document-view-approve-failed-item').map(lines)).toEqual([
      ['https://synthetic-foundation.example/brand-guidelines', 'This page does not exist on the site (the server answered 404).', 'HTTP 404'],
      [
        'Logo package (ZIP) — cdn.synthetic-foundation.example',
        'The logo package on synthetic-foundation.example/brand is a ZIP file, which the agent can’t download from a link. Upload the stacked, reversed, symbol and primary files as SVG in the form, or a ZIP of the SVG files under 150 KB; a larger ZIP may not send.',
        'linked ZIP, not readable from a link',
      ],
    ]);
    const missing = query(root, 'mktg-document-view-approve-missing');
    expect(missing?.querySelector('h3')?.textContent).toBe('Missing assets');
    const missingItems = queryAll(root, 'mktg-document-view-approve-missing-item').map(lines);
    expect(missingItems.map((item) => item[0])).toEqual(['Primary logo', 'Stacked logo', 'Symbol', 'Reversed logo']);
    expect(missingItems[0]).toEqual([
      'Primary logo',
      'The site’s header links a logo image (synthetic-logo-838x203.svg) that was not read in this run, so the kit shows placeholder marks.',
      'Fix: Upload the primary file as SVG in the form, or a ZIP of the SVG files under 150 KB; the full package linked on synthetic-foundation.example/brand is likely too large to send.',
    ]);
    // The gaps bullets are not repeated on a v2 report; Missing assets stands for them.
    expect(root.textContent).not.toContain('No logo files');

    const conflicts = query(root, 'mktg-document-view-approve-conflicts');
    expect(conflicts?.querySelector('h3')?.textContent).toBe('Colour conflicts');
    const items = queryAll(root, 'mktg-document-view-approve-conflict');
    expect(items).toHaveLength(2);
    expect(items[0].querySelector('span')?.textContent).toBe('Coral');
    // Each value row: its first line (swatch, hex and, for the kept one, the pill right after the hex), then its source under them.
    const text = (element: Element): string => element.textContent?.trim() ?? '';
    const values = (item: HTMLElement): string[][] =>
      Array.from(item.querySelectorAll('li')).map((value) => {
        const [line, source] = Array.from(value.children);
        return [...Array.from(line.querySelectorAll('span')).map(text), text(source)];
      });
    expect(values(items[0])).toEqual([
      ['', '#FF702D', 'kept #FF702D', 'From the brand page — synthetic-foundation.example'],
      ['', '#FF7D2D', 'From the site’s CSS — synthetic-foundation.example'],
    ]);
    expect(items[1].querySelector('span')?.textContent).toBe('Black');
    expect(values(items[1])).toEqual([
      ['', '#171717', 'From the site’s CSS — synthetic-foundation.example'],
      ['', '#000000', 'kept #000000', 'From the brand page — synthetic-foundation.example'],
    ]);
    // Each value draws its swatch in its own colour.
    const swatches = Array.from(items[0].querySelectorAll<HTMLElement>('[aria-hidden="true"]')).map((swatch) => swatch.style.background.toLowerCase());
    expect(swatches).toHaveLength(2);
    expect(swatches[0]).toMatch(/^(#ff702d|rgb\(255, 112, 45\))$/);
    expect(swatches[1]).toMatch(/^(#ff7d2d|rgb\(255, 125, 45\))$/);
    // No raw source string or URL path reaches the dialog.
    expect(root.textContent).not.toContain('brand_page:');
    expect(root.textContent).not.toContain('_next/static');

    const rules = query(root, 'mktg-document-view-approve-rules');
    expect(rules?.querySelector('h3')?.textContent).toBe('Rules from the LF reference, not the project');
    expect(queryAll(root, 'mktg-document-view-approve-rule').map((line) => line.textContent)).toEqual([
      'Logo: 20 of 21 rules',
      'Color: 4 of 5 rules',
      'Type: 5 of 11 rules',
      'Visual: 9 of 9 rules',
      'Usage: 2 of 2 rules',
      'Voice: 1 of 8 rules',
    ]);
    expect(root.textContent).not.toContain('chapters.');
    expect(root.textContent).not.toContain('lf-reference');
  });

  it('lists leftover gaps the old way when a v2 report has nothing in either findings group', async () => {
    const report: BrandKitReport = {
      sources_read: [],
      sources_failed: [],
      gaps: ['Missing evidence'],
      notes: '',
      version: 2,
      findings: { sources_failed: [], missing_assets: [], warnings: [] },
      color_conflicts: [],
      rules: [{ path: 'chapters.voice', basis: 'project' }],
    };
    const root = await render(report);
    expect(root.querySelector('ul')?.textContent).toContain('Missing evidence');
    expect(query(root, 'mktg-document-view-approve-failed')).toBeNull();
    expect(query(root, 'mktg-document-view-approve-missing')).toBeNull();
  });

  it('leaves a section out when the report has nothing for it, and today’s list out when there is no failed source or gap', async () => {
    const report: BrandKitReport = {
      sources_read: [],
      sources_failed: [],
      gaps: [],
      notes: '',
      version: 2,
      findings: { sources_failed: [], missing_assets: [], warnings: [] },
      color_conflicts: [],
      rules: [{ path: 'chapters.voice', basis: 'project' }],
    };
    const root = await render(report);
    expect(root.querySelector('ul')).toBeNull();
    expect(query(root, 'mktg-document-view-approve-failed')).toBeNull();
    expect(query(root, 'mktg-document-view-approve-missing')).toBeNull();
    expect(query(root, 'mktg-document-view-approve-conflicts')).toBeNull();
    expect(query(root, 'mktg-document-view-approve-rules')).toBeNull();
  });
});
