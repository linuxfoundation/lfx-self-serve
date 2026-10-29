// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  afterNextRender,
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  signal,
  Signal,
  viewChild,
} from '@angular/core';
import { UiScrollerDirection } from '@lfx-one/shared/interfaces';

/**
 * A rail or list that scrolls inside its container, with fade cues at the clipped edges and optional scroll buttons.
 * Project peer items of equal width as direct children: cards, chips or snippets.
 *
 * - `horizontal`: snaps to items, fades the start edge (24px) once scrolled and the end edge (48px) while more follows.
 * - `vertical`: fades the bottom edge (40px) while more follows, up to `maxHeight`.
 * - `both`: a free two-axis pane for wide logs and grids, with native scrollbars and no fade or buttons.
 *
 * The viewport is a focusable region named by `label`; arrow keys scroll it and focused children scroll into view.
 */
@Component({
  selector: 'lfx-ui-scroller',
  templateUrl: './scroller.component.html',
  styleUrl: './scroller.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'relative block',
    'data-testid': 'ui-scroller',
  },
})
export class UiScrollerComponent {
  private readonly destroyRef = inject(DestroyRef);

  /** Accessible name of the scrollable region, such as "Projects". Also names the scroll buttons: "Previous Projects". */
  public readonly label = input.required<string>();
  /** Scroll axis. */
  public readonly direction = input<UiScrollerDirection>('horizontal');
  /** Shows previous and next circle buttons that move one item at a time. Horizontal only; hidden while nothing overflows. */
  public readonly buttons = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Height cap in px for `vertical` and `both`, past which the content scrolls. */
  public readonly maxHeight = input<number>(220);

  protected readonly viewport = viewChild.required<ElementRef<HTMLElement>>('viewport');
  protected readonly canScrollStart = signal(false);
  protected readonly canScrollEnd = signal(false);

  protected readonly viewportClasses: Signal<string> = this.initViewportClasses();
  protected readonly fadeStart: Signal<number> = this.initFadeStart();
  protected readonly fadeEnd: Signal<number> = this.initFadeEnd();
  protected readonly showButtons: Signal<boolean> = this.initShowButtons();
  protected readonly buttonClasses: Signal<string> = this.initButtonClasses();

  public constructor() {
    // Observers read layout, so they start after the first browser render and never run on the server.
    afterNextRender(() => {
      const el = this.viewport().nativeElement;
      const resize = new ResizeObserver(() => this.measure());
      const sync = (): void => {
        resize.disconnect();
        resize.observe(el);
        Array.from(el.children).forEach((child) => resize.observe(child));
        this.measure();
      };
      const mutation = new MutationObserver(sync);
      mutation.observe(el, { childList: true });
      sync();
      this.destroyRef.onDestroy(() => {
        resize.disconnect();
        mutation.disconnect();
      });
    });
  }

  protected measure(): void {
    const el = this.viewport().nativeElement;
    const horizontal = this.direction() === 'horizontal';
    const position = horizontal ? el.scrollLeft : el.scrollTop;
    const visible = horizontal ? el.clientWidth : el.clientHeight;
    const total = horizontal ? el.scrollWidth : el.scrollHeight;
    // 1px tolerance for fractional scroll positions.
    this.canScrollStart.set(position > 1);
    this.canScrollEnd.set(position + visible < total - 1);
  }

  protected scrollByItem(sign: 1 | -1): void {
    const el = this.viewport().nativeElement;
    const [first, second] = Array.from(el.children) as HTMLElement[];
    // Distance between the first two items covers item width plus gap; a lone item scrolls a page.
    const step = first && second ? second.offsetLeft - first.offsetLeft : el.clientWidth;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: sign * step, behavior: reduced ? 'auto' : 'smooth' });
  }

  private initViewportClasses(): Signal<string> {
    return computed(() => {
      // Exact px: 12px gap and 2px padding are library steps below the ui spacing scale.
      const modes = {
        horizontal:
          'scroller-x flex snap-x snap-mandatory scroll-p-[2px] gap-[12px] overflow-x-auto p-[2px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0 [&>*]:snap-start',
        vertical: 'scroller-y flex flex-col gap-[12px] overflow-auto p-[2px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0',
        both: 'overflow-auto',
      };
      // The mask clips an outer ring, so the focus ring is drawn inside the viewport.
      return `${modes[this.direction()]} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ui-focus`;
    });
  }

  private initFadeStart(): Signal<number> {
    return computed(() => (this.direction() === 'horizontal' && this.canScrollStart() ? 24 : 0));
  }

  private initFadeEnd(): Signal<number> {
    return computed(() => {
      const sizes = { horizontal: 48, vertical: 40, both: 0 };
      return this.canScrollEnd() ? sizes[this.direction()] : 0;
    });
  }

  private initShowButtons(): Signal<boolean> {
    return computed(() => this.buttons() && this.direction() === 'horizontal' && (this.canScrollStart() || this.canScrollEnd()));
  }

  private initButtonClasses(): Signal<string> {
    // Library: small secondary circle with shadow, centred on the edge (14px out).
    return computed(
      () =>
        'absolute top-1/2 z-[1] inline-flex aspect-square h-ui-small -translate-y-1/2 cursor-pointer items-center justify-center rounded-ui-full bg-ui-background-100 text-ui-neutral-900 shadow-small transition-colors duration-ui-base ease-ui-standard hover:bg-ui-neutral-alpha-100 active:bg-ui-neutral-alpha-200 focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-ui-neutral-50 disabled:text-ui-neutral-500 disabled:shadow-border motion-reduce:transition-none'
    );
  }
}
