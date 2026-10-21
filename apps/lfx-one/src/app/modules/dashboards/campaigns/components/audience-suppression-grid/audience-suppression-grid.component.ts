// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output, signal } from '@angular/core';

import type { AudienceSuppressionCategory, AudienceSuppressionList } from '@lfx-one/shared/interfaces';

/**
 * The exclusion picker: current registrants, event-specific, brand, then portfolio-wide hygiene.
 *
 * Every resolved row arrives pre-ticked (the container seeds them once per load), and at least one
 * must stay ticked before anything can be composed or attached: sending with no suppression at all
 * is the compliance failure this step exists to prevent. The operator can still untick a list the
 * audience was not written for -- the ticks remain theirs, only the default changed.
 *
 * The portfolio-wide hygiene lists are one entry with one toggle: campaign-service applies them as
 * the project's single standing standard suppression list, reused by every email, so they are
 * normally kept or dropped together. Their members are listed on demand.
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
  /** Emits the resolved standard row keys to tick (all of them) or untick (none of them). */
  public readonly toggleStandard = output<{ keys: readonly string[]; selected: boolean }>();

  // === WritableSignals ===
  protected readonly standardExpanded = signal(false);

  // === Computed Signals ===
  /**
   * Every row with its presentation state, so the template reads properties instead of calling
   * isSelected()/sizeLabel() on every change-detection pass (`docs/reviews/frontend-checklist.md`
   * §4). It re-runs exactly when `lists` or `selectedKeys` changes.
   */
  private readonly rows = computed(() => {
    const selected = this.selectedKeys();
    return this.lists().map((list) => ({
      ...list,
      selected: selected.has(list.key),
      sizeText: this.sizeLabel(list),
      // An unresolved hygiene row carries no list id by contract; it stays visible but cannot be
      // ticked. A current-registrants row with no list yet is different: the attach creates it.
      unresolved: list.listId === '' && !list.willCreate,
    }));
  });

  /**
   * The per-list groups, highest-value first. Grouped here rather than in the template because the
   * order is a judgement: this edition's own registrants are the exclusion a registration push
   * most needs, and a per-event list carried over from a prior edition bundles that edition's
   * unsubscribes.
   */
  protected readonly groups = computed(() => {
    const order: readonly { category: AudienceSuppressionCategory; label: string; hint: string }[] = [
      {
        category: 'current_registrants',
        label: 'Current registrants',
        hint: 'People already registered for this edition. Untick it for a post-event or registrant-only send.',
      },
      { category: 'event_specific', label: 'Event-specific', hint: "Carried over from this event's prior editions." },
      { category: 'brand', label: 'Brand opt-outs', hint: "Opt-outs scoped to this event's brand." },
    ];
    const rows = this.rows();
    return order.map((group) => ({ ...group, lists: rows.filter((list) => list.category === group.category) })).filter((group) => group.lists.length > 0);
  });

  /** The portfolio-wide hygiene rows, shown as one entry; null when there are none. */
  protected readonly standard = computed(() => {
    const lists = this.rows().filter((list) => list.category === 'standard');
    if (lists.length === 0) {
      return null;
    }
    const resolved = lists.filter((list) => !list.unresolved);
    const selectedCount = resolved.filter((list) => list.selected).length;
    return {
      lists,
      resolvedKeys: resolved.map((list) => list.key),
      resolvedCount: resolved.length,
      unresolvedCount: lists.length - resolved.length,
      selectedCount,
      allSelected: resolved.length > 0 && selectedCount === resolved.length,
      partlySelected: selectedCount > 0 && selectedCount < resolved.length,
    };
  });

  // === Protected Methods ===
  protected onToggle(list: AudienceSuppressionList): void {
    // An unresolved hygiene row carries no list id by contract. Emitting it stored an empty id that
    // was later stripped, so compose proceeded WITHOUT that exclusion while the grid showed it
    // ticked. Guarded here as well as in the template: the template controls what is clickable,
    // this controls what can ever be emitted. Only a row whose list the attach CREATES may be empty.
    if (!this.disabled() && (list.listId !== '' || list.willCreate === true)) {
      this.toggleList.emit(list.key);
    }
  }

  protected onToggleStandard(): void {
    const standard = this.standard();
    if (this.disabled() || standard === null || standard.resolvedCount === 0) {
      return;
    }
    // A partial selection ticks the rest: the standing list applies only when all are kept.
    this.toggleStandard.emit({ keys: standard.resolvedKeys, selected: !standard.allSelected });
  }

  protected onToggleStandardExpanded(): void {
    this.standardExpanded.update((open) => !open);
  }

  protected sizeLabel(list: AudienceSuppressionList): string {
    return list.size === undefined ? 'size unknown' : `${list.size.toLocaleString('en-US')} contacts`;
  }
}
