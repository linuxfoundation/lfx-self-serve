// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, model, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import {
  GOOGLE_ADS_DEVICE_LABELS,
  GOOGLE_ADS_DEVICES,
  GOOGLE_ADS_MAX_AD_SCHEDULES,
  GOOGLE_ADS_MAX_AD_SCHEDULES_PER_DAY,
  GOOGLE_ADS_SCHEDULE_DAY_LABELS,
  GOOGLE_ADS_SCHEDULE_DAYS,
  GOOGLE_ADS_SCHEDULE_TIME_OPTIONS,
} from '@lfx-one/shared/constants';
import type {
  CampaignAdSchedule,
  CampaignDeviceBidModifier,
  GoogleAdScheduleRowView,
  GoogleAdsDevice,
  GoogleAdsScheduleDay,
  GoogleAdsScheduleMinute,
  GoogleDeviceBidMode,
  GoogleDeviceBidRowView,
} from '@lfx-one/shared/interfaces';
import { googleBidAdjustmentPercent, googleBidModifierFromPercent } from '@lfx-one/shared/utils';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';

/**
 * The Google campaign's ad schedule and device bid adjustments on the Implement tab (#4991).
 *
 * Renders straight from the lists it is given and writes every edit back through them, keeping
 * no form state of its own. The tab owns the lists: it saves them in the draft, empties them when
 * the brief changes, and judges them with the shared `googleAdScheduleRefusal` and
 * `googleDeviceBidModifierRefusal` — the same functions the BFF refuses a create with — and passes
 * the answer back in as an error. A copy held here would keep showing a list the tab had already
 * replaced. For the same reason the four pickers are `lfx-ui-select`, bound one way with `[value]`
 * and `(valueChange)`, which needs no `FormGroup` (the `lfx-*` wrappers do, and a `FormGroup` is
 * exactly that copy). The two percentage boxes stay native `<input type="number">`; the template
 * says why.
 */
@Component({
  selector: 'lfx-campaign-google-targeting-panel',
  imports: [ButtonComponent, UiSelectComponent, UiOptionComponent],
  templateUrl: './campaign-google-targeting-panel.component.html',
})
export class CampaignGoogleTargetingPanelComponent {
  public readonly showAdSchedules = input.required<boolean>();
  public readonly showDevices = input.required<boolean>();
  public readonly adSchedulesError = input<string | null>(null);
  public readonly devicesError = input<string | null>(null);

  public readonly adSchedules = model.required<CampaignAdSchedule[]>();
  public readonly deviceBidModifiers = model.required<CampaignDeviceBidModifier[]>();

  protected readonly maxAdSchedules = GOOGLE_ADS_MAX_AD_SCHEDULES;
  protected readonly dayOptions = GOOGLE_ADS_SCHEDULE_DAYS.map((day) => ({ value: day, label: GOOGLE_ADS_SCHEDULE_DAY_LABELS[day] }));
  /**
   * Start times run 00:00 to 23:45 and end times 01:00 to 24:00, as strings for `lfx-ui-select`.
   * 24:00 can only end a window, and an end hour of 0 is always refused (`googleAdScheduleRefusal`
   * takes end hours 1 to 24), so 00:15, 00:30 and 00:45 are not offered as ends.
   */
  protected readonly startTimeOptions = GOOGLE_ADS_SCHEDULE_TIME_OPTIONS.slice(0, -1).map((t) => ({ value: String(t.value), label: t.label }));
  protected readonly endTimeOptions = GOOGLE_ADS_SCHEDULE_TIME_OPTIONS.filter((t) => t.value >= 60).map((t) => ({ value: String(t.value), label: t.label }));
  protected readonly deviceModeOptions: { value: GoogleDeviceBidMode; label: string }[] = [
    { value: 'default', label: 'Default bid' },
    { value: 'adjust', label: 'Adjust bid' },
    { value: 'exclude', label: 'Exclude' },
  ];

