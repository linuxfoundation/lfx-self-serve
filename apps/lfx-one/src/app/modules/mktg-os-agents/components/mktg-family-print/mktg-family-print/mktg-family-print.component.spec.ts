// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { MKTG_KIT_POSITIONING_FAMILY_ID } from '@lfx-one/shared/constants';
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
    boilerplatesNotes: [],
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

describe('MktgFamilyPrintComponent', () => {
  it('prints the plan’s frames in order for the members the view holds, and nothing for the ones it lacks', async () => {
    const root = await render(view());
    expect(Array.from(root.children).map((child) => child.getAttribute('data-testid'))).toEqual([
      'family-print-cover',
      'family-print-contents',
      'family-print-opener',
      'family-print-boilerplates',
      'family-print-opener',
      'family-print-faq',
      'family-print-sources',
      'family-print-back-cover',
    ]);
    expect(root.querySelector('lfx-mktg-framework-print, lfx-mktg-brand-kit-print')).toBeNull();
    // 1 cover · 2 contents · 3 opener · 4 boilerplates · 5 opener · 6 FAQ · 7 Sources · 8 back cover
    expect(Array.from(root.querySelectorAll('[data-testid="family-print-frame"]')).map((frame) => frame.getAttribute('data-page'))).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
    ]);
    expect(Array.from(root.querySelectorAll('[data-testid="family-print-page-number"]')).map((n) => n.textContent)).toEqual(['02', '04', '06', '07']);
    expect(root.querySelector('[data-testid="family-print-contents-intro"]')?.textContent).toContain('2 documents, 8 pages.');
    expect(Array.from(root.querySelectorAll('[data-testid="family-print-contents-opener-page"]')).map((n) => n.textContent)).toEqual(['3', '5']);
    expect(Array.from(root.querySelectorAll('[data-testid="family-print-opener-pages"]')).map((n) => n.textContent)).toEqual(['4', '6']);
    expect(root.querySelector('[data-testid="family-print-contents-sources"]')?.textContent).toContain('7');
  });

  it('omits what the view does not give: no tagline, no site, no approver, no conflicts; the back cover keeps the notice', async () => {
    const root = await render(view());
    expect(root.querySelector('[data-testid="family-print-cover-tagline"]')).toBeNull();
    expect(root.querySelector('[data-testid="family-print-cover-logo"]')?.getAttribute('src')).toBe(mktgPrintBrand(null).logoOnDark?.src);
    expect(root.querySelector('[data-testid="family-print-cover"]')?.textContent).toContain('7 Nov 2026');
    expect(root.querySelector('[data-testid="family-print-cover"]')?.textContent).not.toContain('·  7 Nov');
    const openers = Array.from(root.querySelectorAll('[data-testid="family-print-opener"]'));
    expect(openers[0].querySelector('[data-testid="family-print-opener-approver"]')?.textContent).toBe('Synthetic Approver');
    expect(openers[1].querySelector('[data-testid="family-print-opener-approver"]')).toBeNull();
    expect(root.querySelector('[data-testid="family-print-sources-conflicts"]')).toBeNull();
    expect(root.querySelector('[data-testid="family-print-sources-open"]')?.textContent).toContain('The launch year is not stated.');
    expect(root.querySelector('[data-testid="family-print-back-cover-notice"]')?.textContent).toContain(
      'Synthetic project and its logo are trademarks of the Linux Foundation.'
    );
    expect(root.textContent).not.toMatch(/\[[A-Z][a-z]+\]/);
  });

  it('prints a cover, a contents page and a back cover alone when no member has an approved current', async () => {
    const root = await render({ ...view(), boilerplates: null, faq: null, documents: [] });
    expect(Array.from(root.children).map((child) => child.getAttribute('data-testid'))).toEqual([
      'family-print-cover',
      'family-print-contents',
      'family-print-back-cover',
    ]);
    expect(root.querySelector('[data-testid="family-print-contents-intro"]')?.textContent).toContain('0 documents, 3 pages.');
    expect(root.querySelector('[data-testid="family-print-contents-sources"]')).toBeNull();
  });
});
