// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, model } from '@angular/core';
import {
  REDDIT_BUDGET_TYPE_LABELS,
  REDDIT_BUDGET_TYPES,
  REDDIT_DEVICE_PLATFORM_LABELS,
  REDDIT_DEVICE_PLATFORMS,
  REDDIT_PLACEMENT_LABELS,
  REDDIT_PLACEMENTS,
} from '@lfx-one/shared/constants';
import type { RedditDeliveryDraft, RedditDeliveryOptionView, RedditDevicePlatform, RedditPlacement } from '@lfx-one/shared/interfaces';
import { redditDeliveryOptions, redditDeliveryRefusal, redditDeliveryWithOption } from '@lfx-one/shared/utils';
import { UiCheckboxComponent } from '@shared/uikit/checkbox/checkbox.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { UiToggleComponent } from '@shared/uikit/toggle/toggle.component';

/**
 * The Reddit budget type, placements, devices and audience expansion on the Implement tab (#6108 row 5). The budget type
 * shows only on `budgetTypeEnabled`, the rest only on `placementsEnabled`, each the parent's explicit yes. Every control
 * starts on campaign-service's default, which the request leaves out. The parent owns the draft, sends it and holds
 * Create; the rules live in `campaign-reddit-delivery.utils.ts`.
 */
@Component({
  selector: 'lfx-reddit-delivery',
  imports: [UiCheckboxComponent, UiOptionComponent, UiSelectComponent, UiToggleComponent],
  templateUrl: './reddit-delivery.component.html',
})
export class RedditDeliveryComponent {
  public readonly placementsEnabled = input<boolean>(false);
  public readonly budgetTypeEnabled = input<boolean>(false);

  public readonly delivery = model.required<RedditDeliveryDraft>();

  protected readonly budgetTypes = REDDIT_BUDGET_TYPES;
  protected readonly budgetTypeLabels = REDDIT_BUDGET_TYPE_LABELS;

  protected readonly placementRows = computed<RedditDeliveryOptionView<RedditPlacement>[]>(() =>
    redditDeliveryOptions(this.delivery().placements, REDDIT_PLACEMENTS, REDDIT_PLACEMENT_LABELS)
  );
  protected readonly platformRows = computed<RedditDeliveryOptionView<RedditDevicePlatform>[]>(() =>
    redditDeliveryOptions(this.delivery().platforms, REDDIT_DEVICE_PLATFORMS, REDDIT_DEVICE_PLATFORM_LABELS)
  );
  /** Why the lists cannot be sent, or `null`; only a restored draft can reach it, since the last box cannot be unticked. */
  protected readonly refusal = computed<string | null>(() =>
    redditDeliveryRefusal(this.delivery(), { placements: this.placementsEnabled(), budgetType: this.budgetTypeEnabled() })
  );

  /** The select offers only `REDDIT_BUDGET_TYPES`, so anything else (a cleared value) is ignored. */
  protected onBudgetTypeChange(value: string | null): void {
    const budgetType = REDDIT_BUDGET_TYPES.find((type) => type === value);
    if (budgetType === undefined) return;
    this.update({ budgetType });
  }

  protected onPlacementToggle(value: RedditPlacement, on: boolean): void {
    this.update({ placements: redditDeliveryWithOption(this.delivery().placements, value, on, REDDIT_PLACEMENTS) });
  }

  protected onPlatformToggle(value: RedditDevicePlatform, on: boolean): void {
    this.update({ platforms: redditDeliveryWithOption(this.delivery().platforms, value, on, REDDIT_DEVICE_PLATFORMS) });
  }

  protected onExpandTargetingChange(on: boolean): void {
    this.update({ expandTargeting: on });
  }

  private update(change: Partial<RedditDeliveryDraft>): void {
    this.delivery.update((current) => ({ ...current, ...change }));
  }
}
