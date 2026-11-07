// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Type } from '@angular/core';
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
  fixture.componentRef.setInput('look', mktgPortraitLook(brand, view.spark));
  fixture.componentRef.setInput('book', SYNTHETIC_BOOK);
  fixture.componentRef.setInput('page', page);
  await fixture.whenStable();
  const root: HTMLElement = fixture.nativeElement;
  const frame = root.querySelector<HTMLElement>('[data-testid="lfx-mktg-portrait-page"]');
  if (!frame) throw new Error('Missing synthetic frame');
  return { kit, view, brand, pages, page, fixture, root, frame };
}

/** The `[lfxPpRect]` host of an element: its placement on the frame. */
export function rectOf(element: Element | null): { left: string; top: string; width: string } {
  const host = element?.closest<HTMLElement>('.pp-r');
  return { left: host?.style.left ?? '', top: host?.style.top ?? '', width: host?.style.width ?? '' };
}
