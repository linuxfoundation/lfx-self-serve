// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, ElementRef, input, model, signal, Signal, viewChildren } from '@angular/core';
import { UiTabItem, UiTabsSize, UiTabsVariant } from '@lfx-one/shared/interfaces';

import { UiTooltipDirective } from '../tooltip/tooltip.directive';

/**
 * Tabs for switching sections of one page, following the WAI-ARIA tabs pattern: a labelled `tablist`, roving `tabindex`, and
 * Left/Right/Home/End moving focus and selection together. Disabled tabs take focus from those keys without being selected, so their
 * reason tooltip opens, but they stay out of the initial tab stop. Use `[(value)]` to read and set the selection.
 * `variant="default"` is an underline with a 2px accent bar on a rule; `variant="secondary"` is 32px pills. `size="small"` (13px) is the
 * one used on Meetings. A tab can have a count, an icon, and a disabled state with a tooltip that says why. The component renders the
 * tablist only: render the `role="tabpanel"` elements yourself and point them at `idPrefix`.
 */
@Component({
  selector: 'lfx-ui-tabs',
  imports: [UiTooltipDirective],
  templateUrl: './tabs.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', '[class]': 'hostClasses()' },
})
export class UiTabsComponent {
  /** The tabs to render, in order. */
  public readonly tabs = input.required<UiTabItem[]>();
  /** Accessible name for the tab list. */
  public readonly ariaLabel = input<string>('');
  /** `default` is 14px; `small` is 13px with 11px bottom padding. The secondary variant ignores it. */
  public readonly size = input<UiTabsSize>('default');
  /** `default` is an underline on a rule; `secondary` is 32px pills without a rule. */
  public readonly variant = input<UiTabsVariant>('default');

  /** Prefix for tab and panel ids. When set, each tab gets `{prefix}-tab-{value}` and `aria-controls="{prefix}-panel-{value}"`. */
  public readonly idPrefix = input<string>('');
  /** The selected tab's value. Supports two-way binding with `[(value)]`. */
  public readonly value = model<string>('');

  private readonly tabElements = viewChildren<ElementRef<HTMLButtonElement>>('tabButton');
  /** Index of the tab that holds focus, or null when focus is outside the list. */
  protected readonly focusedIndex = signal<number | null>(null);

  /** The resting tab stop: the selected enabled tab, else the first enabled tab. */
  protected readonly focusIndex: Signal<number> = this.initFocusIndex();
  /** The one tab in the tab order: the focused tab (a disabled one included) while focus is in the list, else the resting tab stop. */
  protected readonly tabStopIndex: Signal<number> = computed(() => this.focusedIndex() ?? this.focusIndex());
  protected readonly hostClasses: Signal<string> = this.initHostClasses();
  protected readonly listClasses: Signal<string> = this.initListClasses();
  protected readonly tabClasses: Signal<string> = this.initTabClasses();
  protected readonly iconSize: Signal<number> = computed(() => (this.size() === 'small' && this.variant() === 'default' ? 13 : 14));

  protected select(tab: UiTabItem): void {
    if (!tab.disabled) this.value.set(tab.value);
  }

  protected onKeydown(event: KeyboardEvent, index: number): void {
    const tabs = this.tabs();
    // Arrows wrap; every tab, disabled ones included, can take focus.
    const next = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    this.select(tabs[next]);
    this.tabElements()[next]?.nativeElement.focus();
  }

  private initFocusIndex(): Signal<number> {
    return computed(() => {
      const tabs = this.tabs();
      const selected = tabs.findIndex((t) => t.value === this.value() && !t.disabled);
      return selected >= 0 ? selected : tabs.findIndex((t) => !t.disabled);
    });
  }

  private initHostClasses(): Signal<string> {
    // The rule is an inset shadow on the host, so the selected bar sits on top of it (as in the library).
    return computed(() => (this.variant() === 'secondary' ? '' : 'shadow-[inset_0_-1px_0_0] shadow-ui-neutral-alpha-200'));
  }

  private initListClasses(): Signal<string> {
    return computed(() => {
      // Exact px gap, not rem; 14px root. The 4px padding, offset by negative margins, gives the focus ring room on every side inside the scroll area.
      const base = '-mx-[4px] -my-[4px] flex items-end overflow-x-auto p-[4px] isolate';
      return this.variant() === 'secondary' ? `${base} gap-[4px]` : `${base} gap-[24px]`;
    });
  }

  private initTabClasses(): Signal<string> {
    return computed(() => {
      const base =
        'relative inline-flex items-center whitespace-nowrap border-0 bg-transparent label-14 transition-[color] duration-ui-base focus-visible:shadow-focus focus-visible:outline-none motion-reduce:transition-none aria-disabled:cursor-not-allowed aria-disabled:text-ui-neutral-400 aria-disabled:hover:text-ui-neutral-400';
      if (this.variant() === 'secondary') {
        // Exact px sizes, not rem; the 10px radius is the library's radius-sm minus 2px (no token).
        return `${base} h-[32px] gap-[8px] rounded-[10px] px-[12px] text-ui-neutral-600 hover:text-ui-neutral-900 before:absolute before:inset-0 before:z-[-1] before:rounded-ui-sm before:bg-transparent before:transition-[background-color] before:duration-ui-base before:content-[''] motion-reduce:before:transition-none hover:before:bg-ui-neutral-alpha-50 aria-selected:cursor-default aria-selected:font-medium aria-selected:text-ui-accent-700 aria-selected:before:bg-ui-accent-100`;
      }
      // Exact px padding and gap, not rem; the selected bar is a 2px ::after on the tab's bottom edge.
      const size = this.size() === 'small' ? 'pb-[11px] text-[13px]' : 'pb-[14px]';
      return `${base} gap-[7px] pt-[8px] ${size} text-ui-neutral-500 hover:text-ui-neutral-900 aria-selected:cursor-default aria-selected:font-medium aria-selected:text-ui-neutral-900 aria-selected:after:absolute aria-selected:after:inset-x-0 aria-selected:after:bottom-0 aria-selected:after:h-[2px] aria-selected:after:bg-ui-accent-500 aria-selected:after:content-['']`;
    });
  }
}
