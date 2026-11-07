// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed } from '@angular/core';
import { BRAND_KIT_PORTRAIT_RULE_LISTS } from '@lfx-one/shared/constants';
import { brandKitPortraitRulesFit, mktgPortraitPageNumber } from '@lfx-one/shared/utils';
import { MktgPortraitPageComponent } from '../../components/mktg-portrait/mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../../components/mktg-portrait/mktg-portrait-rect.directive';
import { MktgBrandKitArtworkComponent } from './mktg-brand-kit-artwork.component';
import { MktgBrandKitPageBase } from './mktg-brand-kit-page.base';
import { MKTG_PORTRAIT_BLOCK_HOST } from '../../components/mktg-portrait/mktg-portrait-host';

/**
 * The Partnership lockup page (mock 07): the lockup beside a partner's slot over a bar in the dark on a light ground (300 px), the same reversed on the dark (280 px), and the numbered rules in two columns.
 */
@Component({
  selector: 'lfx-mktg-brand-kit-page-logo-partnership',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective, MktgBrandKitArtworkComponent],
  templateUrl: './mktg-brand-kit-page-logo-partnership.component.html',
  styles: [MKTG_PORTRAIT_BLOCK_HOST],
})
export class MktgBrandKitPageLogoPartnershipComponent extends MktgBrandKitPageBase {
  /** The five rules fitted to the room under the tiles (set smaller, cut at a sentence, the last ones counted when even that runs past y 990). */
  protected readonly fit = computed(() => brandKitPortraitRulesFit(this.view().logo.partnership, BRAND_KIT_PORTRAIT_RULE_LISTS.partnership));
  protected readonly rules = computed(() => this.fit().rules.map((text, index) => ({ number: mktgPortraitPageNumber(index + 1), text })));
}
