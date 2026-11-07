// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed } from '@angular/core';
import { MKTG_PORTRAIT_FIT } from '@lfx-one/shared/constants';
import { brandKitPortraitTypeSample, brandKitPortraitTypeSource, brandKitPortraitWeightName, mktgPortraitCharsPerLine } from '@lfx-one/shared/utils';
import { MktgPortraitPageComponent } from '../../components/mktg-portrait/mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../../components/mktg-portrait/mktg-portrait-rect.directive';
import { MktgBrandKitPageBase } from './mktg-brand-kit-page.base';

/** The H1 sample's size in the mock, and the smallest it shrinks to so the line fits the column whole. */
const SAMPLE_SIZE_PX = 48;

/**
 * The Typography page (mock 11): the summary, the family's H1 sample in one
 * line (shrunk to fit the column, never cut), the character set, the weights,
 * the scale at real size with the kit's own lines, where to get the font and
 * the rules.
 */
@Component({
  selector: 'lfx-mktg-brand-kit-page-type',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective],
  templateUrl: './mktg-brand-kit-page-type.component.html',
})
export class MktgBrandKitPageTypeComponent extends MktgBrandKitPageBase {
  protected readonly characters = 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz 0123456789';
  /** The sample's size: 48 px when the brand line fits the column in one line at 48, else the largest size (to 72 %) at which it does. */
  protected readonly sampleSize = computed(() => {
    const text = this.view().voice.line;
    for (let scale = 1; scale >= MKTG_PORTRAIT_FIT.minScale - 1e-9; scale -= MKTG_PORTRAIT_FIT.scaleStep) {
      const size = Math.floor(SAMPLE_SIZE_PX * scale * 2) / 2;
      if (text.length <= mktgPortraitCharsPerLine(this.w, size, { weight: 500 })) return size;
    }
    return Math.floor(SAMPLE_SIZE_PX * MKTG_PORTRAIT_FIT.minScale * 2) / 2;
  });
  protected readonly weights = computed(() => this.view().type.weights.map((weight) => ({ weight, name: brandKitPortraitWeightName(weight) })));
  protected readonly scale = computed(() => {
    const view = this.view();
    return view.type.scale.map((step) => ({
      ...step,
      sample: brandKitPortraitTypeSample(view, step),
      spec: `${step.weight} · ${step.size}/${step.line_height}`,
      display: step.step === 'display',
    }));
  });
  protected readonly source = computed(() => brandKitPortraitTypeSource(this.view().type.source));
  protected readonly weightList = computed(() => this.view().type.weights.join(', '));
}
