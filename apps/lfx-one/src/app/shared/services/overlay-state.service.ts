// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, Injectable, signal } from '@angular/core';

// Tracks which overlays are currently on screen so shell-level chrome (the support launcher) can get
// out of their way. Consumers register an id when they open and unregister when they close or are
// destroyed; ids are idempotent so a double open/close is safe. Drawers, dialogs and sticky bars opt
// in by calling this API.
@Injectable({
  providedIn: 'root',
})
export class OverlayStateService {
  private readonly openIds = signal<ReadonlySet<string>>(new Set());

  /** True while at least one registered overlay is open. */
  public readonly anyOpen = computed(() => this.openIds().size > 0);

  /** For pages that render a sticky bottom action bar the launcher would otherwise cover. No page sets it yet. */
  public readonly stickyBarVisible = signal(false);

  public register(id: string): void {
    if (this.openIds().has(id)) {
      return;
    }
    this.openIds.update((ids) => new Set(ids).add(id));
  }

  public unregister(id: string): void {
    if (!this.openIds().has(id)) {
      return;
    }
    this.openIds.update((ids) => {
      const next = new Set(ids);
      next.delete(id);
      return next;
    });
  }
}
