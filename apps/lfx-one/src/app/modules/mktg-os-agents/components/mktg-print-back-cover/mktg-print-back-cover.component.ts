// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { MKTG_PRINT_LANDSCAPE_CLASS, MKTG_PRINT_PAGE_BACK_HOST_BOX, MKTG_PRINT_PAGE_BACK_NOTICE_BOX, MKTG_PRINT_PAGE_SIZE } from '@lfx-one/shared/constants';
import { MktgPrintPage, MktgPrintPageEl, MktgPrintPageLook } from '@lfx-one/shared/interfaces';
import { mktgPrintBackPage, mktgPrintPara, mktgPrintRich, mktgPrintTextEl } from '@lfx-one/shared/utils';
import { MktgPrintPageComponent } from '../mktg-print-page/mktg-print-page.component';

/**
 * The back cover, the deck's closing slide on the dark ground (kit-book.ts
 * backCoverSlide): the brand line as the title in capitals, centred; the
 * site's host under it and the trademark notice near the foot, both centred
 * in the on-dark ink and drawn only when set. Units are deck points.
 */
@Component({
  selector: 'lfx-mktg-print-back-cover',
  imports: [MktgPrintPageComponent],
  templateUrl: './mktg-print-back-cover.component.html',
  host: { class: `block ${MKTG_PRINT_LANDSCAPE_CLASS}` },
})
export class MktgPrintBackCoverComponent {
  public readonly look = input.required<MktgPrintPageLook>();
  /** The brand line (or the project name when the kit has none). */
  public readonly title = input.required<string>();
  public readonly host = input('');
  public readonly notice = input('');

  protected readonly page = this.initPage();

  private initPage() {
    return computed<MktgPrintPage>(() => {
      const look = this.look();
      const els: MktgPrintPageEl[] = [];
      if (this.host().trim()) {
        els.push(
          mktgPrintTextEl(MKTG_PRINT_PAGE_BACK_HOST_BOX, mktgPrintRich(look, [mktgPrintPara(this.host(), 10, { color: look.onDark })], { align: 'CENTER' }))
        );
      }
      if (this.notice().trim()) {
        els.push(
          mktgPrintTextEl(
            MKTG_PRINT_PAGE_BACK_NOTICE_BOX,
            mktgPrintRich(look, [mktgPrintPara(this.notice(), MKTG_PRINT_PAGE_SIZE.eyebrow, { color: look.onDark })], { align: 'CENTER' })
          )
        );
      }
      return mktgPrintBackPage(look, this.title(), els);
    });
  }
}
