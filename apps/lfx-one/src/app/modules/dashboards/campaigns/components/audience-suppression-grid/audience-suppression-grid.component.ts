// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output } from '@angular/core';

import type { AudienceSuppressionCategory, AudienceSuppressionList } from '@lfx-one/shared/interfaces';

/**
 * The exclusion picker: event-specific, brand, then portfolio-wide hygiene lists.
 *
 * Nothing is pre-ticked. An auto-applied exclusion silently shrinks a send, and the operator is
 * the only party who knows whether this audience is one the exclusion was written for — so the
 * ordering below is a recommendation and the ticks are theirs.
 */
@Component({
  selector: 'lfx-audience-suppression-grid',
  imports: [],
  templateUrl: './audience-suppression-grid.component.html',
  styleUrl: './audience-suppression-grid.component.scss',
})
export class AudienceSuppressionGridComponent {
  // === Inputs ===
  public readonly lists = input<readonly AudienceSuppressionList[]>([]);
  /**
   * Selected row KEYS, not list ids. Several standard terms can resolve to the same HubSpot list,
   * so the key is the row's selection identity — keying by `listId` made every row sharing that id
   * tick and untick as one, misrepresenting which regulatory terms the operator actually chose.
   */
  public readonly selectedKeys = input<ReadonlySet<string>>(new Set<string>());
  public readonly loading = input(false);
  /**
   * True when the fetch FAILED, as distinct from a portal with no suppression lists. Without this
   * the two render identically, so an outage reads as a verified absence of regulatory exclusions.
   */
  public readonly failed = input(false);
  public readonly disabled = input(false);

  // === Outputs ===
  /** Emits the row KEY, not the list id — see `selectedKeys`. */
  public readonly toggleList = output<string>();

  // === Computed Signals ===
  /**
   * The lists grouped into the three categories, highest-value first.
   *
   * Grouped here rather than in the template because the order is a judgement — a per-event
   * suppression list carried over from a prior edition already bundles that edition's
   * current-registrant and unsubscribe exclusions, so it is the one to reach for first.
   */
  protected readonly groups = computed(() => {
    const order: readonly { category: AudienceSuppressionCategory; label: string; hint: string }[] = [
      { category: 'event_specific', label: 'Event-specific', hint: "Carried over from this event's prior editions — usually the highest-value exclusion." },
      { category: 'brand', label: 'Brand opt-outs', hint: "Opt-outs scoped to this event's brand." },
      { category: 'standard', label: 'Portfolio-wide hygiene', hint: 'GDPR and global opt-out lists that apply across the Linux Foundation.' },
    ];
    // Rows carry their own presentation state so the template reads properties instead of
    // calling isSelected()/sizeLabel() on every change-detection pass
    // (`docs/reviews/frontend-checklist.md` §4). Both depend only on signals already read here,
    // so the whole map re-runs exactly when `lists` or `selectedKeys` changes — and not per pass.
    const selected = this.selectedKeys();
    return order
      .map((group) => ({
        ...group,
        lists: this.lists()
          .filter((list) => list.category === group.category)
          .map((list) => ({
            ...list,
            selected: selected.has(list.key),
            sizeText: this.sizeLabel(list),
            // An unresolved hygiene row carries no list id by contract; it stays visible but
            // cannot be ticked.
            unresolved: list.listId === '',
          })),
      }))
      .filter((group) => group.lists.length > 0);
  });

  // === Protected Methods ===
  protected isSelected(key: string): boolean {
    return this.selectedKeys().has(key);
  }

  protected onToggle(key: string, listId: string): void {
    // An unresolved hygiene row carries no list id by contract. Emitting '' stored an empty
    // string that the controller later strips, so compose proceeded WITHOUT that exclusion
    // while the grid showed it ticked. Guarded here as well as in the template: the template
    // controls what is clickable, this controls what can ever be emitted.
    if (!this.disabled() && listId !== '') {
      this.toggleList.emit(key);
    }
  }

  protected sizeLabel(list: AudienceSuppressionList): string {
    return list.size === undefined ? 'size unknown' : `${list.size.toLocaleString('en-US')} contacts`;
  }
}
