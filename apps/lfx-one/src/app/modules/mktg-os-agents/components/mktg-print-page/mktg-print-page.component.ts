// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, contentChildren, input, TemplateRef } from '@angular/core';
import {
  MKTG_PRINT_LANDSCAPE_CLASS,
  MKTG_PRINT_PAGE_AREA,
  MKTG_PRINT_PAGE_BACK_TITLE_BOX,
  MKTG_PRINT_PAGE_BULLET_GLYPH_X,
  MKTG_PRINT_PAGE_BULLET_INDENT,
  MKTG_PRINT_PAGE_CANVAS,
  MKTG_PRINT_PAGE_CAPS_TRACKING_EM,
  MKTG_PRINT_PAGE_COVER_SUBTITLE_BOX,
  MKTG_PRINT_PAGE_COVER_TITLE_BOX,
  MKTG_PRINT_PAGE_FRAME_PT,
  MKTG_PRINT_PAGE_GRID_PT,
  MKTG_PRINT_PAGE_HAIRLINE_PT,
  MKTG_PRINT_PAGE_HEAD_LEFT_BOX,
  MKTG_PRINT_PAGE_HEAD_RIGHT_BOX,
  MKTG_PRINT_PAGE_HEAD_RULE_Y,
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
  MktgPrintPageElView,
  MktgPrintPageLayout,
  MktgPrintPageLook,
  MktgPrintRich,
  MktgPrintRichView,
} from '@lfx-one/shared/interfaces';
import {
  mktgPageBoxStyle,
  mktgPagePt,
  mktgPrintBackTitleRich,
  mktgPrintCoverTitleRich,
  mktgPrintElView,
  mktgPrintFooterEls,
  mktgPrintHeadEls,
  mktgPrintRichView,
  mktgPrintTitleRich,
} from '@lfx-one/shared/utils';
import { MktgPrintPageSlotDirective } from './mktg-print-page-slot.directive';

/** A frame length in pt (already on paper, not on the canvas), to the hundredth: 405 × 1.1 is 445.50000000000006 in floating point. */
function framePt(n: number): string {
  return `${Math.round(n * 100) / 100}pt`;
}

/**
 * One printed landscape page = one slide of the deck: the fixed frame
 * (MKTG_PRINT_PAGE_FRAME_PT, `break-after: page`, one frame per page, CSS
 * Paged Media, on the deck's own named page MKTG_PRINT_DECK_PAGE_NAME), the
 * 16:9 slide area centred on it, and the page plan's boxes drawn on the slide.
 *
 * UNITS: every box, size and input is in DECK POINTS on the 720 × 405 pt
 * canvas (the deck's `pages.ts`), and the shell scales them ONCE through the
 * CSS custom property MKTG_PRINT_PAGE_SCALE_PROPERTY (`--mktg-page-scale`,
 * MKTG_PRINT_PAGE_SCALE = 792 / 720 = 1.1 at Letter-landscape width) with
 * `mktgPagePt(n)`; a consumer sizes its own markup the same way and never
 * hard-codes the scale. The frame's own sizes (the frame, the slide area, the
 * insets, the bullet indent, the capitals' tracking) reach the stylesheet as
 * custom properties set from the same constants, so the CSS follows them.
 *
 * Two ways to fill a page, which combine: a `page` from a builder (its title,
 * running head, footer and body boxes), and the plain inputs `eyebrowLeft`,
 * `eyebrowRight`, `title`, `number`, `footerLine` (each overriding the page's
 * when given) with projected content (`<ng-content>`) placed at the deck's
 * AREA (x 25, y 91, w 671, h 265). The content layout adds the title band,
 * the two eyebrow lines, the project lockup in the layout's logo frame and
 * the footer line with the page number the BUILDER computed (the shell prints
 * what it is given); the cover and back layouts set their title (and
 * subtitle) on the dark ground, a `title` override built by the layout's own
 * title grammar. Every text box is fitted by the model and clipped by the box
 * (`overflow: hidden`), so no text leaves its frame even where the model is
 * wrong. The host carries MKTG_PRINT_LANDSCAPE_CLASS, by which the print
 * frame prints the document landscape.
 *
 * The template binds render models built once per change of the page (the
 * boxes' and paragraphs' CSS), never a method that would rebuild them on every
 * change detection.
 */
