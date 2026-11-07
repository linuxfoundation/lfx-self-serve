// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed } from '@angular/core';
import { brandKitPortraitWhiteContrast } from '@lfx-one/shared/utils';
import { MktgPortraitPageComponent } from '../../components/mktg-portrait/mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../../components/mktg-portrait/mktg-portrait-rect.directive';
import { MktgBrandKitPageBase } from './mktg-brand-kit-page.base';

/**
 * The Imagery & graphic elements page (mock 13): the rule, the default grid
 * ground, three element cards (an eyebrow card carrying the kit's umbrella
 * message, the buttons, the call-out on the accent in the shared ink) with
 * their captions, and what to avoid.
 */
@Component({
  selector: 'lfx-mktg-brand-kit-page-visual-imagery',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective],
  templateUrl: './mktg-brand-kit-page-visual-imagery.component.html',
})
export class MktgBrandKitPageVisualImageryComponent extends MktgBrandKitPageBase {
  /** The call-out's caption: the ink the shared rule chose, and why when it is not white. */
  protected readonly calloutCaption = computed(() => {
    const view = this.view();
    const white = this.look().onAccent.toLowerCase() === '#ffffff' || this.look().onAccent === 'white';
    if (white) return 'Call-out · the one accent moment; text in white';
    return `Call-out · the one accent moment; text in ${view.darkName} (white on ${view.accentName} fails AA, ${brandKitPortraitWhiteContrast(view.accent).toFixed(1)}:1)`;
  });
}
