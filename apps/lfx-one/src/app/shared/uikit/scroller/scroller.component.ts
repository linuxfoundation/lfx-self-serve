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
  Injector,
  input,
  signal,
  Signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
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
 * Scroll buttons stay focusable at the ends (`aria-disabled`); if the content stops overflowing, focus moves to the viewport.
 */
@Component({
  selector: 'lfx-ui-scroller',
  templateUrl: './scroller.component.html',
  styleUrl: './scroller.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'relative block min-w-0', // min-w-0: lets the rail shrink and scroll inside a flex or grid parent
    'data-testid': 'ui-scroller',
  },
})
export class UiScrollerComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  /** Accessible name of the scrollable region, such as "Projects". Also names the scroll buttons: "Previous Projects". */
  public readonly label = input.required<string>();
  /** Scroll axis. */
  public readonly direction = input<UiScrollerDirection>('horizontal');
  /** Shows previous and next circle buttons that move one item at a time. Horizontal only; hidden while nothing overflows. */
  public readonly buttons = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Height cap in px for `vertical` and `both`, past which the content scrolls. */
  public readonly maxHeight = input<number>(220);

  protected readonly viewport = viewChild.required<ElementRef<HTMLElement>>('viewport');
  protected readonly prevButton = viewChild<ElementRef<HTMLButtonElement>>('prevBtn');
  protected readonly nextButton = viewChild<ElementRef<HTMLButtonElement>>('nextBtn');
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
      // Subtree and text changes can widen the content without resizing any observed box.
      mutation.observe(el, { childList: true, subtree: true, characterData: true });
      sync();
      this.destroyRef.onDestroy(() => {
        resize.disconnect();
        mutation.disconnect();
      });
    });
    // A new axis changes the layout without resizing what the observers watch, so measure once it has rendered.
    toObservable(this.direction)
      .pipe(takeUntilDestroyed())
      .subscribe(() => afterNextRender(() => this.measure(), { injector: this.injector }));
    // Runs before the template drops a focused scroller button, whatever removed it (overflow, `buttons` or `direction`).
    toObservable(this.showButtons)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.keepFocusOnViewport());
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
    // The buttons use aria-disabled so they keep focus at the ends; the click is ignored instead.
    if (sign === 1 ? !this.canScrollEnd() : !this.canScrollStart()) return;
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
      // The mask would clip a ring on this element, so the wrapper in the template draws the focus ring.
      return `${modes[this.direction()]} focus-visible:outline-none`;
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
    // shortcut: native button styled like the library's circle button. revisit: when lfx-ui-button realigns to the library, swap to it.
    return computed(
      () =>
        'absolute top-1/2 z-[1] inline-flex aspect-square h-ui-small -translate-y-1/2 cursor-pointer items-center justify-center rounded-ui-full bg-ui-background-100 text-ui-neutral-900 shadow-small transition-colors duration-ui-base ease-ui-standard hover:bg-ui-neutral-alpha-100 active:bg-ui-neutral-alpha-200 focus-visible:shadow-focus focus-visible:outline-none aria-disabled:cursor-not-allowed aria-disabled:bg-ui-neutral-50 aria-disabled:text-ui-neutral-500 aria-disabled:shadow-border aria-disabled:focus-visible:shadow-focus motion-reduce:transition-none'
    );
  }

  /** When the scroller's own buttons are about to be removed because nothing overflows any more, focus moves to the viewport. */
  private keepFocusOnViewport(): void {
    const active = document.activeElement;
    const ownButtons = [this.prevButton()?.nativeElement, this.nextButton()?.nativeElement];
    if (!this.showButtons() && ownButtons.some((button) => button === active)) {
      this.viewport().nativeElement.focus();
    }
  }
}
