// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input, Signal } from '@angular/core';

/** Inline message tied to the content around it: information, success, a warning or an error. */
@Component({
  selector: 'lfx-ui-note',
  templateUrl: './note.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'classes()',
    '[attr.role]': 'alert() ? "alert" : "note"',
    'data-testid': 'ui-note',
  },
})
export class UiNoteComponent {
  /** Colour and default icon. `violet` is for betas and highlights. */
  public readonly variant = input<'info' | 'secondary' | 'success' | 'warning' | 'error' | 'violet'>('info');
  /** Adds the tinted background. Without it the note is an outline only. */
  public readonly fill = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** `small` is 32px tall with 13px text, for dense places. */
  public readonly size = input<'default' | 'small'>('default');
  /** Medium-weight topic before the message, including its colon, such as `Beta:`. */
  public readonly label = input<string>('');
  /** Font Awesome icon classes that replace the variant's default icon, such as `fa-light fa-bell`. */
  public readonly icon = input<string>('');
  /** Announces the note to screen readers right away. Use for errors that appear after an action. */
  public readonly alert = input<boolean, unknown>(false, { transform: booleanAttribute });

  protected readonly classes: Signal<string> = this.initClasses();
  protected readonly iconClasses: Signal<string> = this.initIconClasses();
  protected readonly iconWrapperClasses: Signal<string> = this.initIconWrapperClasses();

  private initClasses(): Signal<string> {
    return computed(() => {
      // Text is the 700 step on the tinted variants; secondary keeps the library's neutral-600. The ring is a 1px inset edge.
      const variants = {
        info: { ring: 'ring-ui-accent-200', text: 'text-ui-accent-700', fill: 'bg-ui-accent-50' },
        secondary: { ring: 'ring-ui-neutral-alpha-200', text: 'text-ui-neutral-600', fill: 'bg-ui-neutral-50' },
        success: { ring: 'ring-ui-success-200', text: 'text-ui-success-700', fill: 'bg-ui-success-50' },
        warning: { ring: 'ring-ui-warning-200', text: 'text-ui-warning-700', fill: 'bg-ui-warning-50' },
        error: { ring: 'ring-ui-danger-200', text: 'text-ui-danger-700', fill: 'bg-ui-danger-50' },
        violet: { ring: 'ring-ui-feature-200', text: 'text-ui-feature-700', fill: 'bg-ui-feature-50' },
      };
      const { ring, text, fill } = variants[this.variant()];
      // Exact px, not rem; 14px root: min-height and padding are the library's 40/8/12 and 32/6/10.
      const sizes = {
        default: 'min-h-[40px] gap-[12px] px-[12px] py-[8px] copy-14',
        small: 'min-h-[32px] gap-[8px] px-[10px] py-[6px] copy-13',
      };
      return `flex items-center rounded-ui-sm ring-1 ring-inset ${ring} ${text} ${sizes[this.size()]} ${this.fill() ? fill : ''}`;
    });
  }

  private initIconClasses(): Signal<string> {
    return computed(() => {
      const icons = {
        info: 'fa-light fa-circle-info',
        secondary: 'fa-light fa-circle-info',
        success: 'fa-light fa-circle-check',
        warning: 'fa-light fa-triangle-exclamation',
        error: 'fa-light fa-circle-exclamation',
        violet: 'fa-light fa-wand-magic-sparkles',
      };
      return this.icon() || icons[this.variant()];
    });
  }

  private initIconWrapperClasses(): Signal<string> {
    // Exact px, not rem; 14px root: 16px (14px small) icon nudged 2px down to sit on the first text line.
    return computed(() => `inline-flex self-start pt-[2px] ${this.size() === 'small' ? 'text-[14px]' : 'text-[16px]'}`);
  }
}
