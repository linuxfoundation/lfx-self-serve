// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, Signal } from '@angular/core';

/**
 * A plain error message in red with an icon, for under a form field, after a failed action or in an empty panel.
 * The message is projected content, so it can hold a link to the fix; links inherit the red and are underlined.
 */
@Component({
  selector: 'lfx-ui-error',
  templateUrl: './error.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'hostClasses()',
    '[attr.role]': 'announce() ? "alert" : null',
    'data-testid': 'ui-error',
  },
})
export class UiErrorComponent {
  /** Text size: `small` 13px, `default` 14px, `large` 16px. */
  public readonly size = input<'small' | 'default' | 'large'>('default');
  /** Bold label before the message, such as "Error:" or "Email error:". Leave empty for none. */
  public readonly label = input<string>('');
  /** Sets `role="alert"` so the message is announced when it appears after an action. Turn it off for an error already on the page at load. */
  public readonly announce = input<boolean>(true);

  protected readonly hostClasses: Signal<string> = this.initHostClasses();
  protected readonly iconClasses: Signal<string> = this.initIconClasses();

  private initHostClasses(): Signal<string> {
    return computed(() => {
      // Type roles set size and line height (13/18, 14/20, 16/24); exact px gap, not rem; 14px root.
      const sizes = { small: 'copy-13', default: 'copy-14', large: 'copy-16' };
      const links = '[&_a]:font-medium [&_a]:underline [&_a]:underline-offset-[3px] [&_a]:text-inherit';
      return `flex items-start gap-[8px] text-ui-danger-700 ${sizes[this.size()]} ${links}`;
    });
  }

  private initIconClasses(): Signal<string> {
    return computed(() => {
      // Exact px sizes and nudge to centre the icon on the first line; 14px root.
      const sizes = { small: 'text-[14px] pt-[2px]', default: 'text-[16px] pt-[2px]', large: 'text-[18px] pt-[3px]' };
      return `fa-light fa-circle-exclamation inline-flex ${sizes[this.size()]}`;
    });
  }
}
