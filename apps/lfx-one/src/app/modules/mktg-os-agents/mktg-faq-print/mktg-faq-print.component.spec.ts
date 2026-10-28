// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
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
  expect(pairs[0].querySelector('h2')?.textContent).toContain('08');
  const head = pairs[0].querySelector('[data-testid="mktg-print-running-head"]');
  expect(head?.textContent).toContain('Synthetic project FAQ');
  expect(head?.querySelector('img')?.getAttribute('src')).toBe(brand.logoOnLight?.src);
  expect(root.querySelectorAll('h3')).toHaveLength(2);
  expect(pairs[0].querySelector('h3')?.classList.contains('break-after-avoid')).toBe(true);
  expect(pairs[0].textContent).toContain('Source: Website');
  expect(pairs[2].textContent).toContain('How much does membership cost?');
  expect(pairs[2].textContent).toContain('Needs an answer');
  expect(pairs[2].querySelector('[data-testid="mktg-faq-print-source"]')).toBeNull();
});
