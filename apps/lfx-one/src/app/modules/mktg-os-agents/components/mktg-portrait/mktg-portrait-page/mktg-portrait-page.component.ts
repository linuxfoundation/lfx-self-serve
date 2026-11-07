// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { MKTG_PORTRAIT_GRID_GROUND, MKTG_PORTRAIT_HEX_REGEX, MKTG_PORTRAIT_INKS } from '@lfx-one/shared/constants';
import { MktgPortraitBook, MktgPortraitLook } from '@lfx-one/shared/interfaces';
import { mktgPortraitAccentText, mktgPortraitPageNumber } from '@lfx-one/shared/utils';
import { MKTG_PORTRAIT_BLOCK_HOST } from '../mktg-portrait-host';

/**
 * One page of a portrait print document: a fixed 816×1056 px frame
 * (US Letter at 96 dpi) that is the whole sheet, so the engines paginate one
 * frame per page and nothing flows across an edge. It carries the running
 * head (section label left, document name right, over a 1 px rule), the
 * optional 4 px accent chapter band above it on a chapter's first page, the
 * page title at top 84, the projected content, and the footer at bottom 28
 * (the book's left text and the two-digit book page number). `bare` drops
 * the head, title and footer (covers, openers, back covers); `dark` sets
 * the frame on the kit's dark with white ink. The document's look is bound
 * as the frame's custom properties, which the `pp-*` classes read. For QA
 * every frame is `data-testid="lfx-mktg-portrait-page"` with its plan id,
 * book page number and printed section label as data attributes.
 */
@Component({
  selector: 'lfx-mktg-portrait-page',
  templateUrl: './mktg-portrait-page.component.html',
  styles: [MKTG_PORTRAIT_BLOCK_HOST],
  host: {
    class: 'pp-page',
    '[class.pp-page--dark]': 'dark()',
    '[attr.data-page-id]': 'pageId()',
    '[attr.data-page]': 'page()',
    '[attr.data-section]': 'section()',
    'data-testid': 'lfx-mktg-portrait-page',
    '[style.--pp-dark]': 'look().dark',
    '[style.--pp-accent]': 'look().accent',
    '[style.--pp-accent-text]': 'accentText()',
    '[style.--pp-spark]': 'look().spark',
    '[style.--pp-on-accent]': 'look().onAccent',
    '[style.--pp-on-dark]': 'look().onDark',
    '[style.--pp-font]': 'look().fontStack',
    '[style.--pp-glow]': 'glow()',
    '[style.--pp-grid]': 'grid()',
    '[style.--pp-ink]': 'inks.ink',
    '[style.--pp-muted]': 'inks.muted',
    '[style.--pp-hairline]': 'inks.hairline',
    '[style.--pp-mist]': 'inks.mist',
    '[style.--pp-white]': 'inks.white',
    '[style.--pp-fail]': 'inks.fail',
  },
})
export class MktgPortraitPageComponent {
  /** The design's neutral inks, written once here as the `--pp-*` properties every portrait stylesheet reads. */
  protected readonly inks = MKTG_PORTRAIT_INKS;
  public readonly look = input.required<MktgPortraitLook>();
  /** The book the page is in, resolved by the document (standalone or the family's). */
  public readonly book = input.required<MktgPortraitBook>();
  /** The plan id (`logo-system`); the frame's `data-page-id` for QA. */
  public readonly pageId = input.required<string>();
  /** The book page number (standalone: the cover is 1). */
  public readonly page = input.required<number>();
  /** The running head's section label as printed (`01 Logo`, `Brand kit · Logo`); the frame's `data-section` for QA. */
  public readonly section = input('');
  public readonly title = input('');
  /** The chapter band: on a numbered chapter's first page; the document passes false inside the family. */
  public readonly band = input(false);
  /** The frame on the kit's dark with white ink (covers, openers, back covers). */
  public readonly dark = input(false);
  /** No running head, title or footer: covers, openers and back covers draw their own. */
  public readonly bare = input(false);
  protected readonly showBand = computed(() => this.band() && !this.bare());
  protected readonly pageNumber = computed(() => mktgPortraitPageNumber(this.page()));
  /** The accent as text on the page white, readable at WCAG AA: `--pp-accent-text`, for every text set in the accent. */
  protected readonly accentText = computed(() => mktgPortraitAccentText(this.look().accent, this.inks.white));
  protected readonly glow = computed(() => this.accentAlpha(MKTG_PORTRAIT_GRID_GROUND.glowAlpha));
  protected readonly grid = computed(() => this.accentAlpha(MKTG_PORTRAIT_GRID_GROUND.gridAlpha));

  /** The accent with an alpha, for the grid ground; the accent as it is when it is not a 6-digit hex. */
  private accentAlpha(alpha: string): string {
    const accent = this.look().accent;
    return MKTG_PORTRAIT_HEX_REGEX.test(accent) ? `${accent}${alpha}` : accent;
  }
}
