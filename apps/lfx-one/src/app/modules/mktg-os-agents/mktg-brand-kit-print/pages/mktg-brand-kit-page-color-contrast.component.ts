// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed } from '@angular/core';
import { brandKitPortraitContrastMatrix, brandKitPortraitGradePill } from '@lfx-one/shared/utils';
import { MktgPortraitPageComponent } from '../../components/mktg-portrait/mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../../components/mktg-portrait/mktg-portrait-rect.directive';
import { MktgBrandKitPageBase } from './mktg-brand-kit-page.base';
import { MKTG_PORTRAIT_BLOCK_HOST } from '../../components/mktg-portrait/mktg-portrait-host';

/**
 * The Color contrast page (mock 10): the kit's rule, the matrix of every
 * palette pairing with its WCAG ratio computed (shared util) and graded
 * unrounded, then the kit's own pairs as a list with their recorded grade.
 */
@Component({
  selector: 'lfx-mktg-brand-kit-page-color-contrast',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective],
  templateUrl: './mktg-brand-kit-page-color-contrast.component.html',
  styles: [MKTG_PORTRAIT_BLOCK_HOST],
})
export class MktgBrandKitPageColorContrastComponent extends MktgBrandKitPageBase {
  /** The matrix, every cell graded on its unrounded ratio and labelled to one decimal (shared util). */
  protected readonly matrix = computed(() => brandKitPortraitContrastMatrix(this.view()));
  /** The kit's own pairs as the web view prints them: its ratio label (`8.3:1`) and its recorded grade. */
  protected readonly pairs = computed(() => this.view().contrast.map((row) => ({ ...row, pill: brandKitPortraitGradePill(row.grade) })));
}
