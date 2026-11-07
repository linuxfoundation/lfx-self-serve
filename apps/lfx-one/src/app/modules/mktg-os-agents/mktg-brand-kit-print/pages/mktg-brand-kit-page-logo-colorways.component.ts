// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed } from '@angular/core';
import { BrandKitColorway } from '@lfx-one/shared/interfaces';
import { mktgPortraitTailFor, mktgPortraitWithTail } from '@lfx-one/shared/utils';
import { MktgPortraitPageComponent } from '../../components/mktg-portrait/mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../../components/mktg-portrait/mktg-portrait-rect.directive';
import { MktgBrandKitPageBase } from './mktg-brand-kit-page.base';
import { MKTG_PORTRAIT_BLOCK_HOST } from '../../components/mktg-portrait/mktg-portrait-host';

/**
 * The Colorways page (mock 04): the intro naming the four colorways, four 344 × 250 tiles (full colour on white, reversed on the dark, full colour on the tint, one-colour black on white), and the rules list. The tiles are the view's colorway tiles (the live grounds and filters), captioned as the mock captions them.
 */
@Component({
  selector: 'lfx-mktg-brand-kit-page-logo-colorways',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective],
  templateUrl: './mktg-brand-kit-page-logo-colorways.component.html',
  styles: [MKTG_PORTRAIT_BLOCK_HOST],
})
export class MktgBrandKitPageLogoColorwaysComponent extends MktgBrandKitPageBase {
  /**
   * The four tiles with the mock's captions: on white, on the dark (by its name), the tint's own name, print only; a
   * caption whose colorway name already says its ground prints it once ("Full color · on white", not "… · on white").
   */
  protected readonly tiles = computed(() => {
    const view = this.view();
    const captions = [
      (name: string) => mktgPortraitWithTail(name, ' · ', 'on white'),
      (name: string) => mktgPortraitWithTail(name, ' · ', `on ${view.darkName}`),
      (name: string) => name,
      (name: string) => mktgPortraitWithTail(name, ' · ', 'print only'),
    ];
    // Each caption belongs to its tile's place in the kit's four colorways, so it is assigned before a tile without
    // artwork is left out (one missing tile must not shift the captions of the rest). A tile whose colorway the kit
    // did not supply and the book cannot derive (a multi-colour primary) stays, and prints its "Not supplied" line.
    return view.colorways
      .map((tile, index) => ({ ...tile, caption: (captions[index] ?? captions[2])(tile.name) }))
      .filter((tile) => !!tile.logo?.src || !!tile.missing);
  });
  /** The rules as `name — logo on ground.`, the dash and its clause left out when the name already says them (the ground printed once). */
  protected readonly rules = computed(() =>
    this.view().logo.colorways.map((rule) => ({ name: rule.name, tail: mktgPortraitTailFor(rule.name, ' — ', `${rule.logo} on ${rule.ground}`) }))
  );
  /** The lead's three clauses, each the colorway's name and its ground unless the name says it already. */
  protected readonly intro = computed(() => {
    const [onWhite, reversed, , mono] = this.view().logo.colorways;
    const clause = (colorway: BrandKitColorway | undefined, leadIn: string, tail: (ground: string) => string): { name: string; tail: string } | null =>
      colorway ? { name: colorway.name, tail: mktgPortraitTailFor(colorway.name, leadIn, tail(colorway.ground)) } : null;
    return {
      onWhite: clause(onWhite, ' ', (ground) => `on ${ground}`),
      reversed: clause(reversed, ' (white) ', (ground) => `on ${ground}`),
      mono: clause(mono, ' ', (ground) => `for ${ground}`),
    };
  });
}
