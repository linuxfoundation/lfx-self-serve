// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, Signal } from '@angular/core';

/** A title and a value for short metadata such as Region, Plan, Owner or Created, rendered as a definition list. */
@Component({
  selector: 'lfx-ui-description',
  templateUrl: './description.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0', 'data-testid': 'ui-description' },
})
export class UiDescriptionComponent {
  /** The title, in Title Case, such as "Contributors". */
  public readonly label = input.required<string>();
  /** The value shown under the title. */
  public readonly value = input<string>('');
  /** Aligns the title and value to the right and sets the value in tabular figures, for numbers. */
  public readonly align = input<'left' | 'right'>('left');
  /** Truncates a long value to one line with an ellipsis and shows the full value in a native tooltip. Needs a width limit on the host. */
  public readonly ellipsis = input<boolean>(false);
  /** Help text for a small question-mark icon after the title. It becomes the icon's accessible name and native tooltip. Leave empty for no icon. */
  public readonly help = input<string>('');

  protected readonly listClasses: Signal<string> = this.initListClasses();
  protected readonly valueClasses: Signal<string> = this.initValueClasses();

  private initListClasses(): Signal<string> {
    return computed(() => {
      // Exact px gap, not rem; 14px root.
      const base = 'flex min-w-0 flex-col gap-[4px]';
      return this.align() === 'right' ? `${base} items-end text-right` : base;
    });
  }

  private initValueClasses(): Signal<string> {
    return computed(() => {
      const base = 'copy-14 min-w-0 text-ui-neutral-900';
      return [base, this.ellipsis() ? 'truncate' : '', this.align() === 'right' ? 'tabular-nums' : ''].filter(Boolean).join(' ');
    });
  }
}
