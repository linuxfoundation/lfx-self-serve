// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CdkMenuTrigger } from '@angular/cdk/menu';
import { NgTemplateOutlet } from '@angular/common';
import {
  afterRenderEffect,
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  isDevMode,
  Signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { UiButtonSize, UiButtonVariant, UiTooltipSide } from '@lfx-one/shared/interfaces';

import { UiSpinnerComponent } from '../spinner/spinner.component';
import { UiTooltipDirective } from '../tooltip/tooltip.directive';

/**
 * Button with eight variants and three sizes. Renders a native `<button>`, or a router link when `link` is set.
 * Supports a leading and a trailing Font Awesome icon, an icon-only circle, a loading state and full width.
 *
 * Tooltip: put `lfxUiTooltip` (and the optional `lfxUiTooltipTitle`, `lfxUiTooltipShortcut`, `lfxUiTooltipSide`, `lfxUiTooltipDelay`,
 * `lfxUiTooltipDisabled`) on `<lfx-ui-button>` and the button forwards them to its inner `<button>`, where the spoken description belongs.
 * `UiTooltipDirective` never attaches to `<lfx-ui-button>` itself, so importing it for other elements in the same template is safe.
 * A disabled button gets no pointer events, so a tooltip that explains why it is off needs a wrapper element that carries the directive.
 *
 * Menu: pass an `lfx-ui-menu` template to `menu` and the inner `<button>` becomes its trigger (`aria-haspopup`, `aria-expanded`, focus returns
 * to the button on close). A button rendered as a link (`link`) does not open a menu.
 */
@Component({
  selector: 'lfx-ui-button',
  imports: [NgTemplateOutlet, RouterLink, CdkMenuTrigger, UiSpinnerComponent, UiTooltipDirective],
  templateUrl: './button.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.inline-block]': '!fullWidth()',
    '[class.block]': 'fullWidth()',
    '[class.pointer-events-none]': 'disabled() || loading()',
  },
})
export class UiButtonComponent {
  /** Visual style. `primary` is the one main action of a view; `secondary` suits every other action; `danger` confirms a destructive one; `recording` is the green start/stop-recording action. */
  public readonly variant = input<UiButtonVariant>('primary');
  /** `tiny` is 24px tall, `small` 32px and `medium` 40px. */
  public readonly size = input<UiButtonSize>('medium');
  /** Font Awesome class string for a leading icon, e.g. `fa-light fa-plus`. Replaced by a spinner while `loading`. */
  public readonly icon = input<string>('');
  /** Font Awesome class string for a trailing icon, e.g. `fa-light fa-chevron-right`. Independent of `icon`. */
  public readonly trailingIcon = input<string>('');
  /** Renders a circular, icon-only button. Pair it with `ariaLabel` and a tooltip. */
  public readonly iconOnly = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Accessible name; required for icon-only buttons. */
  public readonly ariaLabel = input<string>('');
  /** Writes `aria-expanded` on the inner element for a button that shows or hides content, such as `lfx-ui-show-more`. Leave `null` for no attribute. Not used with `menu`, whose trigger sets it. */
  public readonly ariaExpanded = input<boolean | null>(null);
  /** Writes `aria-controls` on the inner element: the id of the content this button shows or hides. */
  public readonly ariaControls = input<string>('');
  /** Disables the button (or the link, when `link` is set). */
  public readonly disabled = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Swaps the leading icon for a spinner, keeps the label and sets `aria-busy`. The button ignores clicks until it is cleared. */
  public readonly loading = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Stretches the button to the width of its container. */
  public readonly fullWidth = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Native button type; ignored when `link` is set. */
  public readonly type = input<'button' | 'submit' | 'reset'>('button');
  /** Template reference of an `lfx-ui-menu` to open from the button, such as `#actions`. Ignored when `link` is set. */
  public readonly menu = input<TemplateRef<unknown> | null>(null);
  /** When set, renders a router link instead of a button. Accepts a path or a commands array. */
  public readonly link = input<string | unknown[] | null>(null);
  /* eslint-disable @angular-eslint/no-input-rename -- the aliases are the public input names of UiTooltipDirective, which this button forwards to its inner element. */
  /** Tooltip text, forwarded to the inner button. An empty value shows nothing. See `lfxUiTooltip` for the full contract. */
  public readonly tooltip = input<string>('', { alias: 'lfxUiTooltip' });
  /** Bold first line of the rich tooltip layout. */
  public readonly tooltipTitle = input<string>('', { alias: 'lfxUiTooltipTitle' });
  /** Keys shown as key caps after the tooltip text, such as `['⌘', 'K']`. */
  public readonly tooltipShortcut = input<string[]>([], { alias: 'lfxUiTooltipShortcut' });
  /** Preferred tooltip side; it flips when it does not fit. */
  public readonly tooltipSide = input<UiTooltipSide>('top', { alias: 'lfxUiTooltipSide' });
  /** Milliseconds between hover or keyboard focus and the tooltip appearing. */
  public readonly tooltipDelay = input<number>(300, { alias: 'lfxUiTooltipDelay' });
  /** Turns the tooltip off without removing it. */
  public readonly tooltipDisabled = input<boolean, unknown>(false, { alias: 'lfxUiTooltipDisabled', transform: booleanAttribute });

  /* eslint-enable @angular-eslint/no-input-rename */

