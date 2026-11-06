// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, contentChildren, input, TemplateRef } from '@angular/core';
import {
  MKTG_PRINT_LANDSCAPE_CLASS,
  MKTG_PRINT_PAGE_AREA,
  MKTG_PRINT_PAGE_BACK_TITLE_BOX,
  MKTG_PRINT_PAGE_COVER_SUBTITLE_BOX,
  MKTG_PRINT_PAGE_COVER_TITLE_BOX,
  MKTG_PRINT_PAGE_INSET,
  MKTG_PRINT_PAGE_LINE,
  MKTG_PRINT_PAGE_LOGO_FRAME,
  MKTG_PRINT_PAGE_SCALE,
  MKTG_PRINT_PAGE_SCALE_PROPERTY,
  MKTG_PRINT_PAGE_SLIDE_TOP_PT,
  MKTG_PRINT_PAGE_TITLE_BOX,
} from '@lfx-one/shared/constants';
import {
  MktgPrintLogo,
  MktgPrintPage,
  MktgPrintPageEl,
  MktgPrintPageLayout,
  MktgPrintPageLook,
  MktgPrintPara,
  MktgPrintRich,
} from '@lfx-one/shared/interfaces';
import { mktgPageBoxStyle, mktgPagePt, mktgPrintFooterEls, mktgPrintHeadEls, mktgPrintTitleRich } from '@lfx-one/shared/utils';
import { MktgPrintPageSlotDirective } from './mktg-print-page-slot.directive';

/**
 * One printed landscape page = one slide of the deck: the fixed frame
 * (MKTG_PRINT_PAGE_FRAME_PT, `break-after: page`, one frame per page, CSS
 * Paged Media), the 16:9 slide area centred on it, and the page plan's boxes
 * drawn on the slide.
 *
 * UNITS: every box, size and input is in DECK POINTS on the 720 × 405 pt
 * canvas (the deck's `pages.ts`), and the shell scales them ONCE through the
 * CSS custom property `--mktg-page-scale` (MKTG_PRINT_PAGE_SCALE, 792 / 720 =
 * 1.1 at Letter-landscape width) with `mktgPagePt(n)`; a consumer sizes its
 * own markup the same way and never hard-codes the scale.
 *
 * Two ways to fill a page, which combine: a `page` from a builder (its title,
 * running head, footer and body boxes), and the plain inputs `eyebrowLeft`,
 * `eyebrowRight`, `title`, `number`, `footerLine` (each overriding the page's
 * when given) with projected content (`<ng-content>`) placed at the deck's
 * AREA (x 25, y 91, w 671, h 265). The content layout adds the title band,
 * the two eyebrow lines, the project lockup in the layout's logo frame and
 * the footer line with the page number the BUILDER computed (the shell prints
 * what it is given); the cover and back layouts set their title (and
 * subtitle) on the dark ground. Every text box is fitted by the model and
 * clipped by the box (`overflow: hidden`), so no text leaves its frame even
 * where the model is wrong. The host carries MKTG_PRINT_LANDSCAPE_CLASS, by
 * which the print frame prints the document landscape.
 */
@Component({
  selector: 'lfx-mktg-print-page',
  imports: [NgTemplateOutlet],
  templateUrl: './mktg-print-page.component.html',
  styleUrl: './mktg-print-page.component.scss',
  host: { class: `block ${MKTG_PRINT_LANDSCAPE_CLASS}`, '[style.--mktg-page-scale]': 'scale' },
})
export class MktgPrintPageComponent {
  /** A built page: its layout, title, head, footer and body boxes. Without one, the plain inputs make a content page. */
  public readonly page = input<MktgPrintPage | null>(null);
  public readonly look = input.required<MktgPrintPageLook>();
  /** The project lockup for the content layout's logo frame; null leaves the frame empty. */
  public readonly logo = input<MktgPrintLogo | null>(null);
  /** The running head's two lines: left the chapter or section, right the document. */
  public readonly eyebrowLeft = input<string | null>(null);
  public readonly eyebrowRight = input<string | null>(null);
  /** The title in the band (fitted to it). */
  public readonly title = input<string | null>(null);
  /** The footer's page number as the builder computed it (two digits), and the footer line left of the logo frame. */
  public readonly number = input<string | null>(null);
  public readonly footerLine = input<string | null>(null);
  /** The layout when no page is given. */
  public readonly layout = input<MktgPrintPageLayout>('content');

