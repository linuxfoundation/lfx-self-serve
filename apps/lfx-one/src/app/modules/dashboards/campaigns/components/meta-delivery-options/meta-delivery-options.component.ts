// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, model } from '@angular/core';
import {
  DEFAULT_META_AD_SCHEDULE,
  DEFAULT_META_FREQUENCY_CAP,
  META_AD_SCHEDULE_DAY_OPTIONS,
  META_FREQUENCY_CAP_MAX,
  META_FREQUENCY_CAP_MIN,
} from '@lfx-one/shared/constants';
import type { MetaAdScheduleDayView, MetaDeliveryDraft } from '@lfx-one/shared/interfaces';
import { metaAdScheduleHourOptions, metaAdScheduleRefusal, metaAdScheduleWithDay, metaFrequencyCapRefusal } from '@lfx-one/shared/utils';
import { UiCheckboxComponent } from '@shared/uikit/checkbox/checkbox.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';

/**
 * The Meta ad schedule and frequency cap on the Implement tab (#5904 row 5). The schedule shows only on a lifetime
 * budget, the cap only on awareness, each only on its own explicit yes; the parent decides both and owns the draft,
 * sends it, and holds Create. The rules live in `campaign-meta-delivery.utils.ts`.
 */
@Component({
  selector: 'lfx-meta-delivery-options',
  imports: [UiCheckboxComponent, UiOptionComponent, UiSelectComponent],
  templateUrl: './meta-delivery-options.component.html',
})
export class MetaDeliveryOptionsComponent {
  public readonly scheduleShown = input<boolean>(false);
  public readonly capShown = input<boolean>(false);

  public readonly delivery = model.required<MetaDeliveryDraft>();

  protected readonly startHours = metaAdScheduleHourOptions('start');
  protected readonly endHours = metaAdScheduleHourOptions('end');
  protected readonly capMin = META_FREQUENCY_CAP_MIN;
  protected readonly capMax = META_FREQUENCY_CAP_MAX;

  protected readonly days = computed<MetaAdScheduleDayView[]>(() => {
    const chosen = new Set(this.delivery().adSchedule?.days ?? []);
    return META_AD_SCHEDULE_DAY_OPTIONS.map((day) => ({ ...day, on: chosen.has(day.value) }));
  });
  /** Why the schedule as edited cannot be sent, or `null`. The lifetime budget is the parent's, so it is assumed here. */
  protected readonly scheduleError = computed<string | null>(
    () => metaAdScheduleRefusal({ lifetimeBudget: true, adSchedule: this.delivery().adSchedule })?.message ?? null
  );
  /** Why the cap as edited cannot be sent, or `null`. The objective is the parent's, so awareness is assumed here. */
  protected readonly capError = computed<string | null>(
    () => metaFrequencyCapRefusal({ objective: 'awareness', frequencyCap: this.delivery().frequencyCap })?.message ?? null
  );

  protected onScheduleToggle(on: boolean): void {
    this.update({ adSchedule: on ? { ...DEFAULT_META_AD_SCHEDULE, days: [...DEFAULT_META_AD_SCHEDULE.days] } : null });
  }

  protected onDayToggle(day: number, on: boolean): void {
    const schedule = this.delivery().adSchedule;
    if (schedule === null) return;
    this.update({ adSchedule: metaAdScheduleWithDay(schedule, day, on) });
  }

  /** The select's value is the hour's minutes of the day, as text; "no choice" keeps the current hour. */
  protected onHourChange(edge: 'startMinute' | 'endMinute', value: string | null): void {
    const schedule = this.delivery().adSchedule;
    if (schedule === null || value === null || value === '') return;
    this.update({ adSchedule: { ...schedule, [edge]: Number(value) } });
  }

  protected onCapToggle(on: boolean): void {
    this.update({ frequencyCap: on ? { ...DEFAULT_META_FREQUENCY_CAP } : null });
  }

  /**
   * A box left empty or half-typed reads as 0, which the cap's own rule refuses on screen. The template shows 0 as an
   * empty box, so clearing a box to type a new number never puts a 0 back under the cursor.
   */
  protected onCapInput(field: 'maxImpressions' | 'intervalDays', event: Event): void {
    const cap = this.delivery().frequencyCap;
    if (cap === null) return;
    const value = Number.parseInt((event.target as HTMLInputElement).value, 10);
    this.update({ frequencyCap: { ...cap, [field]: Number.isNaN(value) ? 0 : value } });
  }

  private update(patch: Partial<MetaDeliveryDraft>): void {
    this.delivery.update((delivery) => ({ ...delivery, ...patch }));
  }
}
