// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { booleanAttribute, ChangeDetectionStrategy, Component, computed, inject, input, Signal } from '@angular/core';
import { UiOption, UiOptionLabelParts } from '@lfx-one/shared/interfaces';

import { UiButtonComponent } from '../button/button.component';
import { UiCheckboxComponent } from '../checkbox/checkbox.component';
import { UiOptionHost } from './option-host';

/**
 * One choice of an `lfx-ui-select`, `lfx-ui-combobox` or `lfx-ui-multi-select`: `<lfx-ui-option value="cncf" label="CNCF">...</lfx-ui-option>`. The projected content is the row, so it can
 * hold an avatar, a badge or a second line of description. Without content the row shows `label`. `label` stays required: it is the text the
 * trigger shows once the option is picked, and what type-ahead matches. Give the content its own text for screen readers; the row's accessible
 * name comes from it.
 */
@Component({
  selector: 'lfx-ui-option',
  imports: [UiButtonComponent, UiCheckboxComponent],
  templateUrl: './option.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.role]': "host.multiple ? null : 'option'",
    '[id]': 'id',
    '[class]': 'hostClasses()',
    '[attr.aria-selected]': 'host.multiple ? null : isSelected()',
    '[attr.aria-disabled]': 'disabled() ? "true" : null',
    '[attr.data-highlighted]': 'isActive() ? "" : null',
    '(click)': 'onClick($event)',
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
  protected readonly isVisible: Signal<boolean> = computed(() => this.host.isVisible?.(this.item) ?? true);
  /** The plain label split around the part the list emphasises (the typed text of a combobox). */
  protected readonly labelParts: Signal<UiOptionLabelParts> = this.initLabelParts();
  protected readonly hostClasses: Signal<string> = this.initHostClasses();

  protected pick(): void {
    this.host.pick(this.item);
  }

  protected onClick(event: Event): void {
    // In a multi-value row the checkbox and the Only button act for themselves; the rest of the row toggles.
    if (this.host.multiple && (event.target as Element).closest('lfx-ui-checkbox, [data-ui-option-action]')) return;
    this.pick();
  }

  protected highlight(): void {
    this.host.highlight(this.item);
  }

  protected only(event: Event): void {
    // The action must not also toggle the row.
    event.stopPropagation();
    this.host.only?.(this.item);
  }

  private initItem(): UiOption {
    // Getters over the input signals, so the CDK key manager can read a plain `disabled` without the component being typed as one.
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
    };
  }

  private initLabelParts(): Signal<UiOptionLabelParts> {
    return computed(() => {
      const label = this.label();
      const range = this.host.matchRange?.(this.item) ?? null;
      if (!range) return { before: label, match: '', after: '' };
      return { before: label.slice(0, range[0]), match: label.slice(range[0], range[1]), after: label.slice(range[1]) };
    });
  }

  private initHostClasses(): Signal<string> {
    return computed(() => {
      // Forced-colors drops the highlight fill, so an inset outline marks the highlighted row.
      // Exact px, not rem; 14px root. 40px is the menu-item height token (no min-height utility), so taller content grows the row; 10px radius is the panel radius minus its 6px padding.
      // A multi-value row ends in the Only action, which sits 4px from the edge (library spacing-1). It has no highlight: the row follows the pointer and focus.
      const multi = this.host.multiple
        ? ' pr-[4px] hover:bg-ui-neutral-alpha-50 focus-within:bg-ui-neutral-alpha-50 forced-colors:focus-within:outline forced-colors:focus-within:outline-2 forced-colors:focus-within:-outline-offset-2 forced-colors:focus-within:outline-[color:Highlight]'
        : '';
      // A row the list filters out is removed from the layout and from the accessibility tree.
      const visibility = this.isVisible() ? '' : ' hidden';
      return `group flex min-h-[40px] shrink-0 cursor-pointer items-center gap-[8px] whitespace-nowrap rounded-[10px] px-[10px] label-14 text-ui-neutral-900 aria-disabled:cursor-not-allowed aria-disabled:text-ui-neutral-500 data-[highlighted]:bg-ui-neutral-alpha-50 forced-colors:data-[highlighted]:outline forced-colors:data-[highlighted]:outline-2 forced-colors:data-[highlighted]:-outline-offset-2 forced-colors:data-[highlighted]:outline-[color:Highlight]${multi}${visibility}`;
    });
  }
}
