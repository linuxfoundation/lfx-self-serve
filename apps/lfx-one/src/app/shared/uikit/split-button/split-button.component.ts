// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CdkMenuTrigger } from '@angular/cdk/menu';
import { ConnectedPosition } from '@angular/cdk/overlay';
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
  output,
  signal,
  Signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { UiButtonSize, UiSplitButtonVariant } from '@lfx-one/shared/interfaces';

import { UiButtonComponent } from '../button/button.component';

/**
 * A main action joined to a menu of closely related alternatives, such as "Deploy" with a chevron that opens "Schedule Deploy" and "Deploy Branch".
 * Use it when one action is clearly the default and two to five variants of it sit next to it; unrelated actions belong in a plain menu.
 * Repeat the main action as the first menu item. The main half is an `lfx-ui-button`; the chevron half is a native button that carries the CDK menu trigger,
 * so it gets `aria-haspopup="menu"` and `aria-expanded` from the CDK. Arrow keys, Home, End, type-ahead and Escape work inside the menu, and Escape returns focus to the chevron.
 *
 * The menu opens below the split button and lines up with its start edge, then falls back to its end edge, then above, when it does not fit.
 * A `click` listener on `<lfx-ui-split-button>` hears both halves; listen to `triggered` for the main action only.
 *
 * ```html
 * <lfx-ui-split-button label="Deploy" [menu]="deployMenu" (triggered)="deploy()" />
 * <ng-template #deployMenu>
 *   <lfx-ui-menu ariaLabel="Deploy options">
 *     <lfx-ui-menu-item (triggered)="deploy()">Deploy</lfx-ui-menu-item>
 *     <lfx-ui-menu-item icon="fa-light fa-clock">Schedule Deploy</lfx-ui-menu-item>
 *   </lfx-ui-menu>
 * </ng-template>
 * ```
 */
@Component({
  selector: 'lfx-ui-split-button',
  imports: [CdkMenuTrigger, UiButtonComponent],
  templateUrl: './split-button.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'relative isolate inline-flex',
    'data-testid': 'ui-split-button',
  },
})
export class UiSplitButtonComponent {
  private readonly hostElement = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly chevron = viewChild.required<ElementRef<HTMLButtonElement>>('chevron');

  /** Text of the main action, such as "Deploy". It also names the menu half: "More options for Deploy". */
  public readonly label = input.required<string>();
  /** The menu to open from the chevron: an `<ng-template>` that holds an `lfx-ui-menu`. */
  public readonly menu = input.required<TemplateRef<unknown>>();
  /** `primary` is the accent fill; `secondary` is the neutral one. Never destructive. */
  public readonly variant = input<UiSplitButtonVariant>('primary');
  /** `tiny` is 24px tall, `small` 32px and `medium` 40px. Both halves share it; the chevron half is a square. */
  public readonly size = input<UiButtonSize>('medium');
  /** Font Awesome class string for a leading icon on the main action, e.g. `fa-light fa-rocket`. */
  public readonly icon = input<string>('');
  /** Accessible name of the chevron half. Defaults to "More options for" and the `label`. */
  public readonly menuLabel = input<string>('');
  /** Disables both halves. */
  public readonly disabled = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Emits when the main action is activated by click, Enter or Space. The chevron half never emits it. */
  public readonly triggered = output<void>();

  /** Distance in px (fractional, so the menu edge is exact) from the split button's start edge to the chevron half, so the menu can line up with the whole control. */
  private readonly chevronOffset = signal(0);

  protected readonly chevronName: Signal<string> = this.initChevronName();
  protected readonly chevronClasses: Signal<string> = this.initChevronClasses();
  protected readonly menuPositions: Signal<ConnectedPosition[]> = this.initMenuPositions();

  public constructor() {
    afterNextRender(() => {
      const measure = (): void => {
        const host = this.hostElement.nativeElement;
        const hostRect = host.getBoundingClientRect();
        // A scaled ancestor (the modal enters at scale 0.96) shrinks the rects, so divide by the scale to get layout px; within half a px counts as unscaled.
        const scale = host.offsetWidth && Math.abs(hostRect.width - host.offsetWidth) > 0.5 ? hostRect.width / host.offsetWidth : 1;
        this.chevronOffset.set((this.chevron().nativeElement.getBoundingClientRect().left - hostRect.left) / scale);
      };
      measure();
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(measure);
      observer.observe(this.hostElement.nativeElement);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  private initChevronName(): Signal<string> {
    return computed(() => this.menuLabel() || `More options for ${this.label()}`);
  }

  private initChevronClasses(): Signal<string> {
    return computed(() => {
      const base =
        'relative inline-flex aspect-square shrink-0 items-center justify-center rounded-l-none p-0 leading-none transition-[background-color,box-shadow,color] duration-ui-base ease-ui-standard motion-reduce:transition-none focus-visible:z-10 focus-visible:shadow-focus focus-visible:outline-none hover:z-10';
      // Same heights and corner radii as the matching lfx-ui-button size. Exact px: the 8px and 10px radii have no ui-* utility; 12px glyph on tiny, 16px otherwise.
      const sizes = {
        tiny: 'h-ui-tiny rounded-r-[8px] text-[12px]',
        small: 'h-ui-small rounded-r-[10px] text-[16px]',
        medium: 'h-ui-medium rounded-r-ui-sm text-[16px]',
      };
      // The rings of two neighbouring halves overlap by 1px; the primary fill has no ring and gets a divider instead.
      // shortcut: hover/active mixes spelled out with var(), matching lfx-ui-button. revisit: when the library ships hover/active mix tokens.
      const variants = {
        primary:
          'bg-ui-accent-500 text-ui-white hover:bg-[color-mix(in_srgb,var(--ui-accent-500)_86%,var(--ui-slate-900))] active:bg-[color-mix(in_srgb,var(--ui-accent-500)_76%,var(--ui-slate-900))]',
        secondary: '-ml-px bg-ui-background-100 text-ui-neutral-900 edge hover:bg-ui-neutral-alpha-100 active:bg-ui-neutral-alpha-200',
      };
      const disabled = '-ml-px pointer-events-none bg-ui-neutral-50 text-ui-neutral-500 edge';
      return [base, sizes[this.size()], this.disabled() ? disabled : `cursor-pointer ${variants[this.variant()]}`].join(' ');
    });
  }

  private initMenuPositions(): Signal<ConnectedPosition[]> {
    // The trigger is the chevron, so a start-aligned menu shifts left by the main half's width to line up with the whole control.
    return computed(() => {
      const offsetX = -this.chevronOffset();
      return [
        { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetX },
        { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top' },
        { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetX },
        { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom' },
      ];
    });
  }
}
