// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { reflectComponentType, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrandKitBookView, MktgPortraitBook, MktgPortraitPlacedPage } from '@lfx-one/shared/interfaces';
import { brandKitPortraitPlan, buildBrandKitBookView, mktgPortraitLook, mktgPortraitPlacePlan, mktgPrintBrand } from '@lfx-one/shared/utils';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { MktgBrandKitPageBase } from './mktg-brand-kit-page.base';

export const SYNTHETIC_BOOK: MktgPortraitBook = {
  inFamily: false,
  headRight: 'Project One brand kit',
  footLeft: 'Project One · a Linux Foundation project',
  firstPage: 1,
};

/** The synthetic kit's placed plan, standalone. */
export function syntheticPlacedPlan(view: BrandKitBookView, book: MktgPortraitBook = SYNTHETIC_BOOK): MktgPortraitPlacedPage[] {
  return mktgPortraitPlacePlan(brandKitPortraitPlan(view, { inFamily: book.inFamily }), book);
}

/**
 * Mounts one kit page component on the synthetic kit (version 4), at its
 * plan page, and returns the frame. `edit` changes the view before mounting
 * (a kit without a file, say).
 */
export async function mountBrandKitPage<T extends MktgBrandKitPageBase>(
  component: Type<T>,
  pageId: string,
  edit: (view: BrandKitBookView) => BrandKitBookView = (view) => view
) {
  const kit = brandKitTestRevision();
  const view = edit(buildBrandKitBookView(kit, 4));
  const brand = mktgPrintBrand(kit);
  const pages = syntheticPlacedPlan(view);
  const page = pages.find((entry) => entry.id === pageId);
  if (!page) throw new Error(`Missing synthetic plan page ${pageId}`);
  const fixture = TestBed.createComponent(component);
  fixture.componentRef.setInput('view', view);
  fixture.componentRef.setInput('brand', brand);
  const look = mktgPortraitLook(brand, view.spark);
  fixture.componentRef.setInput('look', look);
  fixture.componentRef.setInput('book', SYNTHETIC_BOOK);
  fixture.componentRef.setInput('page', page);
  // The contents page lists the plan: it takes the placed pages too.
  if (reflectComponentType(component)?.inputs.some((entry) => entry.propName === 'pages')) fixture.componentRef.setInput('pages', pages);
  await fixture.whenStable();
  const root: HTMLElement = fixture.nativeElement;
  const frame = root.querySelector<HTMLElement>('[data-testid="lfx-mktg-portrait-page"]');
  if (!frame) throw new Error('Missing synthetic frame');
  return { kit, view, brand, look, pages, page, fixture, root, frame };
}

/** The `[lfxPpRect]` host of an element: its placement on the frame. */
export function rectOf(element: Element | null): { left: string; top: string; width: string } {
  const host = element?.closest<HTMLElement>('.pp-r');
  return { left: host?.style.left ?? '', top: host?.style.top ?? '', width: host?.style.width ?? '' };
}

/**
 * An element's text as words, one space between them whatever the markup's whitespace: the template formatter puts
 * no whitespace between sibling elements and may break an inline text onto its own line, so `textContent` is not
 * what the reader sees.
 */
export function wordsOf(element: Element | null): string {
  if (!element) return '';
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const words: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.replace(/\s+/g, ' ').trim();
    if (text) words.push(text);
  }
  return words.join(' ');
}
