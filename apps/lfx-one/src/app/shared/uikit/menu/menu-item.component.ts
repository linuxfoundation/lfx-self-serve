// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { CdkMenuItem } from '@angular/cdk/menu';
import { ChangeDetectionStrategy, Component, computed, inject, input, Signal } from '@angular/core';

/**
 * One action in a `lfx-ui-menu`. The label is the projected content. Choosing it (click, Enter or Space) emits `triggered`
 * and closes the menu. A disabled item has `aria-disabled="true"` and does nothing when chosen. It stays reachable with the arrow keys, and
 * `disabledReason` is read as its description, so a screen reader user hears why it is locked.
 *
 * Inputs and output from the CDK menu item, under these names: `disabled` (boolean), `typeaheadLabel` (text type-ahead matches
 * instead of the projected label) and the `triggered` output.
 */
@Component({
  selector: 'lfx-ui-menu-item',
  templateUrl: './menu-item.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [
    {
      directive: CdkMenuItem,
      inputs: ['cdkMenuItemDisabled: disabled', 'cdkMenuitemTypeaheadLabel: typeaheadLabel'],
      outputs: ['cdkMenuItemTriggered: triggered'],
    },
  ],
  host: {
    '[class]': 'hostClasses()',
    '[attr.aria-describedby]': 'menuItem.disabled && disabledReason() ? reasonId : null',
    'data-testid': 'ui-menu-item',
  },
})
export class UiMenuItemComponent {
  /** `danger` is for destructive actions; put those last, after a separator. */
  public readonly variant = input<'default' | 'danger'>('default');
  /** Font Awesome class string for a leading icon, e.g. `fa-light fa-pen-to-square`. */
  public readonly icon = input<string>('');
  /** Font Awesome class string for a trailing icon, such as an external-link arrow. */
  public readonly trailingIcon = input<string>('');
  /** Keyboard shortcut shown at the end of the row, such as `⌘E`. It is a hint only; wire the shortcut yourself. */
  public readonly shortcut = input<string>('');
  /** Why the item is locked, such as "Only owners can transfer". Read to screen reader users while the item is disabled. */
  public readonly disabledReason = input<string>('');

  protected readonly menuItem = inject(CdkMenuItem);
  protected readonly reasonId = inject(_IdGenerator).getId('lfx-ui-menu-item-reason-');
  protected readonly hostClasses: Signal<string> = this.initHostClasses();
  protected readonly affixClasses: Signal<string> = this.initAffixClasses();

  private initHostClasses(): Signal<string> {
    return computed(() => {
      // Exact px, not rem; 14px root. 10px radius is the menu radius minus its 6px padding; no rounded-ui-* step.
      const base =
        'group flex h-ui-menu-item w-full cursor-pointer items-center gap-[8px] whitespace-nowrap rounded-[10px] px-[10px] label-14 hover:bg-ui-neutral-alpha-50 focus:bg-ui-neutral-alpha-50 focus:outline-none aria-disabled:cursor-not-allowed aria-disabled:text-ui-neutral-500 aria-disabled:hover:bg-transparent';
      return `${base} ${this.variant() === 'danger' ? 'text-ui-danger-700' : 'text-ui-neutral-900'}`;
    });
  }

  private initAffixClasses(): Signal<string> {
    return computed(() => {
      const base = 'inline-flex items-center text-[14px] group-aria-disabled:text-ui-neutral-500';
      return `${base} ${this.variant() === 'danger' ? 'text-ui-danger-700' : 'text-ui-neutral-600'}`;
    });
  }
}
