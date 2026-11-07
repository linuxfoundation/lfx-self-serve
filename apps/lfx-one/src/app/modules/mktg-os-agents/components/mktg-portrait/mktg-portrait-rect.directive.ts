// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, Directive, input } from '@angular/core';

/**
 * The portrait grammar's absolute placement, `R(x, y, w, h)`: a block set at
 * `x`,`y` px from the frame's top left, `w` px wide and, when `h` is given
 * and not 0, `h` px tall (0 lets the block take its content's height, as
 * the design's `R()` does). The one place the frame's coordinates are set,
 * so a page's layout is its measurements, not a sheet of inline styles.
 *
 * `<div [lfxPpRect]="[56, 136, 704]">` or `[lfxPpRect]="[56, 232, 704, 240]"`. The
 * host also carries `data-pp-rect`, the e2e specs' handle on every placed box.
 */
@Directive({
  selector: '[lfxPpRect]',
  host: {
    class: 'pp-r',
    '[attr.data-pp-rect]': "''",
    '[style.left.px]': 'left()',
    '[style.top.px]': 'top()',
    '[style.width.px]': 'width()',
    '[style.height.px]': 'height()',
  },
})
export class MktgPortraitRectDirective {
  /** `[x, y, w]` or `[x, y, w, h]`, px. */
  public readonly lfxPpRect = input.required<readonly [number, number, number] | readonly [number, number, number, number]>();
  protected readonly left = computed(() => this.lfxPpRect()[0]);
  protected readonly top = computed(() => this.lfxPpRect()[1]);
  protected readonly width = computed(() => this.lfxPpRect()[2]);
  protected readonly height = computed(() => {
    const rect = this.lfxPpRect();
    return rect.length === 4 && rect[3] > 0 ? rect[3] : null;
  });
}
