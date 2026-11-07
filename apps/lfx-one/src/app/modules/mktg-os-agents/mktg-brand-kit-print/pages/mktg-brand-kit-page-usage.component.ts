// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { MktgRevisionApproval } from '@lfx-one/shared/interfaces';
import { brandKitPortraitUsageCards } from '@lfx-one/shared/utils';
import { MktgPortraitPageComponent } from '../../components/mktg-portrait/mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../../components/mktg-portrait/mktg-portrait-rect.directive';
import { MktgBrandKitArtworkComponent } from './mktg-brand-kit-artwork.component';
import { MktgBrandKitPageBase } from './mktg-brand-kit-page.base';

/**
 * The Example usage page (mock 14): the summary, the four sample cards from
 * the kit's examples (keynote slide on the grid ground, social card on the
 * accent in the shared ink, report cover, announcement header under the
 * spark rule), each captioned, and the table of example, format, ground
 * and accent moment. The report cover's year is the recorded approval's.
 */
@Component({
  selector: 'lfx-mktg-brand-kit-page-usage',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective, MktgBrandKitArtworkComponent],
  templateUrl: './mktg-brand-kit-page-usage.component.html',
})
export class MktgBrandKitPageUsageComponent extends MktgBrandKitPageBase {
  /** The revision's recorded approval, or null before one: the report cover's year. */
  public readonly approval = input<MktgRevisionApproval | null>(null);
  protected readonly cards = computed(() => brandKitPortraitUsageCards(this.view(), this.approval()));
  /** The social card's lockup: reversed when the shared rule inks the accent white, full colour on the kit's dark otherwise. */
  protected readonly socialMode = computed(() => (this.look().onAccent === 'white' ? 'reversed' : 'full'));
}
