// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { boilerplatesAssetOfRevision, buildBoilerplatesPrintView, mktgPrintBrand } from '@lfx-one/shared/utils';
import envelope from '@lfx-one/shared/utils/__fixtures__/boilerplates.envelope.json';
import { expect, it } from 'vitest';
import { MktgBoilerplatesPrintComponent } from './mktg-boilerplates-print.component';

it('prints all four labelled lengths intact, with the title kept beside the first length', async () => {
  const asset = boilerplatesAssetOfRevision(JSON.stringify(envelope.content), envelope);
  if (!asset) throw new Error('Invalid synthetic boilerplates');
  const fixture = TestBed.createComponent(MktgBoilerplatesPrintComponent);
  const brand = mktgPrintBrand(null);
  fixture.componentRef.setInput('view', buildBoilerplatesPrintView(asset, brand));
  fixture.componentRef.setInput('number', '07');
  fixture.componentRef.setInput('projectName', 'Synthetic project');
  await fixture.whenStable();
  const root: HTMLElement = fixture.nativeElement;
  expect(root.querySelector('section')?.classList.contains('break-before-page')).toBe(true);
  const blocks = root.querySelectorAll('article');
  expect(blocks).toHaveLength(4);
  blocks.forEach((block, index) => {
    expect(block.classList.contains('break-inside-avoid')).toBe(true);
    expect(block.querySelector('h3')?.classList.contains('break-after-avoid')).toBe(true);
    expect(block.textContent).toContain(envelope.content.bp[index].l);
    expect(block.textContent).toContain(envelope.content.bp[index].t);
  });
  expect(blocks[0].querySelector('h2')?.textContent).toContain('07');
  expect(blocks[0].querySelector('lfx-mktg-print-chapter-header h2')?.className).toBe('lfx-print-chapter-title');
  const head = blocks[0].querySelector('[data-testid="mktg-print-running-head"]');
  expect(head?.textContent).toContain('Synthetic project Boilerplates');
  expect(head?.querySelector('img')?.getAttribute('src')).toBe(brand.logoOnLight?.src);
});
