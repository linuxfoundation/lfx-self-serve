// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CdkMenuTrigger } from '@angular/cdk/menu';
import { ConnectedPosition } from '@angular/cdk/overlay';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  afterRenderEffect,
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  isDevMode,
  Signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { UiButtonSize, UiButtonVariant, UiMenuAlign, UiPopoverContext, UiPopoverPadding, UiTooltipSide } from '@lfx-one/shared/interfaces';

import { UiPopoverDirective } from '../popover/popover.directive';
import { UiSpinnerComponent } from '../spinner/spinner.component';
import { UiTooltipDirective } from '../tooltip/tooltip.directive';

/**
 * Button with eight variants and four sizes (tiny 24px, small 28px, default 32px, large 40px). Renders a native `<button>`, or a router link when `link` is set.
 * Supports a leading and a trailing Font Awesome icon, an icon-only circle, a loading state and full width.
 *
 * Tooltip: put `lfxUiTooltip` (and the optional `lfxUiTooltipTitle`, `lfxUiTooltipIcon`, `lfxUiTooltipShortcut`, `lfxUiTooltipSide`, `lfxUiTooltipDelay`,
 * `lfxUiTooltipDisabled`) on `<lfx-ui-button>` and the button forwards them to its inner `<button>`, where the spoken description belongs.
 * `UiTooltipDirective` never attaches to `<lfx-ui-button>` itself, so importing it for other elements in the same template is safe.
 * A disabled button takes no clicks or focus and drops its forwarded tooltip, so a tooltip that explains why it is off needs a wrapper element that carries the directive.
 *
 * Menu: pass an `lfx-ui-menu` template to `menu` and the inner `<button>` becomes its trigger (`aria-haspopup`, `aria-expanded`, focus returns
 * to the button on close). `menuAlign="end"` lines the menu up with the button's end edge, for a trigger at a row's end. A button rendered as a link (`link`) does not open a menu.
 *
 * Popover: pass an `<ng-template>` to `popover` and the inner `<button>` opens it as a non-modal dialog (`aria-haspopup="dialog"`, `aria-expanded`,
 * `aria-controls`, focus returns to the button on close). `popoverLabel` names the dialog, `popoverWidth` fixes its width in px, `popoverPadding="none"` drops its 16px padding and `popoverAlign="end"` opens it from the end edge; see `lfxUiPopover`.
 * A link does not open one, and `menu` wins when both are set.
 */