  protected readonly scale = String(MKTG_PRINT_PAGE_SCALE);
  protected readonly scaleProperty = MKTG_PRINT_PAGE_SCALE_PROPERTY;
  protected readonly slots = contentChildren(MktgPrintPageSlotDirective);
  protected readonly titleBox = MKTG_PRINT_PAGE_TITLE_BOX;
  protected readonly coverTitleBox = MKTG_PRINT_PAGE_COVER_TITLE_BOX;
  protected readonly coverSubtitleBox = MKTG_PRINT_PAGE_COVER_SUBTITLE_BOX;
  protected readonly backTitleBox = MKTG_PRINT_PAGE_BACK_TITLE_BOX;
  protected readonly logoFrame = MKTG_PRINT_PAGE_LOGO_FRAME;
  protected readonly area = MKTG_PRINT_PAGE_AREA;
  protected readonly slideTop = `${MKTG_PRINT_PAGE_SLIDE_TOP_PT}pt`;
  protected readonly lineHeight = MKTG_PRINT_PAGE_LINE;
  protected readonly inset = mktgPagePt(MKTG_PRINT_PAGE_INSET);
  protected readonly pageLayout = computed<MktgPrintPageLayout>(() => this.page()?.layout ?? this.layout());
  protected readonly isContent = computed(() => this.pageLayout() === 'content');
  protected readonly pageTitle = computed(() => this.title() ?? this.page()?.title ?? '');
  protected readonly titleRich = this.initTitleRich();
  protected readonly els = computed<MktgPrintPageEl[]>(() => this.page()?.els ?? []);
  /** The running head's and the footer's boxes, built from the inputs (or the page's head and footer) by the shared grammar. */
  protected readonly headEls = this.initHeadEls();
  protected readonly footerEls = this.initFooterEls();

  protected boxStyle = mktgPageBoxStyle;

  protected paraStyle(p: MktgPrintPara): Record<string, string> {
    const style: Record<string, string> = { 'font-size': mktgPagePt(p.size) };
    if (p.above) style['margin-top'] = mktgPagePt(p.above);
    if (p.weight) style['font-weight'] = String(p.weight);
    if (p.color) style['color'] = p.color;
    if (p.font) style['font-family'] = p.font;
    return style;
  }

  protected shapeStyle(el: Extract<MktgPrintPageEl, { t: 'shape' }>): Record<string, string> {
    const style = mktgPageBoxStyle(el.box);
    if (el.fill) style['background-color'] = el.fill;
    if (el.line) style['box-shadow'] = `inset 0 0 0 ${mktgPagePt(el.line.weight)} ${el.line.color}`;
    return style;
  }

  protected slotTemplate(name: string): TemplateRef<unknown> | null {
    return this.slots().find((slot) => slot.name() === name)?.template ?? null;
  }

  private initTitleRich() {
    return computed<MktgPrintRich>(() => {
      const page = this.page();
      const title = this.title();
      if (title === null && page) return page.titleRich;
      return mktgPrintTitleRich(this.look(), title ?? '');
    });
  }

  private initHeadEls() {
    return computed<MktgPrintPageEl[]>(() => {
      if (!this.isContent()) return [];
      const page = this.page();
      const left = this.eyebrowLeft() ?? page?.head?.left ?? '';
      const right = this.eyebrowRight() ?? page?.head?.right ?? '';
      return left || right ? mktgPrintHeadEls(this.look(), { left, right }) : [];
    });
  }

  private initFooterEls() {
    return computed<MktgPrintPageEl[]>(() => {
      if (!this.isContent()) return [];
      const page = this.page();
      const number = this.number() ?? page?.footer?.number ?? '';
      const line = this.footerLine() ?? page?.footer?.left ?? '';
      return number || line ? mktgPrintFooterEls(this.look(), line, number) : [];
    });
  }
}
