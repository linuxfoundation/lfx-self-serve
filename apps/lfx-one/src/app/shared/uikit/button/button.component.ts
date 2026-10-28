// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, input, isDevMode, Signal } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Button with eight variants and three sizes. Renders a native `<button>`, or a router link when `link` is set.
 * Supports a leading and a trailing Font Awesome icon, an icon-only mode, and full width.
 */
@Component({
  selector: 'lfx-ui-button',
  imports: [NgTemplateOutlet, RouterLink],
  templateUrl: './button.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.inline-block]': '!fullWidth()',
    '[class.block]': 'fullWidth()',
  },
})
export class UiButtonComponent {
  /** Visual style. `recording` is the green variant. */
  public readonly variant = input<
    'primary' | 'outline-neutral' | 'outline-accent' | 'ghost-neutral' | 'ghost-accent' | 'destructive' | 'ghost-destructive' | 'recording'
  >('primary');
  /** `sm` is 24px tall (8px radius), `md` 32px (12px radius), `lg` 40px (16px radius). */
  public readonly size = input<'sm' | 'md' | 'lg'>('md');
  /** Font Awesome class string for a leading icon, e.g. `fa-light fa-plus`. */
  public readonly icon = input<string>('');
  /** Font Awesome class string for a trailing icon, e.g. `fa-light fa-chevron-right`. Independent of `icon`. */
  public readonly trailingIcon = input<string>('');
  /** Renders a square, icon-only button. Pair it with `ariaLabel`. */
  public readonly iconOnly = input<boolean>(false);
  /** Accessible name; required for icon-only buttons. */
  public readonly ariaLabel = input<string>('');
  /** Disables the button (or the link, when `link` is set). */
  public readonly disabled = input<boolean>(false);
  /** Stretches the button to the width of its container. */
  public readonly fullWidth = input<boolean>(false);
  /** Native button type; ignored when `link` is set. */
  public readonly type = input<'button' | 'submit' | 'reset'>('button');
  /** When set, renders a router link instead of a button. Accepts a path or a commands array. */
  public readonly link = input<string | unknown[] | null>(null);

  protected readonly classes: Signal<string> = this.initClasses();

  public constructor() {
    effect(() => {
      if (isDevMode() && this.iconOnly() && !this.ariaLabel()) {
        console.warn('lfx-ui-button: an icon-only button needs an ariaLabel.');
      }
    });
  }

  private initClasses(): Signal<string> {
    return computed(() => {
      const base =
        'inline-flex items-center justify-center whitespace-nowrap border border-transparent font-medium no-underline cursor-pointer transition duration-150 active:scale-[.97] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50';
      const variants = {
        primary: 'bg-blue-500 text-white hover:bg-blue-600 hover:shadow active:bg-blue-700 active:shadow-none',
        'outline-neutral': 'border-gray-200 text-gray-700 hover:bg-gray-100 hover:border-gray-300 hover:text-gray-900 hover:shadow-sm active:bg-gray-200',
        'outline-accent':
          'border-blue-300 text-blue-500 hover:bg-blue-50 hover:border-blue-400 hover:text-blue-600 hover:shadow-sm active:bg-blue-100 active:text-blue-700',
        'ghost-neutral': 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 active:bg-gray-200',
        'ghost-accent': 'text-blue-500 hover:bg-blue-100 hover:text-blue-600 active:bg-blue-200 active:text-blue-700',
        destructive: 'bg-red-700 text-white hover:bg-red-800 hover:shadow active:bg-red-900 active:shadow-none',
        'ghost-destructive': 'text-red-700 hover:bg-red-50 hover:text-red-800 active:bg-red-100',
        recording: 'bg-emerald-600 text-white hover:bg-emerald-700 hover:shadow active:bg-emerald-800 active:shadow-none',
      };
      // Exact px (8/12/16 radius steps): rem undershoots the design at the 14px root.
      const sizes = {
        sm: {
          text: 'h-[24px] gap-[4px] rounded-[8px] text-[12px] leading-[16px] [&>i]:text-[13px] [&>i]:leading-none',
          pad: 'px-[6px]',
          square: 'w-[24px] px-0',
        },
        md: {
          text: 'h-[32px] gap-[8px] rounded-[12px] text-[14px] leading-[20px] [&>i]:text-[14px] [&>i]:leading-none',
          pad: 'px-[12px]',
          square: 'w-[32px] px-0',
        },
        lg: {
          text: 'h-[40px] gap-[8px] rounded-[16px] text-[16px] leading-[24px] [&>i]:text-[15px] [&>i]:leading-none',
          pad: 'px-[16px]',
          square: 'w-[40px] px-0',
        },
      };
      const size = sizes[this.size()];
      const width = this.fullWidth() ? 'w-full' : '';
      return [base, variants[this.variant()], size.text, this.iconOnly() ? size.square : size.pad, width].filter(Boolean).join(' ');
    });
  }
}
