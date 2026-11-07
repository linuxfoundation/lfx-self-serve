// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed } from '@angular/core';
import { brandKitPortraitFiles, brandKitPortraitHasLogoFiles } from '@lfx-one/shared/utils';
import { MktgPortraitPageComponent } from '../../components/mktg-portrait/mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../../components/mktg-portrait/mktg-portrait-rect.directive';
import { MktgBrandKitArtworkComponent } from './mktg-brand-kit-artwork.component';
import { MktgBrandKitPageBase } from './mktg-brand-kit-page.base';
import { MKTG_PORTRAIT_BLOCK_HOST } from '../../components/mktg-portrait/mktg-portrait-host';

/**
 * The Logo system page (mock 03): the intro, the primary lockup in a 240 px hero, three 224 × 150 tiles (the symbol, the reversed lockup on the dark, the stacked lockup or the symbol on the mist tint), and the logo files table. A tile whose artwork the kit lacks is left out; file names are never printed.
 */
@Component({
  selector: 'lfx-mktg-brand-kit-page-logo-system',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective, MktgBrandKitArtworkComponent],
  templateUrl: './mktg-brand-kit-page-logo-system.component.html',
  styles: [MKTG_PORTRAIT_BLOCK_HOST],
})
export class MktgBrandKitPageLogoSystemComponent extends MktgBrandKitPageBase {
  protected readonly files = computed(() => brandKitPortraitFiles(this.view()));
  protected readonly hasFiles = computed(() => brandKitPortraitHasLogoFiles(this.view()));
  protected readonly hasSymbol = computed(() => !!this.view().symbol?.src);
  protected readonly symbolSupplied = computed(() => !!this.view().logos.symbol);
  protected readonly reversedSupplied = computed(() => !!this.view().logos.reversed);
  protected readonly hasStacked = computed(() => !!this.view().logos.stacked?.src);
}