  protected readonly scheduleRows: Signal<GoogleAdScheduleRowView[]> = this.initScheduleRows();
  protected readonly scheduleFull: Signal<boolean> = computed(() => this.adSchedules().length >= GOOGLE_ADS_MAX_AD_SCHEDULES);
  /** Where "Add window" would put a new window, or `null` when every free stretch is gone. */
  protected readonly freeSlot: Signal<CampaignAdSchedule | null> = this.initFreeSlot();
  /** Why "Add window" is disabled, shown under it and linked to it, or `null` while it is enabled. */
  protected readonly addBlockedReason: Signal<string | null> = this.initAddBlockedReason();
  protected readonly deviceRows: Signal<GoogleDeviceBidRowView[]> = this.initDeviceRows();
  /** `aria-describedby` for each section: its hint, plus its error while there is one. */
  protected readonly scheduleDescribedBy: Signal<string> = computed(() =>
    this.adSchedulesError() === null ? 'google-ad-schedule-hint' : 'google-ad-schedule-hint google-ad-schedule-error'
  );
  protected readonly devicesDescribedBy: Signal<string> = computed(() =>
    this.devicesError() === null ? 'google-devices-hint' : 'google-devices-hint google-devices-error'
  );

  /**
   * Adds a window that overlaps none already listed: {@link freeSlot}. Each of the first seven clicks
   * on an empty list adds the next day all day, which is the every-day schedule a bid adjustment per
   * day needs; after that a click fills the first gap left by shortening a window. Disabled, with
   * {@link addBlockedReason}, when there is no gap.
   */
  protected addAdSchedule(): void {
    const slot = this.freeSlot();
    if (this.scheduleFull() || slot === null) return;
    this.adSchedules.update((list) => [...list, slot]);
  }

  protected removeAdSchedule(index: number): void {
    this.adSchedules.update((list) => list.filter((_, i) => i !== index));
  }

  protected onScheduleDay(index: number, day: string | null): void {
    if (day === null) return;
    this.updateSchedule(index, (s) => ({ ...s, dayOfWeek: day as GoogleAdsScheduleDay }));
  }

  protected onScheduleTime(index: number, edge: 'start' | 'end', value: string | null): void {
    if (value === null) return;
    const minutes = Number(value);
    const hour = Math.floor(minutes / 60);
    const minute = (minutes % 60) as GoogleAdsScheduleMinute;
    this.updateSchedule(index, (s) => (edge === 'start' ? { ...s, startHour: hour, startMinute: minute } : { ...s, endHour: hour, endMinute: minute }));
  }

  /** A blank box removes the adjustment, which is not the same as 0%: see `CampaignAdSchedule.bidModifier`. */
  protected onScheduleAdjustment(index: number, change: Event): void {
    const percent = this.percentFrom(change);
    this.updateSchedule(index, (s) => {
      const unadjusted: CampaignAdSchedule = { ...s };
      delete unadjusted.bidModifier;
      return percent === null ? unadjusted : { ...unadjusted, bidModifier: googleBidModifierFromPercent(percent) };
    });
  }

  /** Default drops the device's entry; Exclude sends `0`; Adjust starts at 0% (a modifier of 1) until a percentage is typed. */
  protected onDeviceMode(device: GoogleAdsDevice, mode: string | null): void {
    if (mode === null) return;
    if (mode === 'default') {
      this.setDevice(device, null);
      return;
    }
    this.setDevice(device, mode === 'exclude' ? 0 : 1);
  }

  /** A blank box resets the adjustment to 0% rather than dropping the device: a device entry must carry a modifier. */
  protected onDeviceAdjustment(device: GoogleAdsDevice, change: Event): void {
    const percent = this.percentFrom(change) ?? 0;
    (change.target as HTMLInputElement).value = String(percent);
    this.setDevice(device, googleBidModifierFromPercent(percent));
  }

  private initScheduleRows(): Signal<GoogleAdScheduleRowView[]> {
    return computed(() =>
      this.adSchedules().map((s) => ({
        dayOfWeek: s.dayOfWeek,
        start: s.startHour * 60 + s.startMinute,
        end: s.endHour * 60 + s.endMinute,
        adjustment: s.bidModifier === undefined ? null : googleBidAdjustmentPercent(s.bidModifier),
      }))
    );
  }

