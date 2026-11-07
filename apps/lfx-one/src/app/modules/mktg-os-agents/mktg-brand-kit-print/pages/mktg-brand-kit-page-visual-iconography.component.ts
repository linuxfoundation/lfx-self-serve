// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed } from '@angular/core';
import {
  BRAND_KIT_ICON_HIGHLIGHT_INDEX,
  BRAND_KIT_ICON_SAMPLES,
  BRAND_KIT_PORTRAIT_ICON_SIZES_PX,
  BRAND_KIT_PORTRAIT_RULE_LISTS,
} from '@lfx-one/shared/constants';
import { brandKitPortraitRulesFit } from '@lfx-one/shared/utils';
import { MktgBrandKitIconComponent } from '../../components/mktg-brand-kit-icon/mktg-brand-kit-icon.component';
import { MktgBrandKitIconSamplesComponent } from '../../components/mktg-brand-kit-icon-samples/mktg-brand-kit-icon-samples.component';
import { MktgPortraitPageComponent } from '../../components/mktg-portrait/mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../../components/mktg-portrait/mktg-portrait-rect.directive';
import { MktgBrandKitPageBase } from './mktg-brand-kit-page.base';
import { MKTG_PORTRAIT_BLOCK_HOST } from '../../components/mktg-portrait/mktg-portrait-host';

/**
 * The Iconography page (mock 12): the eight sample tiles and the strip on the
 * kit's dark (the shared samples renderer at the mock's sizes), the rules,
 * the recommended set with one labelled icon, and the sizes row.
 */
@Component({
  selector: 'lfx-mktg-brand-kit-page-visual-iconography',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective, MktgBrandKitIconSamplesComponent, MktgBrandKitIconComponent],
  templateUrl: './mktg-brand-kit-page-visual-iconography.component.html',
  styles: [MKTG_PORTRAIT_BLOCK_HOST],
})
export class MktgBrandKitPageVisualIconographyComponent extends MktgBrandKitPageBase {
  protected readonly sizes = BRAND_KIT_PORTRAIT_ICON_SIZES_PX;
  /** The strip's highlighted icon, the one the sizes row scales. */
  protected readonly sizedIcon = BRAND_KIT_ICON_SAMPLES[BRAND_KIT_ICON_HIGHLIGHT_INDEX];
  /** The recommended set's labelled sample: the verified mark when the set has one, else the first icon. */
  protected readonly labelledIcon = BRAND_KIT_ICON_SAMPLES.find((icon) => icon.id === 'verified') ?? BRAND_KIT_ICON_SAMPLES[0];
  /** The highlight colour's name in the palette, for the strip's caption; the accent's name when the palette does not hold it. */
  /** The four rules fitted to the room above the Sizes block (set smaller, cut at a sentence, the last ones counted when even that runs past). */
  protected readonly rules = computed(() => brandKitPortraitRulesFit(this.view().visual.icons.rules, BRAND_KIT_PORTRAIT_RULE_LISTS.iconography));
  protected readonly highlightName = computed(() => {
    const view = this.view();
    const highlight = view.iconColours.highlight.toLowerCase();
    return view.palette.find((card) => card.hex.toLowerCase() === highlight)?.name ?? view.accentName;
  });
}
