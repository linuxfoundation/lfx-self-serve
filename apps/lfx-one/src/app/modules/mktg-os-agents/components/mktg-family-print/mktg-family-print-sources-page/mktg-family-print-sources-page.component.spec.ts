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
    document: mktgFamilyPrintDocument(MKTG_KIT_POSITIONING_FAMILY_ID, 'brand-kit', 1, 4, approval, ['No stacked lockup.'], '2026-10-17T00:00:00Z'),
    openerPage: 3,
    first: 4,
    last: 8,
    entries: [],
  },
  { document: mktgFamilyPrintDocument(MKTG_KIT_POSITIONING_FAMILY_ID, 'faq', 2, 16, null, []), openerPage: 9, first: 10, last: 10, entries: [] },
];

describe('MktgFamilyPrintSourcesPageComponent', () => {
  it('tables each document’s version, approval and data date, and lists the conflicts and the open items', async () => {
    const fixture = TestBed.createComponent(MktgFamilyPrintSourcesPageComponent);
    fixture.componentRef.setInput('chapters', chapters);
    fixture.componentRef.setInput('conflicts', [{ id: 'Brand line · Brand kit', topic: 'Brand line', text: 'They differ.', rerun: 'Re-run the brand kit.' }]);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    const rows = Array.from(root.querySelectorAll('[data-testid="family-print-sources-row"]')).map((row) =>
      Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent?.trim())
    );
    expect(rows).toEqual([
      ['Brand kit', 'V4.0', '6 Nov 2026', 'figures as of 17 Oct 2026'],
      ['FAQ', 'V16.0', '', ''],
    ]);
    const conflicts = root.querySelector('[data-testid="family-print-sources-conflicts"]');
    expect(conflicts?.textContent).toContain('Brand line');
    expect(conflicts?.querySelector('.fps-rerun')?.textContent).toBe('→ Re-run the brand kit.');
    expect(root.querySelector('[data-testid="family-print-sources-conflicts-cut"]')).toBeNull();
    expect(root.querySelector('[data-testid="family-print-sources-open-cut"]')).toBeNull();
    const open = root.querySelector<HTMLElement>('[data-testid="family-print-sources-open"]');
    expect(open?.textContent).toContain('No stacked lockup.');
    expect(open?.querySelector('.pp-chip')?.textContent).toBe('Brand kit');
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

  it('prints only the whole rows that fit each block above the footer, counts the rest, and prints an item a record states twice once', async () => {
    const fixture = TestBed.createComponent(MktgFamilyPrintSourcesPageComponent);
    const openItems = Array.from({ length: 14 }, (_, index) => `Open item ${index + 1} that the run left for the team to check before the next release.`);
    // The record states the first item twice; the page prints it once (14 distinct items).
    openItems.push(openItems[0]);
    fixture.componentRef.setInput('chapters', [
      { ...chapters[0], document: mktgFamilyPrintDocument(MKTG_KIT_POSITIONING_FAMILY_ID, 'brand-kit', 1, 4, approval, openItems) },
    ]);
    fixture.componentRef.setInput(
      'conflicts',
      Array.from({ length: 8 }, (_, index) => ({
        id: `Members · ${index}`,
        topic: 'Members',
        text: 'The framework’s key numbers say 299 members; the FAQ says “The foundation has 308 member organizations today.”',
        rerun: 'Re-run the FAQ so it reads the approved framework.',
      }))
    );
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    const shown = root.querySelectorAll('[data-testid="family-print-sources-conflicts"] .fps-row').length;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(8);
    const open = root.querySelectorAll('[data-testid="family-print-sources-open"] .fps-open__text').length;
    expect(open).toBeGreaterThan(0);
    expect(open).toBeLessThan(14);
    expect(root.textContent).not.toContain(`Open item 14`);
    // The rows past each block are counted under it, never dropped in silence.
    expect(root.querySelector('[data-testid="family-print-sources-conflicts-cut"]')?.textContent).toBe(`+${8 - shown} more in LFX One`);
    expect(root.querySelector('[data-testid="family-print-sources-open-cut"]')?.textContent).toBe(`+${14 - open} more in LFX One`);
  });
});