  /** Icon and spinner size in px: 12 on a tiny button, 16 otherwise. */
  protected readonly iconSize: Signal<number> = this.initIconSize();
  protected readonly classes: Signal<string> = this.initClasses();
  /** A disabled link leaves the tab order; a loading link stays focusable because it has no href while busy. */
  protected readonly linkTabIndex: Signal<number | null> = this.initLinkTabIndex();

  private readonly menuTrigger = viewChild(CdkMenuTrigger);

  public constructor() {
    effect(() => {
      if (isDevMode() && this.iconOnly() && !this.ariaLabel()) {
        console.warn('lfx-ui-button: an icon-only button needs an ariaLabel.');
      }
    });
    // Dropping the trigger's template does not close a menu that is already open, so close it when the button turns busy.
    afterRenderEffect(() => {
      if (this.loading()) this.menuTrigger()?.close();
    });
  }

  // A busy button keeps focus and its look, so keyboard activation is stopped here instead of with `disabled`.
  // A disabled link has no native `disabled` either, so a programmatic click is stopped the same way.
  protected onClick(event: Event): void {
    if (!this.loading() && !(this.link() !== null && this.disabled())) return;
    event.preventDefault();
    event.stopPropagation();
  }

  private initIconSize(): Signal<number> {
    return computed(() => (this.size() === 'tiny' ? 12 : 16));
  }

  private initLinkTabIndex(): Signal<number | null> {
    return computed(() => {
      if (this.disabled()) return -1;
      return this.loading() ? 0 : null;
    });
  }

  private initClasses(): Signal<string> {
    return computed(() => {
      const base =
        'relative inline-flex select-none [&>i]:leading-none items-center justify-center whitespace-nowrap no-underline transition-[background-color,box-shadow,color] duration-ui-base ease-ui-standard motion-reduce:transition-none focus-visible:shadow-focus focus-visible:outline-none';
      // shortcut: hover/active mixes spelled out with var(). revisit: when the library ships hover/active mix tokens
      const variants = {
        primary:
          'bg-ui-accent-500 text-ui-white hover:bg-[color-mix(in_srgb,var(--ui-accent-500)_86%,var(--ui-slate-900))] active:bg-[color-mix(in_srgb,var(--ui-accent-500)_76%,var(--ui-slate-900))]',
        secondary: 'bg-ui-background-100 text-ui-neutral-900 edge hover:bg-ui-neutral-alpha-100 active:bg-ui-neutral-alpha-200',
        // The 1px ring geometry is arbitrary and its colour comes from the shadow colour utility, so the focus ring can replace it.
        'secondary-accent':
          'bg-ui-background-100 text-ui-accent-500 shadow-[0_0_0_1px] shadow-ui-accent-300 hover:bg-ui-accent-50 hover:text-ui-accent-700 active:bg-ui-accent-100',
        tertiary: 'bg-transparent text-ui-neutral-900 hover:bg-ui-neutral-alpha-100 active:bg-ui-neutral-alpha-200',
        'tertiary-accent': 'bg-transparent text-ui-accent-500 hover:bg-ui-accent-50 hover:text-ui-accent-700 active:bg-ui-accent-100',
        danger:
          'bg-ui-danger-600 text-ui-white hover:bg-[color-mix(in_srgb,var(--ui-danger-600)_86%,var(--ui-slate-900))] active:bg-[color-mix(in_srgb,var(--ui-danger-600)_76%,var(--ui-slate-900))]',
        'danger-tertiary': 'bg-transparent text-ui-danger-700 hover:bg-ui-danger-50 active:bg-ui-danger-100',
        // Not in the library: the epic's proposed green action, styled like primary on the success steps.
        recording:
          'bg-ui-success-600 text-ui-white hover:bg-[color-mix(in_srgb,var(--ui-success-600)_86%,var(--ui-slate-900))] active:bg-[color-mix(in_srgb,var(--ui-success-600)_76%,var(--ui-slate-900))]',
      };
      // Disabled looks the same for every variant; the tertiary family stays transparent and ringless.
      const flat = ['tertiary', 'tertiary-accent', 'danger-tertiary'].includes(this.variant());
      const disabled = flat ? 'bg-transparent text-ui-neutral-500' : 'bg-ui-neutral-50 text-ui-neutral-500 edge';
      // Exact px: the 8px and 10px radii, the 4/6/8px gaps and the 8/10/16px padding are library steps with no ui-* utility at the 14px root.
      const sizes = {
        tiny: { box: 'h-ui-tiny gap-[4px] button-12 [&>i]:text-[12px]', radius: 'rounded-[8px]', pad: 'px-[8px]' },
        small: { box: 'h-ui-small gap-[6px] button-14 [&>i]:text-[16px]', radius: 'rounded-[10px]', pad: 'px-[10px]' },
        medium: { box: 'h-ui-medium gap-[8px] button-14 [&>i]:text-[16px]', radius: 'rounded-ui-sm', pad: 'px-[16px]' },
      };
      const size = sizes[this.size()];
      // Icon-only is a circle: square from the height, no padding.
      const shape = this.iconOnly() ? 'aspect-square rounded-ui-full' : `${size.radius} ${size.pad}`;
      return [
        base,
        this.disabled() ? disabled : variants[this.variant()],
        size.box,
        shape,
        this.fullWidth() ? 'w-full' : '',
        this.disabled() || this.loading() ? 'pointer-events-none' : 'cursor-pointer',
      ]
        .filter(Boolean)
        .join(' ');
    });
  }
}
