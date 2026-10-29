// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { MKTG_FAQ_PRINT_UNANSWERED } from '@lfx-one/shared/constants';
import { buildFaqPrintView, faqAssetOfRevision, mktgPrintBrand } from '@lfx-one/shared/utils';
import envelope from '@lfx-one/shared/utils/__fixtures__/faq-envelope.json';
import { expect, it } from 'vitest';
import { MktgFaqPrintComponent } from './mktg-faq-print.component';

it('prints grouped pairs with sources, keeps headings with the first pair and marks unanswered questions without a source', async () => {
  const asset = faqAssetOfRevision(JSON.stringify(envelope.content), envelope);
  if (!asset) throw new Error('Invalid synthetic FAQ');
  const fixture = TestBed.createComponent(MktgFaqPrintComponent);
  const brand = mktgPrintBrand(null);
  fixture.componentRef.setInput('view', buildFaqPrintView(asset, brand));
  fixture.componentRef.setInput('number', '08');
  fixture.componentRef.setInput('projectName', 'Synthetic project');
  await fixture.whenStable();
  const root: HTMLElement = fixture.nativeElement;
  expect(root.querySelector('section')?.classList.contains('break-before-page')).toBe(true);
  const pairs = root.querySelectorAll('article');
  expect(pairs).toHaveLength(4);
  pairs.forEach((pair) => {
    expect(pair.classList.contains('break-inside-avoid')).toBe(true);
    expect(pair.querySelector('h4')?.classList.contains('break-after-avoid')).toBe(true);
  });
  expect(root.querySelector('header h2')?.textContent).toContain('08');
  expect(root.querySelector('header lfx-mktg-print-chapter-header h2')?.className).toBe('lfx-print-chapter-title');
  expect(root.querySelector<HTMLElement>('header lfx-mktg-print-chapter-header')?.style.getPropertyValue('--mfp-chapter-accent')).toBe(brand.accent);
  expect(root.querySelector('header')?.classList.contains('break-after-avoid')).toBe(true);
  const head = root.querySelector('header [data-testid="mktg-print-running-head"]');
  expect(head?.textContent).toContain('Synthetic project FAQ');
  expect(head?.querySelector('img')?.getAttribute('src')).toBe(brand.logoOnLight?.src);
  expect(root.querySelectorAll('h3')).toHaveLength(2);
  expect(pairs[0].querySelector('h3')?.classList.contains('break-after-avoid')).toBe(true);
  expect(pairs[0].textContent).toContain('Source: Website');
  expect(pairs[2].textContent).toContain('How much does membership cost?');
  expect(pairs[2].textContent).toContain(MKTG_FAQ_PRINT_UNANSWERED);
  expect(pairs[2].querySelector('[data-testid="mktg-faq-print-source"]')).toBeNull();
});

it.each([false, true])('prints the document identity even with an empty first group (empty FAQ: %s)', async (empty) => {
  const asset = faqAssetOfRevision(JSON.stringify(envelope.content), envelope);
  if (!asset) throw new Error('Invalid synthetic FAQ');
  const view = buildFaqPrintView(asset, mktgPrintBrand(null));
  view.groups = empty ? [] : [{ name: 'Empty group', path: 'empty', questions: [], unanswered: 0 }, ...view.groups];
  const fixture = TestBed.createComponent(MktgFaqPrintComponent);
  fixture.componentRef.setInput('view', view);
  fixture.componentRef.setInput('number', '04');
  fixture.componentRef.setInput('projectName', 'Synthetic project');
  await fixture.whenStable();
  const root: HTMLElement = fixture.nativeElement;
  expect(root.querySelector('section')?.firstElementChild?.tagName).toBe('HEADER');
  expect(root.querySelector('header')?.textContent).toContain('Synthetic project FAQ');
  expect(root.querySelector('h2')?.textContent).toContain('04');
  expect(root.querySelectorAll('h2')).toHaveLength(1);
  expect(root.querySelectorAll('article')).toHaveLength(empty ? 0 : 4);
});
