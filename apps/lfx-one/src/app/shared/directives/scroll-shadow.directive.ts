// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, DestroyRef, Directive, ElementRef, inject, input, signal } from '@angular/core';

@Directive({
  selector: '[lfxScrollShadow]',
  standalone: true,
})
export class ScrollShadowDirective {
  // Horizontal scroll shadows
  public readonly showLeftShadow = signal(false);
  public readonly showRightShadow = signal(false);

  // Vertical scroll shadows
  public readonly showTopShadow = signal(false);
  public readonly showBottomShadow = signal(false);

  public readonly scrollDistance = input(300);

  private readonly el = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);

  public constructor() {
    afterNextRender(() => {
      const container = this.el.nativeElement;
      container.addEventListener('scroll', this.scrollHandler);
      setTimeout(() => this.updateScrollShadows(), 0);

      this.destroyRef.onDestroy(() => {
        container.removeEventListener('scroll', this.scrollHandler);
      });
    });
  }

  public scrollLeft(): void {
    const container = this.el.nativeElement;
    container.scrollBy({ left: -this.scrollDistance(), behavior: 'smooth' });
  }

  public scrollRight(): void {
    const container = this.el.nativeElement;
    container.scrollBy({ left: this.scrollDistance(), behavior: 'smooth' });
  }

  private scrollHandler = (): void => this.updateScrollShadows();

  private updateScrollShadows(): void {
    const container = this.el.nativeElement;

    // Horizontal scroll detection
    const isHorizontallyScrollable = container.scrollWidth > container.clientWidth;
    if (isHorizontallyScrollable) {
      // Show right shadow if not at end
      const isAtEnd = container.scrollLeft + container.clientWidth >= container.scrollWidth - 1;
      this.showRightShadow.set(!isAtEnd);

      // Show left shadow if not at start
      const isAtStart = container.scrollLeft <= 0;
      this.showLeftShadow.set(!isAtStart);
    } else {
      this.showRightShadow.set(false);
      this.showLeftShadow.set(false);
    }

    // Vertical scroll detection
    const isVerticallyScrollable = container.scrollHeight > container.clientHeight;
    if (isVerticallyScrollable) {
      // Show bottom shadow if not at end
      const isAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 1;
      this.showBottomShadow.set(!isAtBottom);

      // Show top shadow if not at start
      const isAtTop = container.scrollTop <= 0;
      this.showTopShadow.set(!isAtTop);
    } else {
      this.showBottomShadow.set(false);
      this.showTopShadow.set(false);
    }
  }
}
