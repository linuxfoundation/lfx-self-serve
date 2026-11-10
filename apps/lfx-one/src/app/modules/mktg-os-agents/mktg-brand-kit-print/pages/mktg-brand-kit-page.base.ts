// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Directive, input } from '@angular/core';
import { MKTG_PORTRAIT_INKS, MKTG_PORTRAIT_PAGE } from '@lfx-one/shared/constants';
import { BrandKitBookView, MktgPortraitBook, MktgPortraitLook, MktgPortraitPlacedPage, MktgPrintBrand } from '@lfx-one/shared/interfaces';

/**
 * What every page of the kit's portrait book takes from the document: the
 * kit's view and print brand (the live data), the look, the book and its
 * own placed plan page (number, printed section label, band). A page
 * component extends it and draws one of the mock's pages on the grammar;
 * a slot the view does not fill is left out of the frame.
 */
@Directive()
export abstract class MktgBrandKitPageBase {
  public readonly view = input.required<BrandKitBookView>();
  public readonly brand = input.required<MktgPrintBrand>();
  public readonly look = input.required<MktgPortraitLook>();
  public readonly book = input.required<MktgPortraitBook>();
  public readonly page = input.required<MktgPortraitPlacedPage>();
  protected readonly geometry = MKTG_PORTRAIT_PAGE;
  protected readonly inks = MKTG_PORTRAIT_INKS;
  /** The content column: x 56, width 704. */
  protected readonly x = MKTG_PORTRAIT_PAGE.margin;
  protected readonly w = MKTG_PORTRAIT_PAGE.contentWidth;
}
