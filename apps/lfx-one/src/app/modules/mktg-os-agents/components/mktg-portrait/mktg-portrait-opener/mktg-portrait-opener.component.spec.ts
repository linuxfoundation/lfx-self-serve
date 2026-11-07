// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { MktgPortraitBook } from '@lfx-one/shared/interfaces';
import { mktgPortraitLook, mktgPrintBrand } from '@lfx-one/shared/utils';
import { describe, expect, it } from 'vitest';
import { MktgPortraitOpenerComponent } from './mktg-portrait-opener.component';

const BOOK: MktgPortraitBook = {
  inFamily: true,
  headRight: 'Synthetic project positioning & brand',
  footLeft: 'Synthetic project · a Linux Foundation project',
  firstPage: 17,
};

async function setup(
  meta: { version?: string; approved?: string; pages?: string; approver?: string | null } = { version: 'V4.0', approved: '6 Nov 2026', pages: '17–30' }
) {
  const fixture = TestBed.createComponent(MktgPortraitOpenerComponent);
  fixture.componentRef.setInput('look', mktgPortraitLook(mktgPrintBrand(null)));
  fixture.componentRef.setInput('book', BOOK);
  fixture.componentRef.setInput('page', 16);
  fixture.componentRef.setInput('pageId', 'opener-brand-kit');
  fixture.componentRef.setInput('number', '02');
  fixture.componentRef.setInput('title', 'Brand kit');
  fixture.componentRef.setInput('purpose', 'The logo and its rules, colour and contrast, type, iconography and imagery.');
  fixture.componentRef.setInput('version', meta.version ?? '');
  fixture.componentRef.setInput('approved', meta.approved ?? '');
  fixture.componentRef.setInput('pages', meta.pages ?? '');
  fixture.componentRef.setInput('approver', meta.approver ?? null);
  await fixture.whenStable();
  const page = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-testid="lfx-mktg-portrait-page"]');
  if (!page) throw new Error('Missing synthetic opener');
  return { fixture, page };
}

describe('lfx-mktg-portrait-opener', () => {
  it('is a bare dark frame: the number at (72, 120), the title and purpose at y 420, version · approved · pages at y 836', async () => {
    const { page } = await setup();
    expect(page.classList.contains('pp-page--dark')).toBe(true);
    expect(page.getAttribute('data-page-id')).toBe('opener-brand-kit');
    expect(page.getAttribute('data-page')).toBe('16');
    expect(page.getAttribute('data-section')).toBe('02 Brand kit');
    expect(page.querySelector('[data-testid="mktg-portrait-page-head"]')).toBeNull();
    const number = page.querySelector<HTMLElement>('[data-testid="mktg-portrait-opener-number"]');
    expect(number?.textContent).toBe('02');
    expect(number?.classList.contains('pp-opener-number')).toBe(true);
    expect(number?.parentElement?.style.left).toBe('72px');
    expect(number?.parentElement?.style.top).toBe('120px');
    const title = page.querySelector<HTMLElement>('[data-testid="mktg-portrait-opener-title"]');
    expect(title?.textContent).toBe('Brand kit');
    expect(title?.parentElement?.style.top).toBe('420px');
    expect(page.querySelector('[data-testid="mktg-portrait-opener-purpose"]')?.textContent).toContain('The logo and its rules');
    const meta = page.querySelector<HTMLElement>('[data-testid="mktg-portrait-opener-meta"]');
    expect(meta?.parentElement?.style.top).toBe('836px');
    expect(Array.from(meta?.querySelectorAll('dt') ?? []).map((cell) => cell.textContent)).toEqual(['Version', 'Approved', 'Pages']);
    expect(Array.from(meta?.querySelectorAll('dd') ?? []).map((cell) => cell.textContent)).toEqual(['V4.0', '6 Nov 2026', '17–30']);
    expect(meta?.querySelector('dt')?.classList.contains('pp-lab--accent')).toBe(true);
  });

  it('leaves out a column the live store does not fill, and the row when none is filled', async () => {
    const { page } = await setup({ approved: '6 Nov 2026', pages: '17–30' });
    expect(Array.from(page.querySelectorAll('dt')).map((cell) => cell.textContent)).toEqual(['Approved', 'Pages']);
    expect(page.textContent).not.toContain('[');
    const { page: none } = await setup({});
    expect(none.querySelector('[data-testid="mktg-portrait-opener-meta"]')).toBeNull();
  });

  it('prints the approver on its own body-size line under the date when the store names one, and nothing when it does not', async () => {
    const { page } = await setup({ version: 'V4.0', approved: '6 Nov 2026', pages: '17–30', approver: 'by Synthetic Approver' });
    const note = page.querySelector<HTMLElement>('[data-testid="mktg-portrait-opener-approver"]');
    expect(note?.textContent).toBe('by Synthetic Approver');
    expect(note?.classList.contains('pp-opener-meta-note')).toBe(true);
    expect(note?.previousElementSibling?.textContent).toBe('6 Nov 2026');
    expect(note?.classList.contains('pp-opener-meta-value')).toBe(false);
    const { page: unnamed } = await setup();
    expect(unnamed.querySelector('[data-testid="mktg-portrait-opener-approver"]')).toBeNull();
    const { page: blank } = await setup({ approved: '6 Nov 2026', approver: '  ' });
    expect(blank.querySelector('[data-testid="mktg-portrait-opener-approver"]')).toBeNull();
  });
});
