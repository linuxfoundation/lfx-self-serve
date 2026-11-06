// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { MKTG_PRINT_PAGE_SIZE } from '@lfx-one/shared/constants';
import { BoilerplatesLengthRow } from '@lfx-one/shared/interfaces';
import { boilerplatesAssetOfRevision, buildBoilerplatesPrintView, mktgPagePt, mktgBoilerplatesPageCount, mktgPrintBrand } from '@lfx-one/shared/utils';
import envelope from '@lfx-one/shared/utils/__fixtures__/boilerplates.envelope.json';
import { expect, it } from 'vitest';
import { MktgBoilerplatesPrintComponent } from './mktg-boilerplates-print.component';

async function mount(lengths?: BoilerplatesLengthRow[], firstPage = 1) {
  const asset = boilerplatesAssetOfRevision(JSON.stringify(envelope.content), envelope);
  if (!asset) throw new Error('Invalid synthetic boilerplates');
  const brand = mktgPrintBrand(null);
  const view = buildBoilerplatesPrintView(asset, brand);
  if (lengths) view.lengths = lengths;
  const fixture = TestBed.createComponent(MktgBoilerplatesPrintComponent);
  fixture.componentRef.setInput('view', view);
  fixture.componentRef.setInput('number', '03');
  fixture.componentRef.setInput('projectName', 'Synthetic project');
  fixture.componentRef.setInput('familyName', 'Positioning & brand');
  fixture.componentRef.setInput('firstPage', firstPage);
  await fixture.whenStable();
  return { root: fixture.nativeElement as HTMLElement, view, brand };
}

it('prints the four lengths as two rows of bordered cards on one landscape page, each headed by its label and word count', async () => {
  const { root, view, brand } = await mount(undefined, 15);
  const pages = root.querySelectorAll('[data-testid="mktg-boilerplates-print-page"]');
  expect(pages).toHaveLength(mktgBoilerplatesPageCount(view.lengths));
  expect(pages).toHaveLength(1);
  // The page is one fixed landscape frame with the deck's chrome: the running head, the title band, the number, the footer line and the lockup.
  const frame = pages[0].querySelector('[data-testid="mktg-print-page"]');
  expect(frame?.getAttribute('data-layout')).toBe('content');
  expect(frame?.getAttribute('data-title')).toBe('Boilerplates');
  expect(Array.from(pages[0].querySelectorAll('[data-testid="mktg-print-page-head"]'), (el) => el.textContent?.trim())).toEqual([
    '03 Boilerplates',
    'Synthetic project Positioning & brand',
  ]);
  expect(pages[0].querySelector('[data-testid="mktg-print-page-title"]')?.textContent?.trim()).toBe('Boilerplates');
  expect(Array.from(pages[0].querySelectorAll('[data-testid="mktg-print-page-footer"]'), (el) => el.textContent?.trim())).toEqual([
    'Synthetic project · a Linux Foundation project',
    '15',
  ]);
  expect(pages[0].querySelector('[data-testid="mktg-print-page-logo"] img')?.getAttribute('src')).toBe(brand.logoOnLight?.src);
  // Two columns, the rows at the heights the pagination measured.
  const grid = pages[0].querySelector<HTMLElement>('[data-testid="mktg-boilerplates-print-grid"]');
  expect(grid?.style.gridTemplateRows.split(' minmax(')).toHaveLength(2);
  expect(grid?.style.getPropertyValue('--mbp-ink')).toBe(brand.dark);
  const cards = pages[0].querySelectorAll('[data-testid="mktg-boilerplates-print-card"]');
  expect(cards).toHaveLength(4);
  cards.forEach((card, index) => {
    const row = view.lengths[index];
    expect(card.querySelector('[data-testid="mktg-boilerplates-print-card-head"]')?.textContent).toBe(`${row.label.toUpperCase()} · ${row.words} WORDS`);
    expect(card.querySelector('[data-testid="mktg-boilerplates-print-card-body"]')?.textContent?.trim()).toBe(row.text);
    expect(card.querySelector<HTMLElement>('[data-testid="mktg-boilerplates-print-card-body"]')?.style.fontSize).toBe(mktgPagePt(MKTG_PRINT_PAGE_SIZE.card));
  });
  expect(root.textContent).not.toContain('Source');
});

it('continues long sets on numbered pages, every card on the page the pagination gave it, and prints a title band with no lengths', async () => {
  const text = Array.from({ length: 90 }, (_, i) => (i % 9 === 8 ? 'project.' : 'Synthetic')).join(' ');
  const lengths = Array.from(
    { length: 12 },
    (_, index): BoilerplatesLengthRow => ({
      index,
      label: `Length ${index + 1}`,
      hint: '',
      text,
      words: 90,
      max: 100,
      over: false,
      countLabel: '90 / 100 words',
    })
  );
  const { root, view } = await mount(lengths, 3);
  const pages = Array.from(root.querySelectorAll('[data-testid="mktg-boilerplates-print-page"]'));
  expect(pages).toHaveLength(mktgBoilerplatesPageCount(view.lengths));
  expect(pages.length).toBeGreaterThanOrEqual(2);
  expect(pages.map((page) => page.querySelector('[data-testid="mktg-print-page-title"]')?.textContent?.trim())).toEqual(
    pages.map((_, i) => (i === 0 ? 'Boilerplates' : `Boilerplates (${i + 1})`))
  );
  expect(pages.map((page) => page.querySelectorAll('[data-testid="mktg-print-page-footer"]')[1]?.textContent?.trim())).toEqual(
    pages.map((_, i) => String(3 + i).padStart(2, '0'))
  );
  expect(pages.flatMap((page) => Array.from(page.querySelectorAll('[data-testid="mktg-boilerplates-print-card-head"]'), (head) => head.textContent))).toEqual(
    lengths.map((row) => `${row.label.toUpperCase()} · 90 WORDS`)
  );
  const empty = await mount([]);
  expect(empty.root.querySelectorAll('[data-testid="mktg-boilerplates-print-page"]')).toHaveLength(1);
  expect(empty.root.querySelector('[data-testid="mktg-print-page-title"]')?.textContent?.trim()).toBe('Boilerplates');
  expect(empty.root.querySelectorAll('[data-testid="mktg-boilerplates-print-card"]')).toHaveLength(0);
});
