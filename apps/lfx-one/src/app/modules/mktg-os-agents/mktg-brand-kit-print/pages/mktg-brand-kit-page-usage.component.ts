// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { MktgRevisionApproval } from '@lfx-one/shared/interfaces';
import { brandKitPortraitAccentMoment, brandKitPortraitIntro, brandKitPortraitUsageCards } from '@lfx-one/shared/utils';
import { MktgPortraitPageComponent } from '../../components/mktg-portrait/mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../../components/mktg-portrait/mktg-portrait-rect.directive';
import { MktgBrandKitArtworkComponent } from './mktg-brand-kit-artwork.component';
import { MktgBrandKitPageBase } from './mktg-brand-kit-page.base';
import { MKTG_PORTRAIT_BLOCK_HOST } from '../../components/mktg-portrait/mktg-portrait-host';

/**
 * The Example usage page (mock 14): the summary, the four sample cards from
 * the kit's examples (keynote slide on the grid ground, social card as the
 * accent moment resolves it: on the accent in the ink that reads there and
 * with no logo on it, the Symbol page's rule, or a white card under an
 * accent rule with the lockup when nothing reads on the accent; report
 * cover; announcement header under the spark rule), each captioned, and the
 * table of example, format, ground and accent moment. The report
 * cover's year is the recorded approval's. The brand line on the keynote,
 * social and announcement cards keeps its last two words together.
 */
@Component({
  selector: 'lfx-mktg-brand-kit-page-usage',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective, MktgBrandKitArtworkComponent],
  templateUrl: './mktg-brand-kit-page-usage.component.html',
  styles: [MKTG_PORTRAIT_BLOCK_HOST],
})
export class MktgBrandKitPageUsageComponent extends MktgBrandKitPageBase {
  /** The revision's recorded approval, or null before one: the report cover's year. */
  public readonly approval = input<MktgRevisionApproval | null>(null);
  protected readonly cards = computed(() => brandKitPortraitUsageCards(this.view(), this.approval()));
  /** The social card's ground and ink: the one accent moment, resolved by the shared rule from the kit's own contrast. */
  protected readonly moment = computed(() => brandKitPortraitAccentMoment(this.view()));
  /** The intro at most three lines of its 600 px: whole sentences that fit, or the first shortened (`brandKitPortraitIntro`). */
  protected readonly intro = computed(() => brandKitPortraitIntro(this.view().usage.summary));
}
