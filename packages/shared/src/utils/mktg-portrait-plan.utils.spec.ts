// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import {
  brandKitLogolessFixture,
  brandKitMinimalFixture,
  brandKitOverfullFixture,
  brandKitPngOnlyFixture,
  brandKitTestRevision,
} from './__fixtures__/brand-kit-revision.fixture';
import { buildBrandKitBookView } from './brand-kit-book.utils';
import { findBrandKitChapterErrors, findBrandKitReportErrors, findBrandKitTokenErrors } from './brand-kit.utils';
import {
  brandKitPortraitPlan,
  mktgPortraitDocumentName,
  mktgPortraitFootLeft,
  mktgPortraitOpensChapter,
  mktgPortraitPlacePlan,
  mktgPortraitSectionLabel,
} from './mktg-portrait-plan.utils';

const view = buildBrandKitBookView(brandKitTestRevision(), 4);

const SVG = 'data:image/svg+xml,synthetic';
/** The synthetic kit with a symbol file too: the full seventeen pages. */
const fullView = { ...view, logos: { ...view.logos, symbol: { ref: 'symbol.svg', name: 'symbol.svg', src: SVG } } };

describe('brandKitPortraitPlan', () => {
  it('plans the mock’s seventeen pages in its order, with stable ids', () => {
    const plan = brandKitPortraitPlan(fullView, { inFamily: false });
    expect(plan).toHaveLength(17);
    expect(plan.map((page) => page.id)).toEqual([
      'cover',
      'contents',
      'logo-system',
      'logo-colorways',
      'logo-clear-space',
      'logo-symbol',
      'logo-partnership',
      'logo-watchouts',
      'color-palette',
      'color-contrast',
      'type',
      'visual-iconography',
      'visual-imagery',
      'usage',
      'voice',
      'sources',
      'back-cover',
    ]);
    expect(plan.map((page) => page.section)).toEqual([
      'Cover',
      'Contents',
      '01 Logo',
      '01 Logo',
      '01 Logo',
      '01 Logo',
      '01 Logo',
      '01 Logo',
      '02 Color',
      '02 Color',
      '03 Type',
      '04 Visual',
      '04 Visual',
      '05 Usage',
      '06 Voice',
      '07 Sources',
      'Back cover',
    ]);
    expect(plan[1].title).toBe("What's inside");
    expect(new Set(plan.map((page) => page.id)).size).toBe(17);
  });

  it('has no symbol page for a kit without a symbol file or crop: the synthetic kit’s sixteen pages', () => {
    const plan = brandKitPortraitPlan(view, { inFamily: false });
    expect(plan).toHaveLength(16);
    expect(plan.some((page) => page.id === 'logo-symbol')).toBe(false);
    expect(plan[5].id).toBe('logo-partnership');
    expect(brandKitPortraitPlan({ ...view, symbol: { ref: 'logo.svg', name: 'logo.svg', src: SVG } }, { inFamily: false })).toHaveLength(17);
  });

  it('keeps only the Logo chapter’s first page for a kit without logo files, so no frame prints empty', () => {
    // No file, so no colorway tile has artwork either (the view builder derives the tiles from the files).
    const none = {
      ...view,
      logos: { primary: null, stacked: null, symbol: null, reversed: null },
      symbol: null,
      colorways: view.colorways.map((tile) => ({ ...tile, logo: null })),
    };
    const plan = brandKitPortraitPlan(none, { inFamily: false });
    expect(plan).toHaveLength(12);
    expect(plan.filter((page) => page.section === '01 Logo').map((page) => page.id)).toEqual(['logo-system']);
    expect(plan[3].id).toBe('color-palette');
    // A kit whose only files are bitmaps (no inline src) has nothing the tiles can draw: it keeps the Logo system page,
    // whose content is the files table, and drops the pages whose content is artwork, the same twelve pages.
    const bitmaps = brandKitPortraitPlan(buildBrandKitBookView(brandKitPngOnlyFixture(), 4), { inFamily: false });
    expect(bitmaps).toHaveLength(12);
    expect(bitmaps.filter((page) => page.section === '01 Logo').map((page) => page.id)).toEqual(['logo-system']);
    // The shared logo-less fixture (the one the print-QA harness seeds) plans the same twelve pages.
    const logoless = brandKitPortraitPlan(buildBrandKitBookView(brandKitLogolessFixture(), 4), { inFamily: false });
    expect(logoless).toHaveLength(12);
    expect(logoless.filter((page) => page.section === '01 Logo').map((page) => page.id)).toEqual(['logo-system']);
  });

  it('plans the full sixteen pages for the overfull and the minimal records, both valid envelopes at the schema’s edges', () => {
    // The two records the print-QA harness prints: every fixed list at the schema's length, so `readBrandKitRevision` reads them.
    for (const fixture of [brandKitOverfullFixture(), brandKitMinimalFixture()]) {
      expect(findBrandKitTokenErrors(fixture.kit)).toEqual([]);
      expect(findBrandKitChapterErrors(fixture.chapters)).toEqual([]);
      expect(findBrandKitReportErrors(fixture.report)).toEqual([]);
      const plan = brandKitPortraitPlan(buildBrandKitBookView(fixture, 4), { inFamily: false });
      expect(plan.map((page) => page.id)).toEqual(brandKitPortraitPlan(view, { inFamily: false }).map((page) => page.id));
    }
    expect(brandKitOverfullFixture().chapters.color.palette).toHaveLength(5);
    // The longest line the agent may write, ended at a word and a full stop (never mid-word, so a print cut reads as one).
    expect(brandKitOverfullFixture().chapters.voice.line.length).toBeLessThanOrEqual(300);
    expect(brandKitOverfullFixture().chapters.voice.line.length).toBeGreaterThan(280);
    expect(brandKitOverfullFixture().chapters.voice.line).toMatch(/[a-z]\.$/);
    expect(brandKitMinimalFixture().chapters.color.palette).toHaveLength(4);
    expect(brandKitMinimalFixture().report.sources_read).toEqual([]);
  });

  it('plans each Logo page on the artwork its tiles draw: a stacked lockup alone keeps only the first page, a horizontal lockup the pages it fills', () => {
    const stackedOnly = {
      ...view,
      logos: { primary: null, stacked: { ref: 'stacked.svg', name: 'stacked.svg', src: SVG }, symbol: null, reversed: null },
      symbol: null,
      colorways: view.colorways.map((tile) => ({ ...tile, logo: null })),
    };
    expect(
      brandKitPortraitPlan(stackedOnly, { inFamily: false })
        .filter((page) => page.section === '01 Logo')
        .map((page) => page.id)
    ).toEqual(['logo-system']);
    // The horizontal lockup alone: Colorways (its tiles draw it), Clear space, Partnership and Watchouts; no symbol page.
    const primaryOnly = { ...view, logos: { ...view.logos, symbol: null, stacked: null, reversed: null }, symbol: null };
    expect(
      brandKitPortraitPlan(primaryOnly, { inFamily: false })
        .filter((page) => page.section === '01 Logo')
        .map((page) => page.id)
    ).toEqual(['logo-system', 'logo-colorways', 'logo-clear-space', 'logo-partnership', 'logo-watchouts']);
    expect(
      brandKitPortraitPlan({ ...view, logos: { ...view.logos, symbol: { ref: 'symbol.png', name: 'symbol.png', src: null } } }, { inFamily: false })
    ).toHaveLength(16);
  });

  it('inside the family drops the cover, the contents and the back cover: fourteen pages', () => {
    const plan = brandKitPortraitPlan(fullView, { inFamily: true });
    expect(plan).toHaveLength(14);
    expect(plan[0].id).toBe('logo-system');
    expect(plan[13].id).toBe('sources');
    expect(plan.some((page) => ['cover', 'contents', 'back-cover'].includes(page.id))).toBe(false);
  });

  it('marks the first page of each numbered chapter, which carries the band', () => {
    const plan = brandKitPortraitPlan(fullView, { inFamily: false });
    expect(plan.map((_, index) => mktgPortraitOpensChapter(plan, index))).toEqual([
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      true,
      true,
      false,
      true,
      true,
      true,
      false,
    ]);
    expect(mktgPortraitOpensChapter(plan, 99)).toBe(false);
  });
});