@Component({
  selector: 'lfx-ui-button',
  imports: [NgTemplateOutlet, RouterLink, CdkMenuTrigger, UiPopoverDirective, UiSpinnerComponent, UiTooltipDirective],
  templateUrl: './button.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.inline-block]': '!fullWidth()',
    '[class.block]': 'fullWidth()',
    '[class.pointer-events-none]': 'disabled() || loading()',
  },
})
export class UiButtonComponent {
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** Visual style. `primary` is the one main action of a view; `secondary` suits every other action; `danger` confirms a destructive one; `recording` is the green start/stop-recording action. */
  public readonly variant = input<UiButtonVariant>('primary');
  /** `tiny` is 24px tall, `small` 28px, `default` 32px and `large` 40px. Pair `large` with a 40px input, `default` with a 32px one and `tiny` with a 24px one. */
  public readonly size = input<UiButtonSize>('default');
  /** Font Awesome class string for a leading icon, e.g. `fa-light fa-plus`. Use the Light weight unless another weight shows a state. Replaced by a spinner while `loading`. */
  public readonly icon = input<string>('');
  /** Font Awesome class string for a trailing icon, e.g. `fa-light fa-chevron-right`. Independent of `icon`. */
  public readonly trailingIcon = input<string>('');
  /** Renders a circular, icon-only button. Pair it with `ariaLabel` and a tooltip. */
  public readonly iconOnly = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Accessible name; required for icon-only buttons. */
  public readonly ariaLabel = input<string>('');
  /** Writes `aria-expanded` on the inner element for a button that shows or hides content, such as `lfx-ui-show-more`. Leave `null` for no attribute. Not used with `menu` or `popover`, whose triggers set it. */
  public readonly ariaExpanded = input<boolean | null>(null);
  /** Writes `aria-controls` on the inner element: the id of the content this button shows or hides. Not used with `menu` or `popover`. */
  public readonly ariaControls = input<string>('');
  /** Writes `aria-pressed` on a plain button that toggles; leave `null` for no attribute. Not used with `link`, `menu` or `popover`. */
  public readonly ariaPressed = input<boolean | null>(null);
  /** Writes `aria-describedby` on a plain button: the id of text that describes it. Not used with `link`, `menu` or `popover`. */
  public readonly ariaDescribedBy = input<string>('');
  /** Disables the button (or the link, when `link` is set). It keeps the variant's colours at 45% opacity. */
  public readonly disabled = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Swaps the leading icon for a spinner, keeps the label and sets `aria-busy`. The button ignores clicks until it is cleared. */
  public readonly loading = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Stretches the button to the width of its container. */
  public readonly fullWidth = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Native button type; ignored when `link` is set. */
  public readonly type = input<'button' | 'submit' | 'reset'>('button');
  /** Template reference of an `lfx-ui-menu` to open from the button, such as `#actions`. Ignored when `link` is set. */
  public readonly menu = input<TemplateRef<unknown> | null>(null);
  /** `start` (default) opens the menu from the button's start edge; `end` lines it up with the end edge so it extends back toward the start. */
  public readonly menuAlign = input<UiMenuAlign>('start');
  /** Template reference of the content to open from the button as a popover, such as `#filters`. Ignored when `link` or `menu` is set. */
  public readonly popover = input<TemplateRef<UiPopoverContext> | null>(null);
  /** Accessible name of the popover dialog. Without one the button names it. */
  public readonly popoverLabel = input<string>('');
  /** Fixed width of the popover in px. Without it the panel is as wide as its content. */
  public readonly popoverWidth = input<number | null>(null);
  /** `none` removes the popover panel's 16px padding for content that runs edge to edge. */
  public readonly popoverPadding = input<UiPopoverPadding>('default');
  /** `end` opens the popover lined up with the button's end edge, toward the start side. */
  public readonly popoverAlign = input<UiMenuAlign>('start');
  /** When set, renders a router link instead of a button. Accepts a path or a commands array. */
  public readonly link = input<string | unknown[] | null>(null);
  /* eslint-disable @angular-eslint/no-input-rename -- the aliases are the public input names of UiTooltipDirective, which this button forwards to its inner element. */
  /** Tooltip text, forwarded to the inner button. An empty value shows nothing. See `lfxUiTooltip` for the full contract. */
  public readonly tooltip = input<string>('', { alias: 'lfxUiTooltip' });
  /** Bold first line of the rich tooltip layout. */
  public readonly tooltipTitle = input<string>('', { alias: 'lfxUiTooltipTitle' });
  /** Font Awesome classes for an icon before the tooltip title. */
  public readonly tooltipIcon = input<string>('', { alias: 'lfxUiTooltipIcon' });
  /** Keys shown as key caps after the tooltip text, such as `['⌘', 'K']`. */
  public readonly tooltipShortcut = input<string[]>([], { alias: 'lfxUiTooltipShortcut' });
  /** Preferred tooltip side; it flips when it does not fit. */
  public readonly tooltipSide = input<UiTooltipSide>('top', { alias: 'lfxUiTooltipSide' });
  /** Milliseconds between hover or keyboard focus and the tooltip appearing. */
  public readonly tooltipDelay = input<number>(300, { alias: 'lfxUiTooltipDelay' });
  /** Turns the tooltip off without removing it. */
  public readonly tooltipDisabled = input<boolean, unknown>(false, { alias: 'lfxUiTooltipDisabled', transform: booleanAttribute });

  /* eslint-enable @angular-eslint/no-input-rename */

