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
  effect,
  ElementRef,
  inject,
  input,
  isDevMode,
  output,
  signal,
  Signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { UiButtonSize, UiSplitButtonVariant } from '@lfx-one/shared/interfaces';

import { UiButtonComponent } from '../button/button.component';
import { UiTooltipDirective } from '../tooltip/tooltip.directive';

/**
 * A main action joined to a menu of closely related alternatives, such as "Deploy" with a chevron that opens "Schedule Deploy" and "Deploy Branch".
 * Use it when one action is clearly the default and two to five variants of it sit next to it; unrelated actions belong in a plain menu.
 * Repeat the main action as the first menu item. The main half is an `lfx-ui-button`; the chevron half is a native button that carries the CDK menu trigger,
 * so it gets `aria-haspopup="menu"` and `aria-expanded` from the CDK. Arrow keys, Home, End, type-ahead and Escape work inside the menu, and Escape returns focus to the chevron.
 *
 * The menu opens below the split button and lines up with its start edge, then falls back to its end edge, then above, when it does not fit.
 * A `click` listener on `<lfx-ui-split-button>` hears both halves; listen to `triggered` for the main action only.
 *
 * Without a `menu`, the right half is a second action instead: an icon button named and tooltipped by `secondaryTooltip`
 * that emits `secondaryTriggered`, such as "Recording" joined to a "Copy recording link" button. Give it a `secondaryLabel`
 * and it becomes a labelled pair: two equal actions side by side, such as "Registration trend" and "Snapshot".
 *
 * ```html
 * <lfx-ui-split-button label="Deploy" [menu]="deployMenu" (triggered)="deploy()" />
 * <ng-template #deployMenu>
 *   <lfx-ui-menu ariaLabel="Deploy options">
 *     <lfx-ui-menu-item (triggered)="deploy()">Deploy</lfx-ui-menu-item>
 *     <lfx-ui-menu-item icon="fa-light fa-clock">Schedule Deploy</lfx-ui-menu-item>
 *   </lfx-ui-menu>
 * </ng-template>
 * <lfx-ui-split-button label="Recording" variant="recording" secondaryIcon="fa-light fa-link" secondaryTooltip="Copy recording link" (triggered)="play()" (secondaryTriggered)="copy()" />
 * <lfx-ui-split-button label="Trend" icon="fa-light fa-chart-line" variant="secondary" secondaryLabel="Snapshot" secondaryIcon="fa-light fa-table-list" (triggered)="trend()" (secondaryTriggered)="snapshot()" />
 * ```
 */
