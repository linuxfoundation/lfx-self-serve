// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { MKTG_FAMILY_PRINT_FRAME, MKTG_FAMILY_PRINT_NEUTRALS, MKTG_FAMILY_PRINT_PAGE_NAME } from '@lfx-one/shared/constants';
import { MktgFamilyPrintPage, MktgPrintBrand } from '@lfx-one/shared/interfaces';
import { mktgFamilyPrintPad } from '@lfx-one/shared/utils';

/**
 * One fixed US Letter frame of the family book (816 × 1056 px, CSS Paged
 * Media Level 3: the page is the frame, nothing flows across it). A full
 * page carries the running head (the section left, the family right), the
 * title and the footer (the project left, the page number right); a bare
 * page (cover, opener, back cover) carries only its content, on the dark.
 */
@Component({
  selector: 'lfx-mktg-family-print-frame',
  templateUrl: './mktg-family-print-frame.component.html',
  // The book's styles are global (styles/mktg-family-print.scss, under .fp-frame): the pages' content lives in other components.
  host: {
    class: 'fp-frame',
    '[class.fp-frame--dark]': 'dark()',
    '[style.--fp-dark]': 'brand().dark',
    '[style.--fp-accent]': 'brand().accent',
    '[style.--fp-on-dark]': 'brand().onDark',
    '[style.--fp-font]': 'brand().fontStack',
    '[style.--fp-ink]': 'neutrals.ink',
    '[style.--fp-muted]': 'neutrals.muted',
    '[style.--fp-hair]': 'neutrals.hairline',
    '[style.--fp-mist]': 'neutrals.mist',
    '[style.--fp-warn]': 'neutrals.warn',
    '[style.width.px]': 'frame.width',
    '[style.height.px]': 'frame.height',
    '[style.page]': 'pageName',
    '[attr.data-page]': 'page().n',
    '[attr.data-section]': 'page().section',
    '[attr.data-kind]': 'page().kind',
    'data-testid': 'family-print-frame',
  },
})
export class MktgFamilyPrintFrameComponent {
  public readonly page = input.required<MktgFamilyPrintPage>();
  public readonly brand = input.required<MktgPrintBrand>();
  /** The running head's right label: `AAIF positioning & brand`. */
  public readonly headRight = input('');
  /** The footer's left label: `Agentic AI Foundation · a Linux Foundation project`. */
  public readonly footLeft = input('');
  /** The dark ground (the cover, the openers, the back cover); the white pages otherwise. */
  public readonly dark = input(false);
  /** No running head, title or footer: the content owns the whole frame. */
  public readonly bare = input(false);

  public readonly frame = MKTG_FAMILY_PRINT_FRAME;
  public readonly neutrals = MKTG_FAMILY_PRINT_NEUTRALS;
  public readonly pageName = MKTG_FAMILY_PRINT_PAGE_NAME;

  public readonly pageNumber: Signal<string> = this.initPageNumber();

  private initPageNumber(): Signal<string> {
    return computed(() => mktgFamilyPrintPad(this.page().n));
  }
}