  /** Icon and spinner size in px: 12 on a tiny button, 13 on a small one, 14 on a default one and 18 on a large one. */
  protected readonly iconSize: Signal<number> = this.initIconSize();
  protected readonly classes: Signal<string> = this.initClasses();
  /** A disabled link leaves the tab order; a loading link stays focusable because it has no href while busy. */
  protected readonly linkTabIndex: Signal<number | null> = this.initLinkTabIndex();
  protected readonly menuPositions: Signal<ConnectedPosition[]> = this.initMenuPositions();

  private readonly menuTrigger = viewChild(CdkMenuTrigger);
  private readonly menuButton = viewChild(CdkMenuTrigger, { read: ElementRef });

  public constructor() {
    effect(() => {
      if (isDevMode() && this.iconOnly() && !this.ariaLabel()) {
        console.warn('lfx-ui-button: an icon-only button needs an ariaLabel.');
      }
    });
    // Dropping the trigger's template does not close a menu that is already open, so close it when the button turns busy.
    // `close()` does not restore focus, so a focus that was inside the menu moves back to the button.
    afterRenderEffect(() => {
      const trigger = this.menuTrigger();
      if (!this.loading() || !trigger?.isOpen()) return;
      const hadFocus = trigger.getMenu()?.nativeElement.contains(this.document.activeElement);
      trigger.close();
      if (hadFocus) this.menuButton()?.nativeElement.focus();
    });
  }

  /** Focuses the inner `<button>` or `<a>`, for a caller that returns focus to this button, such as a chip whose neighbour was removed. */
  public focus(): void {
    this.host.querySelector<HTMLElement>('button, a')?.focus();
  }

  // A busy button keeps focus and its look, so keyboard activation is stopped here instead of with `disabled`.
  // A disabled link has no native `disabled` either, so a programmatic click is stopped the same way.
  protected onClick(event: Event): void {
    if (!this.loading() && !(this.link() !== null && this.disabled())) return;
    event.preventDefault();
    event.stopPropagation();
  }

  // `tabindex="-1"` keeps a disabled link mouse-focusable, so the press is stopped from focusing it.
  protected onMouseDown(event: MouseEvent): void {
    if (this.disabled()) event.preventDefault();
  }

  private initIconSize(): Signal<number> {
    return computed(() => ({ tiny: 12, small: 13, default: 14, large: 18 })[this.size()]);
  }

