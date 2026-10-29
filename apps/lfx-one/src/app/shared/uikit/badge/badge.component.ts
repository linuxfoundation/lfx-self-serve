// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, Signal } from '@angular/core';
import { UiBadgeTone } from '@lfx-one/shared/interfaces';

/**
 * Small pill that labels a status, category or plan, such as "Beta", "Secure" or "Gold". Project the text as content.
 * Add `title` on the element for icon-only or ambiguous badges. Never rely on colour alone: the text carries the meaning.
 */
@Component({
  selector: 'lfx-ui-badge',
  templateUrl: './badge.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'classes()',
    'data-testid': 'ui-badge',
  },
})
export class UiBadgeComponent {
  /** Colour role. `neutral` is the default; `accent` comes first among the coloured roles. Ignored by the `outline` form. */
  public readonly tone = input<UiBadgeTone>('neutral');
  /** `subtle` is the role's 100 fill with 700 text, the default for most UI. `solid` is the role's solid fill with white text (slate-900 on warning). `outline` is neutral metadata: a hairline ring on the page background. */
  public readonly variant = input<'subtle' | 'solid' | 'outline'>('subtle');
  /** `sm` is 20px tall with 11px text; `md` is 24px tall with 12px text. */
  public readonly size = input<'sm' | 'md'>('md');
  /** Shows a 6px status dot before the text in the given role colour, for plain status badges such as "Active". */
  public readonly dot = input<UiBadgeTone | null>(null);

  protected readonly classes: Signal<string> = this.initClasses();
  protected readonly dotClasses: Signal<string> = this.initDotClasses();

  private initClasses(): Signal<string> {
    return computed(() => {
      // Exact px, not rem: the app root font is 14px, so rem utilities undershoot the design.
      const base = 'inline-flex items-center gap-[4px] rounded-ui-full font-medium whitespace-nowrap tabular-nums';
      const sizes = {
        sm: 'h-[20px] px-[6px] text-[11px] leading-[16px] [&_svg]:h-[10px] [&_svg]:w-[10px] [&_i]:text-[10px]',
        md: 'h-ui-tiny px-[10px] text-label-12 [&_svg]:h-[12px] [&_svg]:w-[12px] [&_i]:text-[12px]',
      };
      const solid: Record<UiBadgeTone, string> = {
        // shortcut: dark theme not handled (light only). revisit: when a theme switch lands — library pins neutral solid to slate-600 in both themes
        neutral: 'bg-ui-neutral-600 text-white',
        accent: 'bg-ui-accent-500 text-white',
        feature: 'bg-ui-feature-600 text-white',
        // Tokens ink note: slate-900 on ui-warning-500; white on amber is about 2:1.
        warning: 'bg-ui-warning-500 text-ui-neutral-900',
        danger: 'bg-ui-danger-600 text-white',
        success: 'bg-ui-success-600 text-white',
      };
      const subtle: Record<UiBadgeTone, string> = {
        neutral: 'bg-ui-neutral-100 text-ui-neutral-900',
        accent: 'bg-ui-accent-100 text-ui-accent-700',
        feature: 'bg-ui-feature-100 text-ui-feature-700',
        warning: 'bg-ui-warning-100 text-ui-warning-700',
        danger: 'bg-ui-danger-100 text-ui-danger-700',
        success: 'bg-ui-success-100 text-ui-success-700',
      };
      const tone = this.tone();
      const looks = { solid: solid[tone], subtle: subtle[tone], outline: 'bg-ui-background-100 text-ui-neutral-900 edge' };
      const look = looks[this.variant()];
      return `${base} ${sizes[this.size()]} ${look}`;
    });
  }

  private initDotClasses(): Signal<string> {
    return computed(() => {
      const fills: Record<UiBadgeTone, string> = {
        neutral: 'bg-ui-neutral-600',
        accent: 'bg-ui-accent-500',
        feature: 'bg-ui-feature-600',
        warning: 'bg-ui-warning-500',
        danger: 'bg-ui-danger-600',
        success: 'bg-ui-success-600',
      };
      const dot = this.dot();
      return dot ? fills[dot] : '';
    });
  }
}
