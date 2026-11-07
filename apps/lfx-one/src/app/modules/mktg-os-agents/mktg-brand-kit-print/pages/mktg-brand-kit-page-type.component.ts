// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed } from '@angular/core';
import {
  BRAND_KIT_PORTRAIT_TYPE_PAGE,
  BRAND_KIT_PORTRAIT_TYPE_SAMPLE_PX,
  BRAND_KIT_PORTRAIT_TYPE_SAMPLE_TRACKING_EM,
  MKTG_PORTRAIT_MORE_LINE,
} from '@lfx-one/shared/constants';
import {
  brandKitPortraitIntro,
  brandKitPortraitShortenLine,
  brandKitPortraitTypeLayout,
  brandKitPortraitWeightName,
  mktgPortraitCount,
} from '@lfx-one/shared/utils';
import { MktgPortraitPageComponent } from '../../components/mktg-portrait/mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../../components/mktg-portrait/mktg-portrait-rect.directive';
import { MktgBrandKitPageBase } from './mktg-brand-kit-page.base';
import { MKTG_PORTRAIT_BLOCK_HOST } from '../../components/mktg-portrait/mktg-portrait-host';

/**
 * The Typography page (mock 11): the summary, the family's H1 sample in one
 * line at the mock's 48 px (the brand line shortened to the words that fit
 * the column, never shrunk or clipped), the character set, the weights, the
 * scale at the kit's real sizes with the kit's own lines (a one-line step is
 * shortened when its line would not fit; the body step is the umbrella
 * shortened to three lines at its real size), where to get the font and the
 * rules. The scale and the two lower
 * blocks are one placed block in normal flow: the lower blocks follow the
 * scale as the engine laid it out, 16 px under it, never a computed y.
 */
@Component({
  selector: 'lfx-mktg-brand-kit-page-type',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective],
  templateUrl: './mktg-brand-kit-page-type.component.html',
  styles: [MKTG_PORTRAIT_BLOCK_HOST],
})
export class MktgBrandKitPageTypeComponent extends MktgBrandKitPageBase {
  protected readonly characters = 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz 0123456789';
  /** The 48 px specimen: the brand line, shortened at a word to what fits the column in one line at 48 (never set smaller). */
  protected readonly sampleSize = BRAND_KIT_PORTRAIT_TYPE_SAMPLE_PX;
  protected readonly sample = computed(() =>
    brandKitPortraitShortenLine(this.view().voice.line, this.w, BRAND_KIT_PORTRAIT_TYPE_SAMPLE_PX, {
      weight: 500,
      family: this.view().type.family,
      tracking: BRAND_KIT_PORTRAIT_TYPE_SAMPLE_TRACKING_EM,
    })
  );
  protected readonly weights = computed(() => this.view().type.weights.map((weight) => ({ weight, name: brandKitPortraitWeightName(weight) })));
  /** `1 weight` / `3 weights`: the note's count, singular at one. */
  protected readonly weightsCount = computed(() => mktgPortraitCount(this.weights().length, MKTG_PORTRAIT_MORE_LINE.nouns.weight));
  /**
   * The page's sizes from its data: each scale step at the kit's own size with the kit's own line shortened to its
   * measure (a one-line step to one line; the body step to three lines of its column at 18/30, fewer only when the model
   * says the stack would otherwise cross the footer), and the font block's lines. Where the lower blocks land is the
   * engine's: they follow the scale in flow.
   */
  protected readonly layout = computed(() => brandKitPortraitTypeLayout(this.view(), this.w));
  protected readonly scaleTop = BRAND_KIT_PORTRAIT_TYPE_PAGE.scaleTop;
  /**
   * The scale block is at least as tall as the room above the mock's y 830 less the 16 px gap, so the lower blocks sit
   * at the mock's y while the scale is short and move down with it, in flow, when it is not.
   */
  protected readonly scaleMinHeight = BRAND_KIT_PORTRAIT_TYPE_PAGE.lowerTop - BRAND_KIT_PORTRAIT_TYPE_PAGE.lowerGap - BRAND_KIT_PORTRAIT_TYPE_PAGE.scaleTop;
  /** The intro at most three lines of its 600 px: whole sentences that fit, or the first shortened (`brandKitPortraitIntro`). */
  protected readonly intro = computed(() => brandKitPortraitIntro(this.view().type.summary));
}
