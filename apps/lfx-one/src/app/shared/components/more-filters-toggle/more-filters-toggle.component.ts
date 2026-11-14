// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, model, Signal } from '@angular/core';

/**
 * The "More filters" / "Fewer filters" link at the end of an Org Lens filter row (lfx-self-serve#4735). It shows and
 * hides the page's secondary filters (code count, employment, team members, organization scope), rendered by the page
 * in a second filter row whose element id is `controls`. Collapsed by default; while collapsed the label counts the
 * hidden filters not at their default, so a pick from the URL is never invisible. The expanded state is the page's
 * (two-way `expanded`), kept for the visit only: the filter values themselves stay in the URL.
 */
@Component({
  selector: 'lfx-more-filters-toggle',
  templateUrl: './more-filters-toggle.component.html',
  host: { class: 'self-start md:self-auto' },
})
export class MoreFiltersToggleComponent {
  public readonly expanded = model<boolean>(false);
  /** How many of the secondary filters are not at their default. */
  public readonly count = input<number>(0);
  /** The id of the secondary filter row this link shows and hides. */
  public readonly controls = input.required<string>();
  public readonly dataTest = input<string>('more-filters-toggle');

  protected readonly label: Signal<string> = computed(() => this.initLabel());

  protected toggle(): void {
    this.expanded.update((expanded) => !expanded);
  }

  private initLabel(): string {
    if (this.expanded()) return 'Fewer filters';
    const count = this.count();
    return count > 0 ? `More filters (${count})` : 'More filters';
  }
}
