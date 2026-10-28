// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, ElementRef, input, model, Signal, viewChildren } from '@angular/core';
import { UiTabItem } from '@lfx-one/shared/interfaces';

/** Underline tabs with optional counts. The active tab has a 2px blue underline; use `[(value)]` to read and set the selection. */
@Component({
  selector: 'lfx-ui-tabs',
  templateUrl: './tabs.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class UiTabsComponent {
  /** The tabs to render, in order. */
  public readonly tabs = input.required<UiTabItem[]>();
  /** The selected tab's value. Supports two-way binding with `[(value)]`. */
  public readonly value = model<string>('');
  /** Accessible name for the tab list. */
  public readonly ariaLabel = input<string>('');

  /** Prefix for tab and panel ids. When set, each tab gets `{prefix}-tab-{value}` and `aria-controls="{prefix}-panel-{value}"`. */
  public readonly idPrefix = input<string>('');

  private readonly tabElements = viewChildren<ElementRef<HTMLButtonElement>>('tabButton');

  /** The one tab in the tab order: the selected enabled tab, else the first enabled tab. */
  protected readonly focusIndex: Signal<number> = this.initFocusIndex();

  protected select(tab: UiTabItem): void {
    if (!tab.disabled) this.value.set(tab.value);
  }

  protected onKeydown(event: KeyboardEvent, index: number): void {
    const tabs = this.tabs();
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    let next = -1;
    if (step) {
      // Walk in the arrow's direction, wrapping, until an enabled tab turns up.
      for (let i = 1; i <= tabs.length; i++) {
        const candidate = (index + step * i + tabs.length * i) % tabs.length;
        if (!tabs[candidate].disabled) {
          next = candidate;
          break;
        }
      }
    } else if (event.key === 'Home') {
      next = tabs.findIndex((t) => !t.disabled);
    } else if (event.key === 'End') {
      next = tabs.map((t) => !t.disabled).lastIndexOf(true);
    }
    if (next < 0) return;
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
}