  /**
   * Where the next window goes, filling a stretch no listed window covers: all of the first day (in
   * {@link GOOGLE_ADS_SCHEDULE_DAYS} order) with no window, or, once every day has one, the first gap
   * of the week. A day already holding {@link GOOGLE_ADS_MAX_AD_SCHEDULES_PER_DAY} windows is
   * skipped, and so is a gap that ends before 01:00, since an end hour of 0 is refused. Windows are
   * compared half-open, as `googleAdScheduleRefusal` compares them, so a gap starts where the window
   * before it ends.
   */
  private initFreeSlot(): Signal<CampaignAdSchedule | null> {
    return computed(() => {
      const dayEnd = 24 * 60;
      const used = new Set(this.adSchedules().map((s) => s.dayOfWeek));
      const emptyDay = GOOGLE_ADS_SCHEDULE_DAYS.find((d) => !used.has(d));
      if (emptyDay !== undefined) return { dayOfWeek: emptyDay, startHour: 0, startMinute: 0, endHour: 24, endMinute: 0 };
      for (const day of GOOGLE_ADS_SCHEDULE_DAYS) {
        const taken = this.adSchedules()
          .filter((s) => s.dayOfWeek === day)
          .map((s) => ({ start: s.startHour * 60 + s.startMinute, end: Math.min(s.endHour * 60 + s.endMinute, dayEnd) }))
          .sort((a, b) => a.start - b.start);
        if (taken.length >= GOOGLE_ADS_MAX_AD_SCHEDULES_PER_DAY) continue;
        let cursor = 0;
        for (const span of [...taken, { start: dayEnd, end: dayEnd }]) {
          if (span.start > cursor && span.start >= 60) {
            return {
              dayOfWeek: day,
              startHour: Math.floor(cursor / 60),
              startMinute: (cursor % 60) as GoogleAdsScheduleMinute,
              endHour: Math.floor(span.start / 60),
              endMinute: (span.start % 60) as GoogleAdsScheduleMinute,
            };
          }
          cursor = Math.max(cursor, span.end);
        }
      }
      return null;
    });
  }

  private initAddBlockedReason(): Signal<string | null> {
    return computed(() => {
      if (this.scheduleFull()) return `Google Ads takes at most ${GOOGLE_ADS_MAX_AD_SCHEDULES} windows. Remove one to add another.`;
      if (this.freeSlot() === null) {
        return `Every day is covered from 00:00 to 24:00 or already has ${GOOGLE_ADS_MAX_AD_SCHEDULES_PER_DAY} windows, so a new window would overlap one. Shorten or remove a window to add another.`;
      }
      return null;
    });
  }

  private initDeviceRows(): Signal<GoogleDeviceBidRowView[]> {
    return computed(() => {
      const byDevice = new Map(this.deviceBidModifiers().map((d) => [d.device, d.bidModifier]));
      return GOOGLE_ADS_DEVICES.map((device) => {
        const modifier = byDevice.get(device);
        let mode: GoogleDeviceBidMode = 'adjust';
        if (modifier === undefined) mode = 'default';
        else if (modifier === 0) mode = 'exclude';
        return { device, label: GOOGLE_ADS_DEVICE_LABELS[device], mode, adjustment: mode === 'adjust' ? googleBidAdjustmentPercent(modifier ?? 1) : null };
      });
    });
  }

  private updateSchedule(index: number, change: (schedule: CampaignAdSchedule) => CampaignAdSchedule): void {
    this.adSchedules.update((list) => list.map((s, i) => (i === index ? change(s) : s)));
  }

  /** Writes one device's modifier, or drops its entry for `null`, keeping the list in {@link GOOGLE_ADS_DEVICES} order. */
  private setDevice(device: GoogleAdsDevice, bidModifier: number | null): void {
    const others = new Map(this.deviceBidModifiers().map((d) => [d.device, d.bidModifier]));
    if (bidModifier === null) others.delete(device);
    else others.set(device, bidModifier);
    this.deviceBidModifiers.set(GOOGLE_ADS_DEVICES.filter((d) => others.has(d)).map((d) => ({ device: d, bidModifier: others.get(d) as number })));
  }

  /**
   * The typed percentage, rounded to the whole number the request can carry, or `null` for a blank box.
   * The rounded value is written back into the box: when rounding lands on the value already bound,
   * the binding does not change and would otherwise leave the typed fraction on screen.
   */
  private percentFrom(change: Event): number | null {
    const box = change.target as HTMLInputElement;
    const text = box.value.trim();
    const percent = Math.round(Number(text));
    if (text === '' || !Number.isFinite(percent)) {
      box.value = '';
      return null;
    }
    box.value = String(percent);
    return percent;
  }
}
