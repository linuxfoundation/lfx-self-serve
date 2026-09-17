// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output } from '@angular/core';

import type { AudienceCardBucket, AudienceDiscoveredList } from '@lfx-one/shared/interfaces';

/**
 * The review grid: one accented card per signal, each holding the lists classified into it.
 *
 * Purely presentational. Selection lives in the container because the same list ids drive the
 * preview count and the compose request, and a child-owned copy would be a second source of truth
 * for the set that decides who receives the send.
 */
@Component({
  selector: 'lfx-audience-card-grid',
  imports: [],
  templateUrl: './audience-card-grid.component.html',
  styleUrl: './audience-card-grid.component.scss',
})
export class AudienceCardGridComponent {
  // === Inputs ===
  public readonly buckets = input<readonly AudienceCardBucket[]>([]);
  public readonly selectedIds = input<ReadonlySet<string>>(new Set<string>());
  public readonly disabled = input(false);

  // === Outputs ===
  public readonly toggleList = output<string>();

  // === Computed Signals ===
  /**
   * Buckets with at least one list.
   *
   * An empty bucket is dropped rather than rendered as a heading over nothing: the signal
   * genuinely found nothing, and the "Qualifying lists not found" section below the grid is where
   * that fact is reported — with the per-signal guidance an empty card could not carry.
   */
  /**
   * Buckets with their rows pre-decorated, so the template reads properties instead of calling
   * isSelected()/sizeLabel() on every change-detection pass
   * (`docs/reviews/frontend-checklist.md` §4). Both depend only on signals read here, so this
   * re-runs when `buckets` or `selectedIds` changes — not per pass.
   */
  protected readonly populated = computed(() => {
    const selected = this.selectedIds();
    return this.buckets()
      .filter((bucket) => bucket.lists.length > 0)
      .map((bucket) => ({
        ...bucket,
        lists: bucket.lists.map((list) => ({ ...list, selected: selected.has(list.listId), sizeText: this.sizeLabel(list) })),
      }));
  });

  protected readonly totalLists = computed(() => this.populated().reduce((sum, bucket) => sum + bucket.lists.length, 0));

  // === Protected Methods ===
  protected isSelected(listId: string): boolean {
    return this.selectedIds().has(listId);
  }

  protected onToggle(listId: string): void {
    if (!this.disabled()) {
      this.toggleList.emit(listId);
    }
  }

  /**
   * A list's size, or an explicit unknown.
   *
   * HubSpot omits `size` on some search results, so a defaulted 0 would render "0 contacts" for a
   * list that simply did not report — a number an operator would act on.
   */
  protected sizeLabel(list: AudienceDiscoveredList): string {
    return list.size === undefined ? 'size unknown' : `${list.size.toLocaleString('en-US')} contacts`;
  }
}
