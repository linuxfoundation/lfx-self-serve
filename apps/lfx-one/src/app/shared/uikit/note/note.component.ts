// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input, Signal } from '@angular/core';
import { UiNoteSize } from '@lfx-one/shared/interfaces';

/** Inline message tied to the content around it: information, success, a warning or an error. */
@Component({
  selector: 'lfx-ui-note',
  templateUrl: './note.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'classes()',
    '[attr.role]': 'announce() ? "alert" : "note"',
    'data-testid': 'ui-note',
  },
})
export class UiNoteComponent {
  /** Colour and default icon. `violet` is for betas and highlights. */
  public readonly variant = input<'info' | 'secondary' | 'success' | 'warning' | 'error' | 'violet'>('info');
  /** Deepens the background to the variant's 100 step. Without it the note sits on its 50 step. */
  public readonly fill = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** `small` is 32px tall with 12px text, for dense places; `tiny` is 24px tall with 12px text, inside rows, cards and data blocks. */
  public readonly size = input<UiNoteSize>('default');
  /** Drops the background and padding: only the coloured icon and text, for a status line inside another component. Works with any size. */
  public readonly plain = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Medium-weight topic before the message, including its colon, such as `Beta:`. */
  public readonly label = input<string>('');
  /** Font Awesome icon classes that replace the variant's default icon, such as `fa-light fa-bell`. */
  public readonly icon = input<string>('');
  /** Sets `role="alert"` so screen readers announce the note right away. Use for errors that appear after an action. */
  public readonly announce = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Greys the note out (neutral background and text) for a message about something unavailable. */
  public readonly disabled = input<boolean, unknown>(false, { transform: booleanAttribute });

  protected readonly classes: Signal<string> = this.initClasses();
  protected readonly iconClasses: Signal<string> = this.initIconClasses();
  protected readonly iconWrapperClasses: Signal<string> = this.initIconWrapperClasses();

  private initClasses(): Signal<string> {
    return computed(() => {
      // A filled panel with no edge: the 50 step (100 with fill) and 800 text; secondary keeps the library's neutral-600.
      const variants = {
        info: { text: 'text-ui-accent-800', base: 'bg-ui-accent-50', fill: 'bg-ui-accent-100' },
        secondary: { text: 'text-ui-neutral-600', base: 'bg-ui-neutral-50', fill: 'bg-ui-neutral-100' },
        success: { text: 'text-ui-success-800', base: 'bg-ui-success-50', fill: 'bg-ui-success-100' },
        warning: { text: 'text-ui-warning-800', base: 'bg-ui-warning-50', fill: 'bg-ui-warning-100' },
        error: { text: 'text-ui-danger-800', base: 'bg-ui-danger-50', fill: 'bg-ui-danger-100' },
        violet: { text: 'text-ui-feature-800', base: 'bg-ui-feature-50', fill: 'bg-ui-feature-100' },
      };
      const disabled = { text: 'text-ui-neutral-500', base: 'bg-ui-neutral-50', fill: 'bg-ui-neutral-100' };
      const { text, base, fill } = this.disabled() ? disabled : variants[this.variant()];
      // Exact px, not rem; 14px root: min-height and padding are the library's 40/8/12, 32/8/12 and 24/4/8.
      const sizes = {
        default: { box: 'min-h-[40px] gap-[12px] px-[12px] py-[8px] rounded-ui-sm', type: 'copy-14' },
        small: { box: 'min-h-[32px] gap-[8px] px-[12px] py-[8px] rounded-ui-sm', type: 'label-12' },
        tiny: { box: 'min-h-[24px] gap-[6px] px-[8px] py-[4px] rounded-[8px]', type: 'label-12' },
      };
      const { box, type } = sizes[this.size()];
      if (this.plain()) return `flex items-center gap-[6px] ${text} ${type}`;
      return `flex items-center ${text} ${box} ${type} ${this.fill() ? fill : base}`;
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
    // Exact px, not rem. The icon box is one line tall (1lh), so the icon centres on the first line at every size.
    return computed(() => {
      const sizes = { default: 'text-[16px]', small: 'text-[12px]', tiny: 'text-[12px]' };
      return `inline-flex h-[1lh] items-center self-start ${sizes[this.size()]}`;
    });
  }
}