@Component({
  selector: 'lfx-mktg-print-page',
  imports: [NgTemplateOutlet],
  templateUrl: './mktg-print-page.component.html',
  styleUrl: './mktg-print-page.component.scss',
  host: { class: `block ${MKTG_PRINT_LANDSCAPE_CLASS}` },
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
  /** The title, set by the layout's title grammar (the band's on a content page, the placeholder's on a cover). */
  public readonly title = input<string | null>(null);
  /** The footer's page number as the builder computed it (two digits), and the footer line left of the logo frame. */
  public readonly number = input<string | null>(null);
  public readonly footerLine = input<string | null>(null);
  /** The layout when no page is given. */
  public readonly layout = input<MktgPrintPageLayout>('content');

  /** The frame's sizes as custom properties, from the constants the plan is laid out with (the stylesheet reads them). */
  protected readonly frameStyle: Record<string, string> = {
    [MKTG_PRINT_PAGE_SCALE_PROPERTY]: String(MKTG_PRINT_PAGE_SCALE),
    '--pp-frame-w': framePt(MKTG_PRINT_PAGE_FRAME_PT.w),
    '--pp-frame-h': framePt(MKTG_PRINT_PAGE_FRAME_PT.h),
    '--pp-slide-h': framePt(MKTG_PRINT_PAGE_CANVAS.h * MKTG_PRINT_PAGE_SCALE),
    '--pp-slide-top': framePt(MKTG_PRINT_PAGE_SLIDE_TOP_PT),
    '--pp-inset': mktgPagePt(MKTG_PRINT_PAGE_INSET),
    '--pp-line': String(MKTG_PRINT_PAGE_LINE),
    '--pp-bullet-indent': mktgPagePt(MKTG_PRINT_PAGE_BULLET_INDENT),
    '--pp-bullet-x': mktgPagePt(MKTG_PRINT_PAGE_BULLET_GLYPH_X),
    '--pp-caps-tracking': `${MKTG_PRINT_PAGE_CAPS_TRACKING_EM}em`,
    '--pp-hairline': framePt(MKTG_PRINT_PAGE_HAIRLINE_PT),
    '--pp-grid': framePt(MKTG_PRINT_PAGE_GRID_PT),
    '--pp-head-rule-top': mktgPagePt(MKTG_PRINT_PAGE_HEAD_RULE_Y),
    '--pp-head-rule-left': mktgPagePt(MKTG_PRINT_PAGE_HEAD_LEFT_BOX.x),
    '--pp-head-rule-right': mktgPagePt(MKTG_PRINT_PAGE_CANVAS.w - MKTG_PRINT_PAGE_HEAD_RIGHT_BOX.x - MKTG_PRINT_PAGE_HEAD_RIGHT_BOX.w),
  };
  /** The fixed boxes' CSS, built once. */
  protected readonly titleStyle = mktgPageBoxStyle(MKTG_PRINT_PAGE_TITLE_BOX);
  protected readonly backTitleStyle = mktgPageBoxStyle(MKTG_PRINT_PAGE_BACK_TITLE_BOX);
  protected readonly logoStyle = mktgPageBoxStyle(MKTG_PRINT_PAGE_LOGO_FRAME);
  protected readonly areaStyle = mktgPageBoxStyle(MKTG_PRINT_PAGE_AREA);

  /** A cover's boxes: the page's own when it sets them, else the deck's cover boxes. */
  protected readonly coverTitleStyle = computed(() => mktgPageBoxStyle(this.page()?.titleBox ?? MKTG_PRINT_PAGE_COVER_TITLE_BOX));
  protected readonly coverSubtitleStyle = computed(() => mktgPageBoxStyle(this.page()?.subtitleBox ?? MKTG_PRINT_PAGE_COVER_SUBTITLE_BOX));
  protected readonly pageLayout = computed<MktgPrintPageLayout>(() => this.page()?.layout ?? this.layout());
  protected readonly isContent = computed(() => this.pageLayout() === 'content');
  protected readonly pageTitle = computed(() => this.title() ?? this.page()?.title ?? '');
  /** The render models: the title, the cover's subtitle, the head, the footer and the body, each with its CSS. */
  protected readonly titleView = computed<MktgPrintRichView>(() => mktgPrintRichView(this.titleRich()));
  protected readonly subtitleView = this.initSubtitleView();
  protected readonly headViews = this.initHeadViews();
  protected readonly footerViews = this.initFooterViews();
  protected readonly elViews = computed<MktgPrintPageElView[]>(() => (this.page()?.els ?? []).map(mktgPrintElView));
  /** The projected slot templates by name, one map per change of the content children. */
  protected readonly slotTemplates = this.initSlotTemplates();

  private readonly slots = contentChildren(MktgPrintPageSlotDirective);
  private readonly titleRich = this.initTitleRich();

  private initTitleRich() {
    return computed<MktgPrintRich>(() => {
      const page = this.page();
      const title = this.title();
      if (title === null && page) return page.titleRich;
      const look = this.look();
      const text = title ?? '';
      const layout = this.pageLayout();
      if (layout === 'cover') return mktgPrintCoverTitleRich(look, text);
      if (layout === 'back') return mktgPrintBackTitleRich(look, text);
      return mktgPrintTitleRich(look, text);
    });
  }

  private initSubtitleView() {
    return computed<MktgPrintRichView | null>(() => {
      const subtitle = this.page()?.subtitle;
      return subtitle ? mktgPrintRichView(subtitle) : null;
    });
  }

  private initHeadViews() {
    return computed<MktgPrintPageElView[]>(() => {
      if (!this.isContent()) return [];
      const page = this.page();
      const left = this.eyebrowLeft() ?? page?.head?.left ?? '';
      const right = this.eyebrowRight() ?? page?.head?.right ?? '';
      const els: MktgPrintPageEl[] = left || right ? mktgPrintHeadEls(this.look(), { left, right }) : [];
      return els.map(mktgPrintElView);
    });
  }

  private initFooterViews() {
    return computed<MktgPrintPageElView[]>(() => {
      if (!this.isContent()) return [];
      const page = this.page();
      const number = this.number() ?? page?.footer?.number ?? '';
      const line = this.footerLine() ?? page?.footer?.left ?? '';
      const els: MktgPrintPageEl[] = number || line ? mktgPrintFooterEls(this.look(), line, number, undefined, page?.footer?.leftBox) : [];
      return els.map(mktgPrintElView);
    });
  }

  private initSlotTemplates() {
    return computed<ReadonlyMap<string, TemplateRef<unknown>>>(() => new Map(this.slots().map((slot) => [slot.name(), slot.template])));
  }
}
