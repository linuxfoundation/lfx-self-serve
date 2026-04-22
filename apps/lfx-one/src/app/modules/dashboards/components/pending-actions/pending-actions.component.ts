// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, output, signal, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { TagComponent } from '@components/tag/tag.component';
import { HiddenActionsService } from '@shared/services/hidden-actions.service';

import type { PendingActionItem } from '@lfx-one/shared/interfaces';
@Component({
  selector: 'lfx-pending-actions',
  imports: [ButtonComponent, TagComponent],
  templateUrl: './pending-actions.component.html',
  styleUrl: './pending-actions.component.scss',
})
export class PendingActionsComponent {
  private readonly hiddenActionsService = inject(HiddenActionsService);

  public readonly pendingActions = input.required<PendingActionItem[]>();
  public readonly displayLimit = input<number>(5);

  public readonly actionClick = output<PendingActionItem>();

  // Version counter bumped whenever the user dismisses an action. HiddenActionsService stores hides
  // in a cookie, which is outside the signal graph — reading it inside `visibleActions` wouldn't
  // re-trigger the computed on dismiss. Bumping this signal forces a recompute so the dismissed
  // row disappears and the next waiting item slides into the slot immediately.
  private readonly hiddenActionsVersion = signal(0);

  // Windowed view of the incoming list: drop anything the user has dismissed (HiddenActionsService
  // sets a 24h cookie on click) and cap to displayLimit so the user focuses on a handful at a time.
  // When one is dismissed, it leaves the window and the next waiting item slides into the slot on
  // the next change-detection pass. The full list still lives on the parent — this just controls
  // what gets rendered.
  protected readonly visibleActions: Signal<PendingActionItem[]> = computed(() => {
    this.hiddenActionsVersion();
    const unhidden = this.pendingActions().filter((item) => !this.hiddenActionsService.isActionHidden(item));
    // Guard against negative / non-finite inputs — `slice(0, -1)` would silently drop the last
    // item instead of capping, which is surprising API behavior for a public input.
    const limit = this.displayLimit();
    const safeLimit = Number.isFinite(limit) ? Math.max(0, limit) : 5;
    return unhidden.slice(0, safeLimit);
  });

  protected handleActionClick(item: PendingActionItem): void {
    this.hiddenActionsService.hideAction(item);
    this.hiddenActionsVersion.update((v) => v + 1);
    this.actionClick.emit(item);
  }
}
