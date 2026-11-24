// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { Component, computed, inject, input, model } from '@angular/core';
import { PROFILE_GRID_LIMIT } from '@lfx-one/shared/constants';
import { UiButtonComponent } from '@shared/uikit/button/button.component';

/**
 * The grid a profile section lays its pills or cards in (#6067): three columns, two below 720px of width and one below
 * 480px. Past `limit` items, the collapsed grid fades out over its last row above a "View all (N)" button that toggles to
 * "Show less". The section slices its own items with `expanded`, e.g. `items.slice(0, expanded ? items.length : limit)`.
 */
@Component({
  selector: 'lfx-profile-grid',
  imports: [UiButtonComponent],
  templateUrl: './profile-grid.component.html',
  host: { class: 'block @container' },
})
export class ProfileGridComponent {
  /** Every item the section has, shown or not. */
  public readonly total = input.required<number>();
  /** Items shown while collapsed. */
  public readonly limit = input<number>(PROFILE_GRID_LIMIT);
  public readonly testId = input<string>('profile-grid');

  public readonly expanded = model<boolean>(false);

  protected readonly gridId = inject(_IdGenerator).getId('lfx-profile-grid-');
  protected readonly hasMore = computed(() => this.total() > this.limit());
  protected readonly faded = computed(() => this.hasMore() && !this.expanded());
  protected readonly toggleLabel = computed(() => (this.expanded() ? 'Show less' : `View all (${this.total()})`));

  protected toggle(): void {
    this.expanded.update((expanded) => !expanded);
  }
}
