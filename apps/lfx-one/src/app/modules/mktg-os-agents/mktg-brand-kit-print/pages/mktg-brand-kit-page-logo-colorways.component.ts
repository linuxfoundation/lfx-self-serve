// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed } from '@angular/core';
import { BrandKitColorwayTile } from '@lfx-one/shared/interfaces';
import { MktgPortraitPageComponent } from '../../components/mktg-portrait/mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../../components/mktg-portrait/mktg-portrait-rect.directive';
import { MktgBrandKitPageBase } from './mktg-brand-kit-page.base';

/**
 * The Colorways page (mock 04): the intro naming the four colorways, four 344 × 250 tiles (full colour on white, reversed on the dark, full colour on the tint, one-colour black on white), and the rules list. The tiles are the view's colorway tiles (the live grounds and filters), captioned as the mock captions them.
 */
@Component({
  selector: 'lfx-mktg-brand-kit-page-logo-colorways',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective],
  templateUrl: './mktg-brand-kit-page-logo-colorways.component.html',
})
export class MktgBrandKitPageLogoColorwaysComponent extends MktgBrandKitPageBase {
  /** The four tiles with the mock's captions: on white, on the dark (by its name), the tint's own name, print only. */
  protected readonly tiles = computed(() => {
    const view = this.view();
    const captions = [
      (name: string) => `${name} · on white`,
      (name: string) => `${name} · on ${view.darkName}`,
      (name: string) => name,
      (name: string) => `${name} · print only`,
    ];
    return view.colorways
      .filter((tile): tile is BrandKitColorwayTile & { logo: NonNullable<BrandKitColorwayTile['logo']> } => !!tile.logo?.src)
      .map((tile, index) => ({ ...tile, caption: (captions[index] ?? captions[2])(tile.name) }));
  });
  protected readonly rules = computed(() => this.view().logo.colorways);
  protected readonly intro = computed(() => {
    const [onWhite, reversed, , mono] = this.view().logo.colorways;
    return { onWhite: onWhite ?? null, reversed: reversed ?? null, mono: mono ?? null };
  });
}
