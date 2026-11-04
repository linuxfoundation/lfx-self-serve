// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import type { BrandKitReport, MktgAssetReport } from '@lfx-one/shared/interfaces';
import { brandKitReportV2RulesFixture } from '@lfx-one/shared/utils/__fixtures__/brand-kit-report-v2-rules.fixture';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { describe, expect, it, vi } from 'vitest';
import { MktgApproveGapsDialogComponent } from './mktg-approve-gaps-dialog.component';

describe('Approval with open gaps dialog', () => {
  const close = vi.fn();
  const render = async (report: MktgAssetReport): Promise<HTMLElement> => {
    close.mockReset();
    TestBed.configureTestingModule({
      imports: [MktgApproveGapsDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: report } },
      ],
    });
    const fixture = TestBed.createComponent(MktgApproveGapsDialogComponent);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  };
  const query = (root: HTMLElement, testId: string): HTMLElement | null => root.querySelector(`[data-testid="${testId}"]`);
  const queryAll = (root: HTMLElement, testId: string): HTMLElement[] => Array.from(root.querySelectorAll(`[data-testid="${testId}"]`));

  it.each([
    ['cancel', false],
    ['anyway', true],
  ] as const)('lists the report as text and returns %s', async (action, result) => {
    const report: MktgAssetReport = { sources_read: [], sources_failed: [{ name: 'Docs', reason: '404' }], gaps: ['<b>Missing</b>'], notes: '' };
    const root = await render(report);
    expect(root.textContent).toContain('Docs — 404');
    expect(root.textContent).toContain('<b>Missing</b>');
    expect(root.querySelector('b')).toBeNull();
    // A v1 report: only today's list, nothing about conflicts or rules.
    expect(query(root, 'mktg-document-view-approve-conflicts')).toBeNull();
    expect(query(root, 'mktg-document-view-approve-rules')).toBeNull();
    expect(close).not.toHaveBeenCalled();
    root.querySelector<HTMLButtonElement>(`[data-testid="mktg-document-view-approve-${action}"] button`)?.click();
    expect(close).toHaveBeenCalledExactlyOnceWith(result);
  });

  it('shows a v2 report’s colour conflicts, both values with their sources and the one kept, and the chapters the LF reference supplied rules to', async () => {
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
    // Today's list stays.
    expect(root.textContent).toContain('https://synthetic-foundation.example/brand-guidelines — HTTP 404');
    expect(root.textContent).toContain('No logo files');

    const conflicts = query(root, 'mktg-document-view-approve-conflicts');
    expect(conflicts?.querySelector('h3')?.textContent).toBe('Colour conflicts');
    const items = queryAll(root, 'mktg-document-view-approve-conflict');
    expect(items).toHaveLength(2);
    expect(items[0].querySelector('span')?.textContent).toBe('Coral');
    const values = (item: HTMLElement): string[][] =>
      Array.from(item.querySelectorAll('li')).map((value) => Array.from(value.querySelectorAll('span')).map((span) => span.textContent?.trim() ?? ''));
    expect(values(items[0])).toEqual([
      ['', '#FF702D', 'From the brand page — synthetic-foundation.example', 'kept #FF702D'],
      ['', '#FF7D2D', 'From the site’s CSS — synthetic-foundation.example'],
    ]);
    expect(items[1].querySelector('span')?.textContent).toBe('Black');
    expect(values(items[1])).toEqual([
      ['', '#171717', 'From the site’s CSS — synthetic-foundation.example'],
      ['', '#000000', 'From the brand page — synthetic-foundation.example', 'kept #000000'],
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
      'Type: 5 of 9 rules',
      'Visual: 9 of 9 rules',
      'Usage: 2 of 2 rules',
    ]);
    expect(root.textContent).not.toContain('chapters.');
    expect(root.textContent).not.toContain('lf-reference');
  });

  it('leaves a section out when the report has nothing for it, and today’s list out when there is no failed source or gap', async () => {
    const report: BrandKitReport = {
      sources_read: [],
      sources_failed: [],
      gaps: [],
      notes: '',
      version: 2,
      color_conflicts: [],
      rules: [{ path: 'chapters.voice', basis: 'project' }],
    };
    const root = await render(report);
    expect(root.querySelector('ul')).toBeNull();
    expect(query(root, 'mktg-document-view-approve-conflicts')).toBeNull();
    expect(query(root, 'mktg-document-view-approve-rules')).toBeNull();
    expect(query(root, 'mktg-document-view-approve-anyway')).not.toBeNull();
  });
});
