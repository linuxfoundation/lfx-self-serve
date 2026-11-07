// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed } from '@angular/core';
import { BRAND_KIT_PORTRAIT_TYPE_PAGE, BRAND_KIT_PORTRAIT_TYPE_SAMPLE_PX, BRAND_KIT_PORTRAIT_TYPE_SAMPLE_TRACKING_EM } from '@lfx-one/shared/constants';
import { brandKitPortraitFitSize, brandKitPortraitTypeLayout, brandKitPortraitWeightName } from '@lfx-one/shared/utils';
import { MktgPortraitPageComponent } from '../../components/mktg-portrait/mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../../components/mktg-portrait/mktg-portrait-rect.directive';
import { MktgBrandKitPageBase } from './mktg-brand-kit-page.base';

/**
 * The Typography page (mock 11): the summary, the family's H1 sample in one
 * line (shrunk until it fits the column; past about 142 characters the 9 px
 * floor still clips it, open with item 2's sweep), the character set, the
 * weights, the scale at real size with the kit's own lines (a one-line step
 * shrinks only when its line would not fit; the body step wraps at its real
 * size), where to get the font and the rules. The scale and the two lower
 * blocks are one placed block in normal flow: the lower blocks follow the
 * scale as the engine laid it out, 16 px under it, never a computed y.
 */
@Component({
  selector: 'lfx-mktg-brand-kit-page-type',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective],
  templateUrl: './mktg-brand-kit-page-type.component.html',
})
export class MktgBrandKitPageTypeComponent extends MktgBrandKitPageBase {
  protected readonly characters = 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz 0123456789';
  /** The sample's size: 48 px when the brand line fits the column in one line at 48, else the largest size at which it does. */
  protected readonly sampleSize = computed(() =>
    brandKitPortraitFitSize(this.view().voice.line, this.w, BRAND_KIT_PORTRAIT_TYPE_SAMPLE_PX, {
      weight: 500,
      family: this.view().type.family,
      tracking: BRAND_KIT_PORTRAIT_TYPE_SAMPLE_TRACKING_EM,
    })
  );
  protected readonly weights = computed(() => this.view().type.weights.map((weight) => ({ weight, name: brandKitPortraitWeightName(weight) })));
  /**
   * The page's sizes from its data: each scale step at its real size with the kit's own line (a one-line step whose
   * sample would not fit is set smaller, that step only; the body step wraps at 18/30), the font block's lines, and the
   * body step giving size, in the grammar's steps, only when the model says the stack would otherwise cross the footer.
   * Where the lower blocks land is the engine's: they follow the scale in flow.
   */
  protected readonly layout = computed(() => brandKitPortraitTypeLayout(this.view(), this.w));
  protected readonly scaleTop = BRAND_KIT_PORTRAIT_TYPE_PAGE.scaleTop;
  /**
   * The scale block is at least as tall as the room above the mock's y 830 less the 16 px gap, so the lower blocks sit
   * at the mock's y while the scale is short and move down with it, in flow, when it is not.
   */
  protected readonly scaleMinHeight = BRAND_KIT_PORTRAIT_TYPE_PAGE.lowerTop - BRAND_KIT_PORTRAIT_TYPE_PAGE.lowerGap - BRAND_KIT_PORTRAIT_TYPE_PAGE.scaleTop;
}
