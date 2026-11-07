// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { MKTG_KIT_POSITIONING_FAMILY_ID } from '@lfx-one/shared/constants';
import { MktgFamilyPrintChapter } from '@lfx-one/shared/interfaces';
import { mktgFamilyPrintDocument } from '@lfx-one/shared/utils';
import { describe, expect, it } from 'vitest';
import { MktgFamilyPrintSourcesPageComponent } from './mktg-family-print-sources-page.component';

const approval = { approvedAt: '2026-11-06T12:00:00Z', approvedBy: null };
const chapters: MktgFamilyPrintChapter[] = [
  {
    document: mktgFamilyPrintDocument(MKTG_KIT_POSITIONING_FAMILY_ID, 'brand-kit', 1, 4, approval, ['No stacked lockup.']),
    openerPage: 3,
    first: 4,
    last: 8,
    entries: [],
  },
  { document: mktgFamilyPrintDocument(MKTG_KIT_POSITIONING_FAMILY_ID, 'faq', 2, 16, null, []), openerPage: 9, first: 10, last: 10, entries: [] },
];

describe('MktgFamilyPrintSourcesPageComponent', () => {
  it('tables each document’s version, approval and pages, and lists the conflicts and the open items', async () => {
    const fixture = TestBed.createComponent(MktgFamilyPrintSourcesPageComponent);
    fixture.componentRef.setInput('chapters', chapters);
    fixture.componentRef.setInput('conflicts', [{ topic: 'Brand line', text: 'They differ.', rerun: 'Re-run the brand kit.' }]);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    const rows = Array.from(root.querySelectorAll('[data-testid="family-print-sources-row"]')).map((row) =>
      Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent?.trim())
    );
    expect(rows).toEqual([
      ['Brand kit', 'V4.0', '6 Nov 2026', '3–8'],
      ['FAQ', 'V16.0', '', '9–10'],
    ]);
    const conflicts = root.querySelector('[data-testid="family-print-sources-conflicts"]');
    expect(conflicts?.textContent).toContain('Brand line');
    expect(conflicts?.querySelector('.fps-rerun')?.textContent).toBe('→ Re-run the brand kit.');
    const open = root.querySelector<HTMLElement>('[data-testid="family-print-sources-open"]');
    expect(open?.textContent).toContain('No stacked lockup.');
    expect(open?.querySelector('.fp-chip')?.textContent).toBe('Brand kit');
    expect(open?.style.top).toBe('690px');
  });

  it('omits the conflicts block when the store names none, and the open list moves up', async () => {
    const fixture = TestBed.createComponent(MktgFamilyPrintSourcesPageComponent);
    fixture.componentRef.setInput('chapters', chapters);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[data-testid="family-print-sources-conflicts"]')).toBeNull();
    expect(root.querySelector<HTMLElement>('[data-testid="family-print-sources-open"]')?.style.top).toBe('410px');
  });

  it('omits the open list when every run closed clean', async () => {
    const fixture = TestBed.createComponent(MktgFamilyPrintSourcesPageComponent);
    fixture.componentRef.setInput('chapters', [chapters[1]]);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[data-testid="family-print-sources-open"]')).toBeNull();
    expect(root.querySelectorAll('[data-testid="family-print-sources-row"]')).toHaveLength(1);
  });
});
