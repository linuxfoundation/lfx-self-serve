// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { brandKitTestRevision } from './__fixtures__/brand-kit-revision.fixture';
import { buildBrandKitBookView } from './brand-kit-book.utils';
import {
  brandKitPortraitPlan,
  mktgPortraitDocumentName,
  mktgPortraitFootLeft,
  mktgPortraitOpensChapter,
  mktgPortraitSectionLabel,
} from './mktg-portrait-plan.utils';

const view = buildBrandKitBookView(brandKitTestRevision(), 4);

describe('brandKitPortraitPlan', () => {
  it('plans the mock’s seventeen pages in its order, with stable ids', () => {
    const plan = brandKitPortraitPlan(view, { inFamily: false });
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
    expect(plan[2]).toEqual({ id: 'logo-system', section: '01 Logo', title: 'Logo system' });
    expect(plan[1].title).toBe("What's inside");
    expect(new Set(plan.map((page) => page.id)).size).toBe(17);
    // Seven numbered chapters, in order.
    expect([...new Set(plan.map((page) => page.section).filter((section) => /^\d\d /.test(section)))]).toEqual([
      '01 Logo',
      '02 Color',
      '03 Type',
      '04 Visual',
      '05 Usage',
      '06 Voice',
      '07 Sources',
    ]);
  });

  it('inside the family drops the cover, the contents and the back cover: fourteen pages', () => {
    const plan = brandKitPortraitPlan(view, { inFamily: true });
    expect(plan).toHaveLength(14);
    expect(plan[0].id).toBe('logo-system');
    expect(plan[13].id).toBe('sources');
    expect(plan.some((page) => ['cover', 'contents', 'back-cover'].includes(page.id))).toBe(false);
  });

  it('marks the first page of each numbered chapter, which carries the band', () => {
    const plan = brandKitPortraitPlan(view, { inFamily: false });
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
