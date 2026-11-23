// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed } from '@angular/core';
import { BRAND_KIT_PORTRAIT_RULE_LISTS } from '@lfx-one/shared/constants';
import { brandKitPortraitAccentMoment, brandKitPortraitIntro, brandKitPortraitMessageCard, brandKitPortraitRulesFit } from '@lfx-one/shared/utils';
import { MktgPortraitPageComponent } from '../../components/mktg-portrait/mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../../components/mktg-portrait/mktg-portrait-rect.directive';
import { MktgBrandKitPageBase } from './mktg-brand-kit-page.base';
import { MKTG_PORTRAIT_BLOCK_HOST } from '../../components/mktg-portrait/mktg-portrait-host';

/**
 * The Imagery & graphic elements page (mock 13): the rule, the default grid
 * ground, three element cards (the umbrella-message card, fitted to its box,
 * the buttons, the call-out on the accent in the shared ink) with
 * their captions, and what to avoid.
 */
@Component({
  selector: 'lfx-mktg-brand-kit-page-visual-imagery',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective],
  templateUrl: './mktg-brand-kit-page-visual-imagery.component.html',
  styles: [MKTG_PORTRAIT_BLOCK_HOST],
})
export class MktgBrandKitPageVisualImageryComponent extends MktgBrandKitPageBase {
  /** The umbrella-message card's text, fitted to the card (the brand line when the umbrella cannot fit whole). */
  protected readonly message = computed(() => brandKitPortraitMessageCard(this.view()));
  /** The avoid list fitted to the room under the elements (set smaller, cut at a sentence, the last ones counted when even that runs past y 990). */
  protected readonly avoid = computed(() => brandKitPortraitRulesFit(this.view().visual.imagery.avoid, BRAND_KIT_PORTRAIT_RULE_LISTS.imageryAvoid));

  /**
   * The accent moment as the shared rule resolves it from the kit's own contrast: text on the accent in the ink that
   * reads there, or a white card under an accent top rule when none does (`brandKitPortraitAccentMoment`).
   */
  protected readonly moment = computed(() => brandKitPortraitAccentMoment(this.view()));
  /** The call-out's caption: the moment's reason, in the matrix's own ratios. */
  protected readonly calloutCaption = computed(() => {
    const moment = this.moment();
    return moment.ground === 'accent' ? `Call-out · the one accent moment; ${moment.reason}` : `Call-out · the accent as a top rule; ${moment.reason}`;
  });
  /** The intro at most three lines of its 600 px: whole sentences that fit, or the first shortened (`brandKitPortraitIntro`). */
  protected readonly intro = computed(() => brandKitPortraitIntro(this.view().visual.imagery.rule));
}
