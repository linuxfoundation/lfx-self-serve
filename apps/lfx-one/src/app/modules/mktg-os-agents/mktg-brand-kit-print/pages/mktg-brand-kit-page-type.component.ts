// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed } from '@angular/core';
import { BRAND_KIT_PORTRAIT_SCALE_META_PX, BRAND_KIT_PORTRAIT_TYPE_SAMPLE_PX } from '@lfx-one/shared/constants';
import { brandKitPortraitFitSize, brandKitPortraitTypeSample, brandKitPortraitTypeSource, brandKitPortraitWeightName } from '@lfx-one/shared/utils';
import { MktgPortraitPageComponent } from '../../components/mktg-portrait/mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../../components/mktg-portrait/mktg-portrait-rect.directive';
import { MktgBrandKitPageBase } from './mktg-brand-kit-page.base';

/**
 * The Typography page (mock 11): the summary, the family's H1 sample in one
 * line (shrunk until it fits the column, never cut), the character set, the
 * weights, the scale at real size with the kit's own lines (a one-line step
 * shrinks only when its line would not fit; the body step wraps at its real
 * size), where to get the font and the rules.
 */
@Component({
  selector: 'lfx-mktg-brand-kit-page-type',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective],
  templateUrl: './mktg-brand-kit-page-type.component.html',
})
export class MktgBrandKitPageTypeComponent extends MktgBrandKitPageBase {
  protected readonly characters = 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz 0123456789';
  /** The sample's size: 48 px when the brand line fits the column in one line at 48, else the largest size at which it does. */
  protected readonly sampleSize = computed(() => brandKitPortraitFitSize(this.view().voice.line, this.w, BRAND_KIT_PORTRAIT_TYPE_SAMPLE_PX, { weight: 500 }));
  protected readonly weights = computed(() => this.view().type.weights.map((weight) => ({ weight, name: brandKitPortraitWeightName(weight) })));
  /**
   * Each step at its real size with the kit's own line. A one-line step whose sample would not fit its line is set smaller
   * (that step only), never cut; the body step is a paragraph (the umbrella message, two or three lines) and wraps at 18/30.
   */
  protected readonly scale = computed(() => {
    const view = this.view();
    return view.type.scale.map((step) => {
      const sample = brandKitPortraitTypeSample(view, step);
      const display = step.step === 'display';
      const width = display ? this.w : this.w - BRAND_KIT_PORTRAIT_SCALE_META_PX;
      return {
        ...step,
        sample,
        spec: `${step.weight} · ${step.size}/${step.line_height}`,
        display,
        size: step.step === 'body' ? step.size : brandKitPortraitFitSize(sample, width, step.size, { weight: step.weight, caps: step.caps }),
      };
    });
  });
  protected readonly source = computed(() => brandKitPortraitTypeSource(this.view().type.source));
  protected readonly weightList = computed(() => this.view().type.weights.join(', '));
}
