// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { mktgPrintBrand } from '@lfx-one/shared/utils';
import { expect, it } from 'vitest';
import { MktgPrintRunningHeadComponent } from './mktg-print-running-head.component';

it('shares the framework strip tokens and draws the project label and brand logo, or the version without artwork', async () => {
  const brand = mktgPrintBrand(null);
  const fixture = TestBed.createComponent(MktgPrintRunningHeadComponent);
  fixture.componentRef.setInput('brand', brand);
  fixture.componentRef.setInput('label', 'Synthetic project FAQ');
  fixture.componentRef.setInput('versionLabel', 'Version 2');
  await fixture.whenStable();
  const root: HTMLElement = fixture.nativeElement;
  const head = root.querySelector('[data-testid="mktg-print-running-head"]');
  expect(head?.textContent).toContain('Synthetic project FAQ');
  expect(head?.textContent).not.toContain('Version 2');
  expect(head?.classList.contains('text-[7.5pt]')).toBe(true);
  expect(head?.classList.contains('border-black/10')).toBe(true);
  expect(head?.querySelector('img')?.getAttribute('src')).toBe(brand.logoOnLight?.src);
  expect(head?.querySelector('img')?.getAttribute('alt')).toBe(brand.logoOnLight?.alt);
  expect(head?.querySelector('img')?.classList.contains('h-[16pt]')).toBe(true);
  expect(root.classList.contains('break-after-avoid')).toBe(true);

  fixture.componentRef.setInput('brand', { ...brand, logoOnLight: null });
  await fixture.whenStable();
  expect(head?.querySelector('img')).toBeNull();
  expect(head?.textContent).toContain('Version 2');

  fixture.componentRef.setInput('versionLabel', '');
  await fixture.whenStable();
  expect(head?.querySelectorAll('span')).toHaveLength(1);
});
