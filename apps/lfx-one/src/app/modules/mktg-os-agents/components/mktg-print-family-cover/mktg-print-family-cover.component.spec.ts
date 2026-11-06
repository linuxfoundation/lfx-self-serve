// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MKTG_PRINT_LANDSCAPE_CLASS } from '@lfx-one/shared/constants';
import { MktgFamilyPrintView } from '@lfx-one/shared/interfaces';
import { mktgPrintBrand } from '@lfx-one/shared/utils';
import { expect, it } from 'vitest';
import { MktgPrintCoverComponent } from '../mktg-print-cover/mktg-print-cover.component';
import { MktgPrintFamilyCoverComponent } from './mktg-print-family-cover.component';

function view(overrides: Partial<MktgFamilyPrintView> = {}): MktgFamilyPrintView {
  const brand = { ...mktgPrintBrand(null), logoOnDark: { src: 'data:image/svg+xml,logo', alt: 'Synthetic project', filter: '' } };
  return {
    framework: null,
    kit: null,
    boilerplates: { brand, lengths: [] },
    faq: { brand, groups: [] },
    brand,
    projectName: 'Synthetic project',
    printedAt: '2026-11-06T00:00:00Z',
    newestRevisionAt: '2026-10-21T10:00:00Z',
    revisionNumbers: { boilerplates: 2, faq: 1 },
    fontFamily: null,
    weights: [400],
    ...overrides,
  };
}

it("prints the deck's cover with the family's strings at 40 pt on the dark ground, the lockup alone, and no page number", async () => {
  const fixture = TestBed.createComponent(MktgPrintFamilyCoverComponent);
  fixture.componentRef.setInput('view', view());
  fixture.componentRef.setInput('familyName', 'Positioning & brand');
  await fixture.whenStable();
  const root: HTMLElement = fixture.nativeElement;
  expect(root.classList.contains(MKTG_PRINT_LANDSCAPE_CLASS)).toBe(true);
  const cover = fixture.debugElement.query(By.directive(MktgPrintCoverComponent)).componentInstance as MktgPrintCoverComponent;
  expect(cover.titleSize()).toBe(40);
  expect(cover.logo()).toEqual(view().brand.logoOnDark);
  // The cover draws the lockup at its own box: the wrapper passes the logo alone and no box (D1 §4 is the cover's default).
  expect((cover as unknown as Record<string, unknown>)['logoBox']).toBeUndefined();
  const frame = root.querySelector<HTMLElement>('[data-testid="mktg-print-page"]');
  expect(frame?.getAttribute('data-layout')).toBe('cover');
  expect(frame?.classList.contains('lfx-print-page--dark')).toBe(true);
  expect(root.querySelector('[data-testid="mktg-print-page-title"]')?.textContent?.trim()).toBe('Positioning & brand');
  // No brand line and no framework: the parts present, in words.
  expect(root.querySelector('[data-testid="mktg-print-page-subtitle"]')?.textContent?.trim()).toBe('Boilerplates · Questions and answers');
  const els = Array.from(root.querySelectorAll<HTMLElement>('[data-testid="mktg-print-page-el"]'));
  const texts = els.map((el) => el.textContent?.trim() ?? '');
  expect(texts).toEqual([
    'SYNTHETIC PROJECT · A LINUX FOUNDATION PROJECT',
    'October 2026',
    'Synthetic project · a Linux Foundation project',
    'Boilerplates v2 · FAQ v1',
    '',
  ]);
  expect(els[4].querySelector('img')?.getAttribute('src')).toBe('data:image/svg+xml,logo');
  expect(root.querySelector('[data-testid="mktg-print-page-footer"]')).toBeNull();
  expect(root.querySelector('[data-testid="mktg-print-page-head"]')).toBeNull();

  // A line the data does not carry, and a lockup the kit has none of, are not drawn.
  const brand = { ...view().brand, logoOnDark: null };
  fixture.componentRef.setInput('view', view({ brand, revisionNumbers: {}, newestRevisionAt: null, printedAt: 'not a date' }));
  await fixture.whenStable();
  const fewer = Array.from(root.querySelectorAll<HTMLElement>('[data-testid="mktg-print-page-el"]')).map((el) => el.textContent?.trim());
  expect(fewer).toEqual(['SYNTHETIC PROJECT · A LINUX FOUNDATION PROJECT', 'Synthetic project · a Linux Foundation project']);
});
