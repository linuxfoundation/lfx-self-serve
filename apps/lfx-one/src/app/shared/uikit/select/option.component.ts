// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { booleanAttribute, ChangeDetectionStrategy, Component, computed, inject, input, Signal } from '@angular/core';
import { UiOption } from '@lfx-one/shared/interfaces';

import { UiOptionHost } from './option-host';

/**
 * One choice of an `lfx-ui-select`: `<lfx-ui-option value="cncf" label="CNCF">...</lfx-ui-option>`. The projected content is the row, so it can
 * hold an avatar, a badge or a second line of description. Without content the row shows `label`. `label` stays required: it is the text the
 * trigger shows once the option is picked, and what type-ahead matches. Give the content its own text for screen readers; the row's accessible
 * name comes from it.
 *
 */
@Component({
  selector: 'lfx-ui-option',
  templateUrl: './option.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'option',
    '[id]': 'id',
    '[class]': 'hostClasses()',
    '[attr.aria-selected]': 'isSelected()',
    '[attr.aria-disabled]': 'disabled() ? "true" : null',
    '[attr.data-highlighted]': 'isActive() ? "" : null',
    '(click)': 'pick()',
    '(mousemove)': 'highlight()',
    'data-testid': 'ui-option',
  },
})
export class UiOptionComponent {
  protected readonly host = inject(UiOptionHost);

  /** Stable identifier written to the form control. Unique within the list. */
  public readonly value = input.required<string>();
  /** Plain text of the choice: shown in the trigger once picked and matched by type-ahead. Also the row's content when none is projected. */
  public readonly label = input.required<string>();
  /** The option stays visible but cannot be picked, and the keyboard skips it. */
  public readonly disabled = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Font Awesome class string for a leading icon, e.g. `fa-light fa-globe`. A picked option's icon also replaces the select's `prefixIcon`. */
  public readonly icon = input<string>('');

  public readonly id = inject(_IdGenerator).getId('lfx-ui-option-');
  /** The option as the list sees it: live plain properties, stable for the life of the row. */
  public readonly item: UiOption = this.initItem();

  protected readonly isSelected: Signal<boolean> = computed(() => this.host.isSelected(this.item));
  protected readonly isActive: Signal<boolean> = computed(() => this.host.isActive(this.item));
  protected readonly hostClasses: Signal<string> = this.initHostClasses();

  protected pick(): void {
    this.host.pick(this.item);
  }

  protected highlight(): void {
    this.host.highlight(this.item);
  }

  private initItem(): UiOption {
    // Getters over the input signals, so the CDK key manager can read plain `disabled` and `getLabel()` without the component being typed as one.
    const { id, value, label, disabled, icon } = this;
    return {
      id,
      get value() {
        return value();
      },
      get label() {
        return label();
      },
      get disabled() {
        return disabled();
      },
      get icon() {
        return icon();
      },
      getLabel: () => label(),
    };
  }

  private initHostClasses(): Signal<string> {
    return computed(() => {
      // Exact px, not rem; 14px root. 40px is the menu-item height token (no min-height utility), so taller content grows the row; 10px radius is the panel radius minus its 6px padding.
      return 'group flex min-h-[40px] shrink-0 cursor-pointer items-center gap-[8px] whitespace-nowrap rounded-[10px] px-[10px] label-14 text-ui-neutral-900 aria-disabled:cursor-not-allowed aria-disabled:text-ui-neutral-500 data-[highlighted]:bg-ui-neutral-alpha-50';
    });
  }
}
