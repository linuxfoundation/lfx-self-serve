// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed } from '@angular/core';
import { brandKitPortraitAttributesFit } from '@lfx-one/shared/utils';
import { MktgPortraitPageComponent } from '../../components/mktg-portrait/mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../../components/mktg-portrait/mktg-portrait-rect.directive';
import { MktgBrandKitPageBase } from './mktg-brand-kit-page.base';

/**
 * The Voice in brief page (mock 15): where the voice comes from and the
 * note, the umbrella message and the brand line, and the attributes in two
 * columns, the first under the spark rule and the rest under the accent, the
 * grid fitted to its room (`brandKitPortraitAttributesFit`).
 * The mock's "Say" and "Avoid → say instead" blocks are the messaging
 * framework's, which the kit does not hold, so they are not printed.
 */
@Component({
  selector: 'lfx-mktg-brand-kit-page-voice',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective],
  templateUrl: './mktg-brand-kit-page-voice.component.html',
})
export class MktgBrandKitPageVoiceComponent extends MktgBrandKitPageBase {
  /** The attributes fitted to the grid's room (more than four, or long lines, set the grid smaller together). */
  protected readonly attributes = computed(() => brandKitPortraitAttributesFit(this.view().voice.attributes));
  protected readonly intro = computed(() => {
    const { source, note } = this.view().voice;
    const lead = source.trim().replace(/\.$/, '');
    return [lead ? `${lead}.` : '', note.trim()].filter((part) => part !== '').join(' ');
  });
}