describe('the document strings', () => {
  it('names the document after its project and kind, and the footer after the project', () => {
    expect(mktgPortraitDocumentName('Synthetic project', 'brand kit')).toBe('Synthetic project brand kit');
    expect(mktgPortraitDocumentName('Synthetic project', 'positioning & brand')).toBe('Synthetic project positioning & brand');
    expect(mktgPortraitFootLeft('Synthetic project')).toBe('Synthetic project · a Linux Foundation project');
  });

  it('labels a section as the running head prints it: numbered standalone, under the document inside the family', () => {
    expect(mktgPortraitSectionLabel('01 Logo', false)).toBe('01 Logo');
    expect(mktgPortraitSectionLabel('01 Logo', true)).toBe('Brand kit · Logo');
    expect(mktgPortraitSectionLabel('Contents', true)).toBe('Brand kit · Contents');
  });
});

describe('mktgPortraitPlacePlan', () => {
  it('numbers from the book’s first page, labels as printed, and bands chapter openings standalone only', () => {
    const standalone = mktgPortraitPlacePlan(brandKitPortraitPlan(fullView, { inFamily: false }), {
      inFamily: false,
      headRight: 'Synthetic project brand kit',
      footLeft: 'Synthetic',
      firstPage: 1,
    });
    expect(standalone[0]).toEqual({ id: 'cover', section: 'Cover', title: 'Cover', number: 1, label: 'Cover', band: false });
    expect(standalone[2]).toEqual({ id: 'logo-system', section: '01 Logo', title: 'Logo system', number: 3, label: '01 Logo', band: true });
    expect(standalone[3].band).toBe(false);
    expect(standalone[16].number).toBe(17);
    const family = mktgPortraitPlacePlan(brandKitPortraitPlan(fullView, { inFamily: true }), {
      inFamily: true,
      headRight: 'Synthetic project positioning & brand',
      footLeft: 'Synthetic',
      firstPage: 17,
    });
    expect(family).toHaveLength(14);
    expect(family[0]).toEqual({ id: 'logo-system', section: '01 Logo', title: 'Logo system', number: 17, label: 'Brand kit · Logo', band: false });
    expect(family[13].number).toBe(30);
    expect(family.some((page) => page.band)).toBe(false);
  });
});
