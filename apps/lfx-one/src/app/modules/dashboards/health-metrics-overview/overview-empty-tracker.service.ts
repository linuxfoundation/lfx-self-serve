// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, DestroyRef, Injectable, signal, Signal } from '@angular/core';

/**
 * Collects whether each Overview card settled empty, so the page can swap every card for one blank card.
 * Provided by the Overview page; a card outside it simply has nothing to report to.
 */
@Injectable()
export class OverviewEmptyTrackerService {
  private readonly cards = signal<readonly Signal<boolean>[]>([]);

  /** Every card has read its data and found nothing; a loading or failed card keeps the cards on screen. */
  public readonly allEmpty = computed(() => {
    const cards = this.cards();
    return cards.length > 0 && cards.every((isEmpty) => isEmpty());
  });

  public register(isEmpty: Signal<boolean>, destroyRef: DestroyRef): void {
    this.cards.update((cards) => [...cards, isEmpty]);
    destroyRef.onDestroy(() => this.cards.update((cards) => cards.filter((card) => card !== isEmpty)));
  }
}
