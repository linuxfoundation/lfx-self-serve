// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input, Signal } from '@angular/core';

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
  /** Text size: `small` 13px, `default` 14px, `large` 16px. `field` is the 13px/16px line under a form field, which the field components use. */
  public readonly size = input<'field' | 'small' | 'default' | 'large'>('default');
  /** Medium-weight label before the message, such as "Error:" or "Email error:". Leave empty for none. */
  public readonly label = input<string>('');
  /** Sets `role="alert"` so the message is announced when it appears after an action. Turn it off for an error already on the page at load. */
  public readonly announce = input<boolean, unknown>(true, { transform: booleanAttribute });

  protected readonly hostClasses: Signal<string> = this.initHostClasses();
  protected readonly iconClasses: Signal<string> = this.initIconClasses();

  private initHostClasses(): Signal<string> {
    return computed(() => {
      // Type roles set size and line height (13/18, 14/20, 16/24); exact px gap, not rem; 14px root. `field` is the library's 13/16, 6px gap, centred.
      const sizes = {
        field: 'items-center gap-[6px] copy-13 leading-[16px]',
        small: 'items-start gap-[8px] copy-13',
        default: 'items-start gap-[8px] copy-14',
        large: 'items-start gap-[8px] copy-16',
      };
      const links = '[&_a]:font-medium [&_a]:underline [&_a]:underline-offset-[3px] [&_a]:text-inherit';
      return `flex text-ui-danger-700 ${sizes[this.size()]} ${links}`;
    });
  }

  private initIconClasses(): Signal<string> {
    return computed(() => {
      // Exact px sizes and nudge to centre the icon on the first line; 14px root.
      const sizes = { field: 'text-[13px]', small: 'text-[14px] pt-[2px]', default: 'text-[16px] pt-[2px]', large: 'text-[18px] pt-[3px]' };
      return `fa-light fa-circle-exclamation inline-flex ${sizes[this.size()]}`;
    });
  }
}
