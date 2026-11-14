// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CdkMenuItem } from '@angular/cdk/menu';
import { ChangeDetectionStrategy, Component, computed, DoCheck, inject, input, Signal } from '@angular/core';

import { UiKeyboardInputComponent } from '../keyboard-input/keyboard-input.component';
import { UiTooltipDirective } from '../tooltip/tooltip.directive';

/**
 * One action in a `lfx-ui-menu`. The label is the projected content. Choosing it (click, Enter or Space) emits `triggered`
 * and closes the menu. A disabled item has `aria-disabled="true"` and does nothing when chosen. It stays reachable with the arrow keys, and
 * `disabledReason` explains why it is locked: a tooltip on hover and keyboard focus, also read as the item's description.
 *
 * Inputs and output from the CDK menu item, under these names: `disabled` (boolean), `typeaheadLabel` (text type-ahead matches
 * instead of the projected label) and the `triggered` output. From `UiTooltipDirective`, `disabledReason` is its `lfxUiTooltip` text;
 * it applies only while the item is disabled. It is the item's only tooltip: `lfxUiTooltip` on the item does not attach a second one.
 * The tooltip opens beside the row first, and only above or below when neither side fits.
 */
@Component({
  selector: 'lfx-ui-menu-item',
  templateUrl: './menu-item.component.html',
  imports: [UiKeyboardInputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [
    {
      directive: CdkMenuItem,
      inputs: ['cdkMenuItemDisabled: disabled', 'cdkMenuitemTypeaheadLabel: typeaheadLabel'],
      outputs: ['cdkMenuItemTriggered: triggered'],
    },
    { directive: UiTooltipDirective, inputs: ['lfxUiTooltip: disabledReason'] },
  ],
  host: {
    '[class]': 'hostClasses()',
    'data-testid': 'ui-menu-item',
  },
})
export class UiMenuItemComponent implements DoCheck {
  /** `danger` is for destructive actions; put those last, after a separator. */
  public readonly variant = input<'default' | 'danger'>('default');
  /** Font Awesome class string for a leading icon, e.g. `fa-light fa-pen-to-square`. */
  public readonly icon = input<string>('');
  /** Font Awesome class string for a trailing icon, such as an external-link arrow. */
  public readonly trailingIcon = input<string>('');
  /** Keyboard shortcut shown at the end of the row as keycaps, such as `⌘E` or `Ctrl+E`. A `+` between keys separates them; a `+` with no key on one side is the `+` key itself, as in `Ctrl++`, `Ctrl+` or `+K`. It is a hint only; wire the shortcut yourself. */
  public readonly shortcut = input<string>('');

  protected readonly menuItem = inject(CdkMenuItem);
  private readonly tooltip = inject(UiTooltipDirective, { self: true });
  protected readonly hostClasses: Signal<string> = this.initHostClasses();
  protected readonly shortcutKeys: Signal<string[]> = this.initShortcutKeys();
  protected readonly affixClasses: Signal<string> = this.initAffixClasses();

  public constructor() {
    this.tooltip.hostSide.set('right');
  }

  // The CDK item's disabled flag is not a signal, so the tooltip follows it on each check.
  public ngDoCheck(): void {
    this.tooltip.hostDisabled.set(!this.menuItem.disabled);
  }

  private initHostClasses(): Signal<string> {
    return computed(() => {
      // Exact px, not rem; 14px root. 10px radius is the menu radius minus its 6px padding; no rounded-ui-* step.
      const base =
        'group flex h-ui-menu-item shrink-0 w-full cursor-pointer items-center gap-[8px] whitespace-nowrap rounded-[10px] px-[10px] label-14 hover:bg-ui-neutral-alpha-50 focus:bg-ui-neutral-alpha-50 focus:outline-none focus-visible:shadow-focus aria-disabled:cursor-not-allowed aria-disabled:text-ui-neutral-500 aria-disabled:hover:bg-transparent';
      return `${base} ${this.variant() === 'danger' ? 'text-ui-danger-700' : 'text-ui-neutral-900'}`;
    });
  }

  private initShortcutKeys(): Signal<string[]> {
    return computed(() => {
      const text = this.shortcut().trim();
      if (!text) return [];
      // An empty part is where a `+` key was (`+K`, `Ctrl+`, `Ctrl++`); each run of them is one `+` key.
      return text
        .split(/\s*\+\s*/)
        .map((part) => part || '+')
        .filter((part, index, parts) => part !== '+' || parts[index - 1] !== '+')
        .flatMap((part) => {
          // `⌘E`, `⌘ K`: each leading modifier symbol is its own key, the rest is the last key.
          const modifiers = part.match(/^[⌘⇧⌥⌃]+/)?.[0] ?? '';
          return [...Array.from(modifiers), part.slice(modifiers.length).trim()].filter(Boolean);
        });
    });
  }

  private initAffixClasses(): Signal<string> {
    return computed(() => {
      const base = 'inline-flex items-center text-[14px] group-aria-disabled:text-ui-neutral-500';
      return `${base} ${this.variant() === 'danger' ? 'text-ui-danger-700' : 'text-ui-neutral-600'}`;
    });
  }
}
