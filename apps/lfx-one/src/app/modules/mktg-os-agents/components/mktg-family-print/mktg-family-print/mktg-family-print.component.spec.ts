// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { MKTG_FAMILY_PRINT_BOOK_CLASS, MKTG_KIT_POSITIONING_FAMILY_ID, MKTG_PRINT_INK_ON_LIGHT } from '@lfx-one/shared/constants';
import { MktgFamilyPrintView } from '@lfx-one/shared/interfaces';
import {
  boilerplatesAssetOfRevision,
  buildBoilerplatesPrintView,
  buildFaqPrintView,
  faqAssetOfRevision,
  mktgFamilyPrintDocument,
  mktgPrintBrand,
} from '@lfx-one/shared/utils';
import boilerplatesEnvelope from '@lfx-one/shared/utils/__fixtures__/boilerplates.envelope.json';
import faqEnvelope from '@lfx-one/shared/utils/__fixtures__/faq-envelope.json';
import { describe, expect, it } from 'vitest';
import { MktgFamilyPrintComponent } from './mktg-family-print.component';

/** A family with the boilerplates and the FAQ approved; no framework, no kit. */
function view(): MktgFamilyPrintView {
  const brand = mktgPrintBrand(null);
  const boilerplates = boilerplatesAssetOfRevision(JSON.stringify(boilerplatesEnvelope.content), boilerplatesEnvelope);
  const faq = faqAssetOfRevision(JSON.stringify(faqEnvelope.content), faqEnvelope);
  if (!boilerplates || !faq) throw new Error('Invalid synthetic assets');
  const approval = { approvedAt: '2026-11-06T18:00:00Z', approvedBy: { name: 'Synthetic Approver' } };
  return {
    framework: null,
    kit: null,
    kitApproval: null,
    boilerplates: buildBoilerplatesPrintView(boilerplates, brand),
    faq: buildFaqPrintView(faq, brand),
    brand,
    projectName: 'Synthetic project',
    printedAt: '2026-11-07T00:00:00Z',
    newestRevisionAt: null,
    fontFamily: null,
    weights: [400],
    documents: [
      mktgFamilyPrintDocument(MKTG_KIT_POSITIONING_FAMILY_ID, 'boilerplates', 1, 2, approval, boilerplates.report.gaps),
      mktgFamilyPrintDocument(MKTG_KIT_POSITIONING_FAMILY_ID, 'faq', 2, 16, { approvedAt: '2026-11-06T18:00:00Z', approvedBy: null }, []),
    ],
    tagline: '',
    websiteLabel: '',
    boilerplatesSources: [],
    conflicts: [],
  };
}

async function render(value: MktgFamilyPrintView) {
  const fixture = TestBed.createComponent(MktgFamilyPrintComponent);
  fixture.componentRef.setInput('view', value);
  fixture.componentRef.setInput('familyName', 'Positioning & brand');
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

/** The book's frames, by the portrait grammar's contract. */
function pages(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-testid="lfx-mktg-portrait-page"]'));
}

