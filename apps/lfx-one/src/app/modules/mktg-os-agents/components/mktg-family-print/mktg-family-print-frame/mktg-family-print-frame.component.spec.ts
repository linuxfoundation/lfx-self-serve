// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { MKTG_FAMILY_PRINT_FRAME, MKTG_FAMILY_PRINT_NEUTRALS, MKTG_FAMILY_PRINT_PAGE_NAME } from '@lfx-one/shared/constants';
import { MktgFamilyPrintPage } from '@lfx-one/shared/interfaces';
import { mktgPrintBrand } from '@lfx-one/shared/utils';
import { describe, expect, it } from 'vitest';
import { MktgFamilyPrintFrameComponent } from './mktg-family-print-frame.component';

const page: MktgFamilyPrintPage = {
  n: 13,
  kind: 'boilerplates',
  section: '03 Boilerplates',
  title: 'Boilerplates',
  agentKey: 'boilerplates',
  index: 0,
  span: 1,
};

describe('MktgFamilyPrintFrameComponent', () => {
  it('is one fixed US Letter page in the brand, with the running head, the title and the numbered footer', async () => {
    const brand = mktgPrintBrand(null);
    const fixture = TestBed.createComponent(MktgFamilyPrintFrameComponent);
    fixture.componentRef.setInput('page', page);
    fixture.componentRef.setInput('brand', brand);
    fixture.componentRef.setInput('headRight', 'Positioning & brand');
    fixture.componentRef.setInput('footLeft', 'Synthetic project · a Linux Foundation project');
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.classList.contains('fp-frame')).toBe(true);
    expect(root.classList.contains('fp-frame--dark')).toBe(false);
    expect(root.style.width).toBe(`${MKTG_FAMILY_PRINT_FRAME.width}px`);
    expect(root.style.height).toBe(`${MKTG_FAMILY_PRINT_FRAME.height}px`);
    expect(root.style.getPropertyValue('page')).toBe(MKTG_FAMILY_PRINT_PAGE_NAME);
    expect(root.style.getPropertyValue('--fp-dark')).toBe(brand.dark);
    expect(root.style.getPropertyValue('--fp-accent')).toBe(brand.accent);
    expect(root.style.getPropertyValue('--fp-font')).toBe(brand.fontStack);
    expect(root.style.getPropertyValue('--fp-ink')).toBe(MKTG_FAMILY_PRINT_NEUTRALS.ink);
    expect(root.style.getPropertyValue('--fp-warn')).toBe(MKTG_FAMILY_PRINT_NEUTRALS.warn);
    expect(root.getAttribute('data-page')).toBe('13');
    expect(root.getAttribute('data-section')).toBe('03 Boilerplates');
    expect(root.getAttribute('data-kind')).toBe('boilerplates');
    const head = root.querySelector('[data-testid="family-print-running-head"]');
    expect(Array.from(head?.querySelectorAll('span') ?? []).map((span) => span.textContent)).toEqual(['03 Boilerplates', 'Positioning & brand']);
    expect(root.querySelector('[data-testid="family-print-page-title"]')?.textContent).toBe('Boilerplates');
    const foot = root.querySelector('[data-testid="family-print-footer"]');
    expect(foot?.textContent).toContain('Synthetic project · a Linux Foundation project');
    expect(root.querySelector('[data-testid="family-print-page-number"]')?.textContent).toBe('13');
  });

  it('prints a bare dark page with no chrome: the cover, the openers and the back cover own their frame', async () => {
    const fixture = TestBed.createComponent(MktgFamilyPrintFrameComponent);
    fixture.componentRef.setInput('page', { ...page, n: 1, kind: 'cover', section: 'Cover', title: '' });
    fixture.componentRef.setInput('brand', mktgPrintBrand(null));
    fixture.componentRef.setInput('dark', true);
    fixture.componentRef.setInput('bare', true);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.classList.contains('fp-frame--dark')).toBe(true);
    expect(root.querySelector('[data-testid="family-print-running-head"]')).toBeNull();
    expect(root.querySelector('[data-testid="family-print-page-title"]')).toBeNull();
    expect(root.querySelector('[data-testid="family-print-footer"]')).toBeNull();
  });

  it('pads the page number to two digits and omits a blank title', async () => {
    const fixture = TestBed.createComponent(MktgFamilyPrintFrameComponent);
    fixture.componentRef.setInput('page', { ...page, n: 2, title: '' });
    fixture.componentRef.setInput('brand', mktgPrintBrand(null));
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[data-testid="family-print-page-number"]')?.textContent).toBe('02');
    expect(root.querySelector('[data-testid="family-print-page-title"]')).toBeNull();
    expect(root.querySelector('[data-testid="family-print-running-head"]')?.querySelectorAll('span')).toHaveLength(1);
  });
});
