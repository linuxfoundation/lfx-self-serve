// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { MKTG_PRINT_LANDSCAPE_CLASS } from '@lfx-one/shared/constants';
import { mktgPrintBrand, mktgPrintMixHex, mktgPrintPageLook } from '@lfx-one/shared/utils';
import { expect, it } from 'vitest';
import { MktgPrintDividerComponent } from './mktg-print-divider.component';

/** A `#RRGGBB` colour as the DOM reads an inline style back. */
function rgb(hex: string): string {
  return `rgb(${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
}

it('prints a section divider on one dark landscape frame: the eyebrow in the accent, the title, the softened count line, the lockup, no number and no footer', async () => {
  const brand = { ...mktgPrintBrand(null), dark: '#0F172A', accent: '#F97316', logoOnDark: { src: 'data:image/svg+xml,logo', alt: 'Synthetic', filter: '' } };
  const look = mktgPrintPageLook(brand);
  const fixture = TestBed.createComponent(MktgPrintDividerComponent);
  fixture.componentRef.setInput('brand', brand);
  fixture.componentRef.setInput('part', 'faq');
  fixture.componentRef.setInput('partNumber', '04');
  fixture.componentRef.setInput('count', 12);
  fixture.componentRef.setInput('familyName', 'Positioning & brand');
  await fixture.whenStable();
  const root: HTMLElement = fixture.nativeElement;
  expect(root.classList.contains(MKTG_PRINT_LANDSCAPE_CLASS)).toBe(true);
  const frame = root.querySelector<HTMLElement>('[data-testid="mktg-print-page"]');
  expect(frame?.getAttribute('data-layout')).toBe('cover');
  expect(frame?.classList.contains('lfx-print-page--dark')).toBe(true);
  expect(frame?.style.getPropertyValue('--pp-dark')).toBe('#0F172A');
  const els = root.querySelectorAll<HTMLElement>('[data-testid="mktg-print-page-el"]');
  expect(els).toHaveLength(4);
  expect(els[0].textContent?.trim()).toBe('04 · POSITIONING & BRAND');
  expect(els[0].querySelector<HTMLElement>('.pp-para--caps')?.style.color).toBe(rgb('#F97316'));
  expect(els[1].textContent?.trim()).toBe('Questions and answers');
  expect(els[1].querySelector<HTMLElement>('.pp-rich')?.style.color).toBe(rgb(look.onDark));
  expect(els[2].textContent?.trim()).toBe('12 questions and answers');
  expect(els[2].querySelector<HTMLElement>('.pp-rich')?.style.color).toBe(rgb(mktgPrintMixHex(look.onDark, look.dark, 0.3)));
  expect(els[3].querySelector('img')?.getAttribute('src')).toBe('data:image/svg+xml,logo');
  // Counted in the deck-wide numbering, it shows no number, no running head and an empty title band.
  expect(root.querySelector('[data-testid="mktg-print-page-head"]')).toBeNull();
  expect(root.querySelector('[data-testid="mktg-print-page-footer"]')).toBeNull();
  expect(root.querySelector('[data-testid="mktg-print-page-title"]')?.textContent?.trim()).toBe('');

  fixture.componentRef.setInput('brand', { ...brand, logoOnDark: null });
  fixture.componentRef.setInput('part', 'boilerplates');
  fixture.componentRef.setInput('partNumber', '03');
  fixture.componentRef.setInput('count', 1);
  await fixture.whenStable();
  const again = root.querySelectorAll<HTMLElement>('[data-testid="mktg-print-page-el"]');
  expect(again).toHaveLength(3);
  expect(again[1].textContent?.trim()).toBe('Boilerplates');
  expect(again[2].textContent?.trim()).toBe('1 boilerplate');
});
