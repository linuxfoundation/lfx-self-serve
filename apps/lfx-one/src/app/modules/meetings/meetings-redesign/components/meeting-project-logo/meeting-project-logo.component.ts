// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, ChangeDetectionStrategy, Component, computed, ElementRef, input, Signal, signal, viewChild } from '@angular/core';

/** 16px project or foundation logo tile on the meetings home; a layer-group glyph stands in when there is no logo. */
@Component({
  selector: 'lfx-meeting-project-logo',
  templateUrl: './meeting-project-logo.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Exact [Npx] design values: rem undershoots at the 14px root.
  host: {
    class: 'inline-flex h-[16px] w-[16px] flex-none items-center justify-center overflow-hidden rounded-[5px] bg-white ring-1 ring-gray-200',
    'aria-hidden': 'true',
  },
})
export class MeetingProjectLogoComponent {
  /** Logo URL; empty when the project has none. */
  public readonly src = input<string>('');

  private readonly failedSrc = signal<string>('');
  private readonly logoEl = viewChild<ElementRef<HTMLImageElement>>('logoImg');

  protected readonly logo: Signal<string> = computed(() => {
    const src = this.src();
    return src && src !== this.failedSrc() ? src : '';
  });

  public constructor() {
    // An image that failed before hydration never fires `error`; decode it once after the first render.
    afterNextRender(() => {
      const img = this.logoEl()?.nativeElement;
      const src = this.src();
      if (img?.complete) {
        img.decode().catch(() => {
          if (this.src() === src) this.failedSrc.set(src);
        });
      }
    });
  }

  protected onLogoError(src: string): void {
    this.failedSrc.set(src);
  }
}
