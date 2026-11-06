// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import {
  MKTG_PRINT_LANDSCAPE_CLASS,
  MKTG_PRINT_PAGE_COVER_EYEBROW_BOX,
  MKTG_PRINT_PAGE_COVER_FOOTER_LEFT_BOX,
  MKTG_PRINT_PAGE_COVER_FOOTER_RIGHT_BOX,
  MKTG_PRINT_PAGE_COVER_LOGO_BOX,
  MKTG_PRINT_PAGE_COVER_TOP_RIGHT_BOX,
  MKTG_PRINT_PAGE_SIZE,
} from '@lfx-one/shared/constants';
import { MktgPrintLogo, MktgPrintPage, MktgPrintPageEl, MktgPrintPageLook, MktgPrintRichAlign } from '@lfx-one/shared/interfaces';
import { mktgPrintCoverPage, mktgPrintPara, mktgPrintRich, mktgPrintTextEl } from '@lfx-one/shared/utils';
import { MktgPrintPageComponent } from '../mktg-print-page/mktg-print-page.component';

/**
 * The generic cover page, the deck's "title" slide on the dark ground: the
 * title and subtitle in the cover layout's placeholders, and the deck's own
 * cover lines, each drawn only when set, at SIZE.head in the on-dark ink —
 * `eyebrow` top-left in capitals ("<Project> · A Linux Foundation project"),
 * `topRight` (the kit's version, a month), `footerLeft` (the footer line),
 * `footerRight` (the kit's "host · version · month", a versions line) — and
 * the project lockup above the title. A document's extra cover elements (the
 * framework's accent bar, rule and contents line) come through `els`. Units
 * are deck points (lfx-mktg-print-page).
 */
@Component({
  selector: 'lfx-mktg-print-cover',
  imports: [MktgPrintPageComponent],
  templateUrl: './mktg-print-cover.component.html',
  host: { class: `block ${MKTG_PRINT_LANDSCAPE_CLASS}` },
})
export class MktgPrintCoverComponent {
  public readonly look = input.required<MktgPrintPageLook>();
  public readonly title = input.required<string>();
  public readonly subtitle = input('');
  /** The title's size in deck points: the kit's cover sets 44, the framework's 36. */
  public readonly titleSize = input<number>(MKTG_PRINT_PAGE_SIZE.coverTitle);
  /** The lockup drawn on the dark ground (the brand's logoOnDark); null draws none. */
  public readonly logo = input<MktgPrintLogo | null>(null);
  public readonly eyebrow = input('');
  public readonly topRight = input('');
  public readonly footerLeft = input('');
  public readonly footerRight = input('');
  /** Extra elements of the document's own cover plan. */
  public readonly els = input<MktgPrintPageEl[]>([]);

  protected readonly page = this.initPage();

  private initPage() {
    return computed<MktgPrintPage>(() => {
      const look = this.look();
      const line = (text: string, box: MktgPrintPageEl['box'], caps = false, align: MktgPrintRichAlign = 'START') =>
        text.trim()
          ? [mktgPrintTextEl(box, mktgPrintRich(look, [mktgPrintPara(text, MKTG_PRINT_PAGE_SIZE.head, { caps })], { color: look.onDark, align }))]
          : [];
      const logo = this.logo();
      const els: MktgPrintPageEl[] = [
        ...line(this.eyebrow(), MKTG_PRINT_PAGE_COVER_EYEBROW_BOX, true),
        ...line(this.topRight(), MKTG_PRINT_PAGE_COVER_TOP_RIGHT_BOX, false, 'END'),
        ...line(this.footerLeft(), MKTG_PRINT_PAGE_COVER_FOOTER_LEFT_BOX),
        ...line(this.footerRight(), MKTG_PRINT_PAGE_COVER_FOOTER_RIGHT_BOX, false, 'END'),
        ...(logo ? [{ t: 'image' as const, box: MKTG_PRINT_PAGE_COVER_LOGO_BOX, src: logo.src, alt: logo.alt, filter: logo.filter }] : []),
        ...this.els(),
      ];
      return mktgPrintCoverPage(look, this.title(), this.subtitle(), els, this.titleSize());
    });
  }
}