@Component({
  selector: 'lfx-ui-split-button',
  imports: [CdkMenuTrigger, UiButtonComponent, UiTooltipDirective],
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
  /** The menu to open from the chevron: an `<ng-template>` that holds an `lfx-ui-menu`. Leave it out to make the right half an action. */
  public readonly menu = input<TemplateRef<unknown> | null>(null);
  /** `primary` is the accent fill, `secondary` the neutral one and `recording` the green one. Never destructive. */
  public readonly variant = input<UiSplitButtonVariant>('primary');
  /** `tiny` is 24px tall, `small` 28px, `default` 32px and `large` 40px. Both halves share it; the chevron half is a square. */
  public readonly size = input<UiButtonSize>('default');
  /** Font Awesome class string for a leading icon on the main action, e.g. `fa-light fa-rocket`. */
  public readonly icon = input<string>('');
  /** Accessible name of the chevron half. Defaults to "More options for" and the `label`. */
  public readonly menuLabel = input<string>('');
  /** Disables both halves. They keep the variant's colours at 45% opacity. */
  public readonly disabled = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Font Awesome class string for the right half when there is no `menu`, e.g. `fa-light fa-link`. */
  public readonly secondaryIcon = input<string>('');
  /** Tooltip and accessible name of the right half when there is no `menu`, e.g. "Copy recording link". Optional once `secondaryLabel` names it; set both only when the tooltip adds to the label. */
  public readonly secondaryTooltip = input<string>('');
  /** Visible text of the right half when there is no `menu`, e.g. "Snapshot". It turns the icon square into a labelled button, so the pair reads as two equal actions. */
  public readonly secondaryLabel = input<string>('');
  /** Emits when the main action is activated by click, Enter or Space. The chevron half never emits it. */
  public readonly triggered = output<void>();
  /** Emits when the right half is activated and there is no `menu`. */
  public readonly secondaryTriggered = output<void>();

  /** Distance in px (fractional, so the menu edge is exact) from the split button's start edge to the chevron half, so the menu can line up with the whole control. */
  private readonly chevronOffset = signal(0);

  protected readonly chevronName: Signal<string> = this.initChevronName();
  protected readonly chevronClasses: Signal<string> = this.initChevronClasses();
  protected readonly menuPositions: Signal<ConnectedPosition[]> = this.initMenuPositions();

  public constructor() {
    effect(() => {
      if (!isDevMode() || this.menu()) return;
      if (this.secondaryLabel()) return;
      if (!this.secondaryTooltip()) console.warn('lfx-ui-split-button: without a menu, the action half needs a secondaryTooltip or a secondaryLabel.');
      if (!this.secondaryIcon()) console.warn('lfx-ui-split-button: without a menu, the action half needs a secondaryIcon or a secondaryLabel.');
    });
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
      // Exact px: the button's 4px ui-accent-100 focus halo.
      const labelled = !this.menu() && !!this.secondaryLabel();
      const base =
        'relative inline-flex shrink-0 items-center justify-center rounded-l-none border leading-none transition-[background-color,border-color,box-shadow,color] duration-ui-base ease-ui-standard motion-reduce:transition-none focus:outline-none focus-visible:z-10 focus-visible:shadow-[0_0_0_4px] focus-visible:shadow-ui-accent-100 forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-[color:Highlight] hover:z-10';
      // Same heights and corner radii as the matching lfx-ui-button size. Exact px: the 10/11/14px radii have no ui-* utility.
      const sizes = {
        tiny: 'h-ui-tiny rounded-r-[10px]',
        small: 'h-ui-xsmall rounded-r-[11px]',
        default: 'h-ui-small rounded-r-ui-sm',
        large: 'h-ui-medium rounded-r-[14px]',
      };
      // An icon half sizes its glyph with the text size; a labelled half sizes only its icon, so its text keeps the button's type.
      const glyphs = { tiny: 'text-[12px]', small: 'text-[13px]', default: 'text-[14px]', large: 'text-[18px]' };
      // A labelled half takes the button's own padding, gap and type for its size; an icon half stays a square.
      const labelledSizes = {
        tiny: 'gap-[4px] px-[8px] button-12 [&>i]:text-[12px]',
        small: 'gap-[4px] px-[8px] button-14 text-[13px]/[18px] [&>i]:text-[13px]',
        default: 'gap-[6px] px-[10px] button-14 [&>i]:text-[14px]',
        large: 'gap-[8px] px-[16px] button-14 [&>i]:text-[18px]',
      };
      const shape = labelled ? labelledSizes[this.size()] : `aspect-square p-0 ${glyphs[this.size()]}`;
      // The borders of two neighbouring halves overlap by 1px; the filled variants have a transparent border and get a divider instead.
      // shortcut: hover/active mixes spelled out with var(), matching lfx-ui-button. revisit: when the library ships hover/active mix tokens.
      const variants = {
        primary:
          'border-transparent bg-ui-accent-500 text-ui-white hover:bg-[color-mix(in_srgb,var(--ui-accent-500)_86%,var(--ui-slate-900))] active:bg-[color-mix(in_srgb,var(--ui-accent-500)_76%,var(--ui-slate-900))]',
        // The divider is an inset shadow: white at 30%, so it shows on the green fill in both themes.
        recording:
          'border-transparent bg-ui-success-600 text-ui-white shadow-[inset_1px_0_0_color-mix(in_srgb,var(--ui-white)_30%,transparent)] hover:bg-[color-mix(in_srgb,var(--ui-success-600)_86%,var(--ui-slate-900))] active:bg-[color-mix(in_srgb,var(--ui-success-600)_76%,var(--ui-slate-900))]',
        secondary: '-ml-px border-ui-neutral-alpha-300 bg-ui-background-100 text-ui-neutral-900 hover:bg-ui-neutral-alpha-50 active:bg-ui-neutral-alpha-100',
      };
      // Disabled keeps the variant's colours at 45% opacity without hover or pressed steps; the glyph takes no pointer, so the native disabled button gets the click.
      const disabled = `${variants[this.variant()]
        .split(' ')
        .filter((c) => !/^(hover|active):/.test(c))
        .join(' ')} opacity-45 cursor-not-allowed [&_*]:pointer-events-none`;
      return [base, shape, sizes[this.size()], this.disabled() ? disabled : `cursor-pointer ${variants[this.variant()]}`].join(' ');
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