function page(root: HTMLElement, id: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-testid="lfx-mktg-portrait-page"][data-page-id="${id}"]`);
}

/** The component's stylesheet as the engine applies it: the `<style>` the renderer adds to the head for its rules. */
function coverStyle(): string {
  return Array.from(document.head.querySelectorAll('style'))
    .map((style) => style.textContent ?? '')
    .filter((text) => text.includes('.fpc-purpose'))
    .join('\n');
}

describe('MktgFamilyPrintComponent', () => {
  it('prints the plan’s frames in order for the members the view holds, and nothing for the ones it lacks', async () => {
    const root = await render(view());
    // A block host (MKTG_PORTRAIT_BLOCK_HOST): Chrome 156 breaks a sheet at the anonymous-block boundary an inline host puts around a frame.
    expect(getComputedStyle(root).display).toBe('block');
    expect(root.classList.contains('lfx-mktg-portrait')).toBe(true);
    // The family's own root class beside the grammar's: the one rule over every running head in the book hangs on it.
    expect(root.classList.contains(MKTG_FAMILY_PRINT_BOOK_CLASS)).toBe(true);
    // 1 cover · 2 contents · 3 opener · 4 boilerplates · 5 opener · 6 FAQ · 7 Sources · 8 back cover, every one a frame of the grammar.
    expect(pages(root).map((frame) => [frame.dataset['pageId'], frame.dataset['page']])).toEqual([
      ['cover', '1'],
      ['contents', '2'],
      ['opener-boilerplates', '3'],
      ['boilerplates', '4'],
      ['opener-faq', '5'],
      ['faq-1', '6'],
      ['sources', '7'],
      ['back-cover', '8'],
    ]);
    expect(root.querySelector('lfx-mktg-framework-print, lfx-mktg-brand-kit-print')).toBeNull();
    // The frames' footers number the pages the grammar's way; the openers, cover and back cover are bare.
    expect(Array.from(root.querySelectorAll('[data-testid="mktg-portrait-page-number"]')).map((n) => n.textContent?.trim())).toEqual(['02', '04', '06', '07']);
    expect(pages(root).map((frame) => frame.querySelector('[data-testid="mktg-portrait-page-doc"]')?.textContent)).toContain(
      'Synthetic project positioning & brand'
    );
    expect(root.querySelector('[data-testid="family-print-contents-intro"]')?.textContent).toContain('2 documents, 8 pages.');
    expect(Array.from(root.querySelectorAll('[data-testid="family-print-contents-opener-page"]')).map((n) => n.textContent)).toEqual(['3', '5']);
    // The contents' blocks are the layout's: one per chapter here, by the board's split, every entry shown, nothing continued or cut.
    expect(Array.from(root.querySelectorAll('[data-testid="family-print-contents-chapter"]')).map((block) => block.getAttribute('data-continued'))).toEqual([
      null,
      null,
    ]);
    expect(Array.from(root.querySelectorAll('[data-testid="family-print-contents-entry"]')).map((entry) => entry.textContent)).toEqual([
      'Boilerplates4',
      'Frequently asked questions6',
    ]);
    expect(root.querySelector('[data-testid="family-print-contents-cut"]')).toBeNull();
    const openerMeta = Array.from(root.querySelectorAll('[data-testid="mktg-portrait-opener-meta"]')).map((meta) =>
      Array.from(meta.querySelectorAll('dt, dd'))
        .map((cell) => cell.textContent?.trim())
        .join(' ')
    );
    // The Approved cell is the date alone; the approver's name is the kit's own Sources page's.
    expect(openerMeta).toEqual(['Version V2.0 Approved 6 Nov 2026 Pages 4', 'Version V16.0 Approved 6 Nov 2026 Pages 6']);
    expect(root.querySelector('[data-testid="family-print-contents-sources"]')?.textContent).toContain('7');
    // One version format everywhere: the contents rows and the cover's tiles (version and date in one line).
    expect(root.querySelector('[data-testid="family-print-contents-chapter"]')?.textContent).toContain('V2.0');
    expect(Array.from(root.querySelectorAll('[data-testid="family-print-cover-documents"] .fpc-doc__meta')).map((meta) => meta.textContent)).toEqual([
      'V2.0 · 6 Nov 2026',
      'V16.0 · 6 Nov 2026',
    ]);
  });

  it('omits what the view does not give: no tagline, no site, no conflicts; the back cover keeps the notice', async () => {
    const root = await render(view());
    expect(root.querySelector('[data-testid="family-print-cover-tagline"]')).toBeNull();
    expect(root.querySelector('[data-testid="family-print-cover-logo"]')?.getAttribute('src')).toBe(mktgPrintBrand(null).logoOnDark?.src);
    expect(page(root, 'cover')?.querySelector('[data-testid="family-print-cover-strip"]')?.textContent?.trim()).toBe(
      'Synthetic project · a Linux Foundation project7 Nov 2026'
    );
    expect(page(root, 'cover')?.classList.contains('pp-page--dark')).toBe(true);
    expect(page(root, 'back-cover')?.classList.contains('pp-page--dark')).toBe(true);
    expect(root.querySelector('[data-testid="family-print-sources-conflicts"]')).toBeNull();
    expect(root.querySelector('[data-testid="family-print-sources-open"]')?.textContent).toContain('The launch year is not stated.');
    expect(root.querySelector('[data-testid="mktg-portrait-back-cover-notice"]')?.textContent).toContain(
      'Synthetic project and its logo are trademarks of the Linux Foundation.'
    );
    expect(root.textContent).not.toMatch(/\[[A-Z][a-z]+\]/);
  });

  it('prints a cover, a contents page and a back cover alone when no member has an approved current', async () => {
    const root = await render({ ...view(), boilerplates: null, faq: null, documents: [] });
    expect(pages(root).map((frame) => frame.dataset['pageId'])).toEqual(['cover', 'contents', 'back-cover']);
    expect(root.querySelector('[data-testid="family-print-contents-intro"]')?.textContent).toContain('0 documents, 3 pages.');
    expect(root.querySelector('[data-testid="family-print-contents-sources"]')).toBeNull();
  });

  it('mixes the cover’s purpose, tile meta and rules from the ink the grammar selected for the cover ground, so a light ground gets dark ink', async () => {
    // A kit whose "dark" is light: the brand's contrast rule picks the dark ink for it, and the cover's secondary inks follow that ink.
    const brand = { ...mktgPrintBrand(null), dark: '#F4F4F4', onDark: MKTG_PRINT_INK_ON_LIGHT };
    const root = await render({ ...view(), brand });
    const cover = page(root, 'cover');
    expect(cover?.style.getPropertyValue('--pp-on-dark')).toBe(MKTG_PRINT_INK_ON_LIGHT);
    expect(cover?.style.getPropertyValue('--pp-dark')).toBe('#F4F4F4');
    const style = coverStyle();
    expect(style).toContain('color-mix(in srgb, var(--pp-on-dark) 75%, transparent)');
    expect(style).toContain('color-mix(in srgb, var(--pp-on-dark) 60%, transparent)');
    expect(style).toContain('color-mix(in srgb, var(--pp-on-dark) 30%, transparent)');
    // No fixed translucent white anywhere on the cover: every secondary ink derives from the selected one.
    expect(style).not.toMatch(/rgba\(\s*255\s*,\s*255\s*,\s*255/);
    expect(style).not.toMatch(/#fff\b/i);
  });
});
