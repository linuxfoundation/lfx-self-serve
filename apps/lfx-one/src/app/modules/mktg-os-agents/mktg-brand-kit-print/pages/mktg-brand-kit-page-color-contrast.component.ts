// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed } from '@angular/core';
import { brandKitPortraitContrastGrade, brandKitPortraitContrastMatrix } from '@lfx-one/shared/utils';
import { MktgPortraitPageComponent } from '../../components/mktg-portrait/mktg-portrait-page/mktg-portrait-page.component';
import { MktgPortraitRectDirective } from '../../components/mktg-portrait/mktg-portrait-rect.directive';
import { MktgBrandKitPageBase } from './mktg-brand-kit-page.base';

/**
 * The Color contrast page (mock 10): the kit's rule, the matrix of every
 * palette pairing with its WCAG ratio computed here and graded, then the
 * kit's own pairs as a list.
 */
@Component({
  selector: 'lfx-mktg-brand-kit-page-color-contrast',
  imports: [MktgPortraitPageComponent, MktgPortraitRectDirective],
  templateUrl: './mktg-brand-kit-page-color-contrast.component.html',
})
export class MktgBrandKitPageColorContrastComponent extends MktgBrandKitPageBase {
  protected readonly matrix = computed(() =>
    brandKitPortraitContrastMatrix(this.view()).map((row) => ({
      ...row,
      cells: row.cells.map((cell) => ({
        ...cell,
        grade: cell.ratio === null ? null : brandKitPortraitContrastGrade(cell.ratio),
        label: cell.ratio?.toFixed(1) ?? '',
      })),
    }))
  );
  protected readonly pairs = computed(() =>
    this.view().contrast.map((row) => {
      const ratio = Number.parseFloat(row.ratio);
      return {
        ...row,
        ratioLabel: Number.isFinite(ratio) ? `${ratio.toFixed(2)}:1` : row.ratio,
        pill: brandKitPortraitContrastGrade(Number.isFinite(ratio) ? ratio : 0),
      };
    })
  );
}