  // Below the trigger first, flipping above it, then trying the other edge when the preferred one does not fit.
  private initMenuPositions(): Signal<ConnectedPosition[]> {
    return computed(() => {
      const start: ConnectedPosition[] = [
        { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top' },
        { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom' },
      ];
      const end: ConnectedPosition[] = [
        { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top' },
        { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom' },
      ];
      return this.menuAlign() === 'end' ? [...end, ...start] : [...start, ...end];
    });
  }

  private initLinkTabIndex(): Signal<number | null> {
    return computed(() => {
      if (this.disabled()) return -1;
      return this.loading() ? 0 : null;
    });
  }

  private initClasses(): Signal<string> {
    return computed(() => {
      // Exact px: the library's 4px ui-accent-100 focus halo; forced-colors drops shadows, so an outline marks focus there.
      const base =
        'relative inline-flex select-none [&>i]:leading-none items-center justify-center whitespace-nowrap no-underline border transition-[background-color,border-color,box-shadow,color] duration-ui-base ease-ui-standard motion-reduce:transition-none focus:outline-none focus-visible:shadow-[0_0_0_4px] focus-visible:shadow-ui-accent-100 forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-[color:Highlight]';
      // shortcut: hover/active mixes spelled out with var(). revisit: when the library ships hover/active mix tokens
      const variants = {
        primary:
          'border-transparent bg-ui-accent-500 text-ui-white hover:bg-[color-mix(in_srgb,var(--ui-accent-500)_86%,var(--ui-slate-900))] active:bg-[color-mix(in_srgb,var(--ui-accent-500)_76%,var(--ui-slate-900))]',
        secondary: 'border-ui-neutral-alpha-300 bg-ui-background-100 text-ui-neutral-900 hover:bg-ui-neutral-alpha-50 active:bg-ui-neutral-alpha-100',
        'secondary-accent':
          'border-ui-accent-300 bg-ui-background-100 text-ui-accent-500 hover:border-ui-accent-500 hover:bg-ui-accent-100 active:border-ui-accent-500 active:bg-ui-accent-200',
        tertiary: 'border-transparent bg-transparent text-ui-neutral-900 hover:bg-ui-neutral-alpha-50 active:bg-ui-neutral-alpha-100',
        'tertiary-accent': 'border-transparent bg-transparent text-ui-accent-500 hover:bg-ui-accent-100 active:bg-ui-accent-200',
        danger:
          'border-transparent bg-ui-danger-600 text-ui-white hover:bg-[color-mix(in_srgb,var(--ui-danger-600)_86%,var(--ui-slate-900))] active:bg-[color-mix(in_srgb,var(--ui-danger-600)_76%,var(--ui-slate-900))]',
        'danger-tertiary': 'border-transparent bg-transparent text-ui-danger-700 hover:bg-ui-danger-50 active:bg-ui-danger-100',
        // Not in the library: the epic's proposed green action, styled like primary on the success steps.
        recording:
          'border-transparent bg-ui-success-600 text-ui-white hover:bg-[color-mix(in_srgb,var(--ui-success-600)_86%,var(--ui-slate-900))] active:bg-[color-mix(in_srgb,var(--ui-success-600)_76%,var(--ui-slate-900))]',
      };
      // Disabled keeps the variant's colours at 45% opacity and drops its hover and pressed steps.
      const variant = this.disabled()
        ? `${variants[this.variant()]
            .split(' ')
            .filter((c) => !/^(hover|active):/.test(c))
            .join(' ')} opacity-45`
        : variants[this.variant()];
      // Exact px: the 10/11/14px radii, the 4/6/8px gaps, the 8/10/16px padding, the 13px label and the 12/13/14/18px icons have no ui-* utility at the 14px root.
      const sizes = {
        tiny: { box: 'h-ui-tiny gap-[4px] button-12 [&>i]:text-[12px]', radius: 'rounded-[10px]', pad: 'px-[8px]' },
        small: { box: 'h-ui-xsmall gap-[4px] button-14 text-[13px]/[18px] [&>i]:text-[13px]', radius: 'rounded-[11px]', pad: 'px-[8px]' },
        default: { box: 'h-ui-small gap-[6px] button-14 [&>i]:text-[14px]', radius: 'rounded-ui-sm', pad: 'px-[10px]' },
        large: { box: 'h-ui-medium gap-[8px] button-14 [&>i]:text-[18px]', radius: 'rounded-[14px]', pad: 'px-[16px]' },
      };
      const size = sizes[this.size()];
      // Icon-only is a circle: square from the height, no padding.
      const shape = this.iconOnly() ? 'aspect-square rounded-ui-full' : `${size.radius} ${size.pad}`;
      // A link keeps its label colour in every state and is never underlined; important beats page link styles outside the utilities layer.
      const linkInks = {
        primary: '!text-ui-white',
        secondary: '!text-ui-neutral-900',
        'secondary-accent': '!text-ui-accent-500',
        tertiary: '!text-ui-neutral-900',
        'tertiary-accent': '!text-ui-accent-500',
        danger: '!text-ui-white',
        'danger-tertiary': '!text-ui-danger-700',
        recording: '!text-ui-white',
      };
      // Disabled: only the inner element takes the pointer, for the cursor; a click on the native disabled button is never dispatched.
      let pointer = this.loading() ? 'pointer-events-none' : 'cursor-pointer';
      if (this.disabled()) pointer = 'pointer-events-auto cursor-not-allowed [&_*]:pointer-events-none';
      return [
        base,
        variant,
        size.box,
        shape,
        this.fullWidth() ? 'w-full' : '',
        this.link() !== null ? `!no-underline ${linkInks[this.variant()]}` : '',
        pointer,
      ]
        .filter(Boolean)
        .join(' ');
    });
  }
}
