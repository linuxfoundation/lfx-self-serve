// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, computed, DestroyRef, Directive, ElementRef, inject, input, signal } from '@angular/core';
import { mktgPortraitPlateFit, mktgPortraitPlateRadius } from '@lfx-one/shared/utils';

/**
 * The white plate under artwork a dark ground cannot reverse: the span
 * around the artwork's `img`, given the plate's OUTER height in px (or
 * `null` for no plate: the span is then bare). The plate pads the artwork
 * by half its drawn height and rounds its corners by a sixth of its shorter
 * side (`MKTG_PORTRAIT_PLATE`); the artwork's width, which the shorter side
 * may be, is read from the image once it has loaded (in the browser only),
 * and until then the plate reads as wide, the lockups' usual shape.
 *
 * `<span [lfxPpPlate]="logo.plate ? 168 : null"><img [style.height.px]="84" …/></span>`.
 * A plate carries `data-testid="mktg-portrait-plate"`, the specs' handle.
 */
@Directive({
  selector: '[lfxPpPlate]',
  host: {
    '[class.pp-plate]': 'plated()',
    '[attr.data-testid]': "plated() ? 'mktg-portrait-plate' : null",
    '[style.padding.px]': 'padding()',
    '[style.border-radius.px]': 'radius()',
  },
})
export class MktgPortraitPlateDirective {
  /** The plate's outer height in px, or `null` for no plate. */
  public readonly lfxPpPlate = input.required<number | null>();
  protected readonly plated = computed(() => this.lfxPpPlate() !== null);
  protected readonly padding = computed(() => {
    const height = this.lfxPpPlate();
    return height === null ? null : mktgPortraitPlateFit(height).padding;
  });
  protected readonly radius = computed(() => {
    const height = this.lfxPpPlate();
    if (height === null) return null;
    const ratio = this.ratio();
    const { height: drawn, padding } = mktgPortraitPlateFit(height);
    return mktgPortraitPlateRadius(ratio === null ? null : drawn * ratio + 2 * padding, height);
  });
  /** The artwork's width over its height, once the image has loaded; `null` until then. */
  private readonly ratio = signal<number | null>(null);

  public constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef);
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const img = host.nativeElement.querySelector('img');
      if (!img) return;
      const measure = (): void => {
        if (img.naturalWidth > 0 && img.naturalHeight > 0) this.ratio.set(img.naturalWidth / img.naturalHeight);
      };
      if (img.complete) measure();
      img.addEventListener('load', measure);
      destroyRef.onDestroy(() => img.removeEventListener('load', measure));
    });
  }
}
