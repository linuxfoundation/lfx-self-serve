// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, model, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import {
  GOOGLE_ADS_DEVICE_LABELS,
  GOOGLE_ADS_DEVICES,
  GOOGLE_ADS_MAX_AD_SCHEDULES,
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

/**
 * The Google campaign's ad schedule and device bid adjustments on the Implement tab (#4991).
 *
 * Renders straight from the lists it is given and writes every edit back through them, keeping
 * no form state of its own. The tab owns the lists: it saves them in the draft, empties them when
 * the brief changes, and judges them with the shared `googleAdScheduleRefusal` and
 * `googleDeviceBidModifierRefusal` — the same functions the BFF refuses a create with — and passes
 * the answer back in as an error. A copy held here would keep showing a list the tab had already
 * replaced. Native `<select>` and `<input>` elements for the same reason: the `lfx-*` wrappers bind
 * to a `FormGroup`, which is exactly that copy.
 */
@Component({
  selector: 'lfx-campaign-google-targeting-panel',
  imports: [ButtonComponent],
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
  /** Start times stop at 23:45 and end times start at 00:15: 24:00 can only end a window, and 00:00 only start one. */
  protected readonly startTimeOptions = GOOGLE_ADS_SCHEDULE_TIME_OPTIONS.slice(0, -1);
  protected readonly endTimeOptions = GOOGLE_ADS_SCHEDULE_TIME_OPTIONS.slice(1);

  protected readonly scheduleRows: Signal<GoogleAdScheduleRowView[]> = this.initScheduleRows();
  protected readonly scheduleFull: Signal<boolean> = computed(() => this.adSchedules().length >= GOOGLE_ADS_MAX_AD_SCHEDULES);
  protected readonly deviceRows: Signal<GoogleDeviceBidRowView[]> = this.initDeviceRows();
  /** `aria-describedby` for each section: its hint, plus its error while there is one. */
  protected readonly scheduleDescribedBy: Signal<string> = computed(() =>
    this.adSchedulesError() === null ? 'google-ad-schedule-hint' : 'google-ad-schedule-hint google-ad-schedule-error'
  );
  protected readonly devicesDescribedBy: Signal<string> = computed(() =>
    this.devicesError() === null ? 'google-devices-hint' : 'google-devices-hint google-devices-error'
  );

  /**
   * Adds an all-day window on the first day that has none yet, so a fresh row never overlaps one
   * already listed. Seven clicks give the all-day, every-day schedule a bid adjustment per day needs.
   */
  protected addAdSchedule(): void {
    if (this.scheduleFull()) return;
    const used = new Set(this.adSchedules().map((s) => s.dayOfWeek));
    const day = GOOGLE_ADS_SCHEDULE_DAYS.find((d) => !used.has(d)) ?? GOOGLE_ADS_SCHEDULE_DAYS[0];
    this.adSchedules.update((list) => [...list, { dayOfWeek: day, startHour: 0, startMinute: 0, endHour: 24, endMinute: 0 }]);
  }

  protected removeAdSchedule(index: number): void {
    this.adSchedules.update((list) => list.filter((_, i) => i !== index));
  }

  protected onScheduleDay(index: number, event: Event): void {
    const day = (event.target as HTMLSelectElement).value as GoogleAdsScheduleDay;
    this.updateSchedule(index, (s) => ({ ...s, dayOfWeek: day }));
  }

  protected onScheduleTime(index: number, edge: 'start' | 'end', event: Event): void {
    const minutes = Number((event.target as HTMLSelectElement).value);
    const hour = Math.floor(minutes / 60);
    const minute = (minutes % 60) as GoogleAdsScheduleMinute;
    this.updateSchedule(index, (s) => (edge === 'start' ? { ...s, startHour: hour, startMinute: minute } : { ...s, endHour: hour, endMinute: minute }));
  }

  /** A blank box removes the adjustment, which is not the same as 0%: see `CampaignAdSchedule.bidModifier`. */
  protected onScheduleAdjustment(index: number, event: Event): void {
    const percent = this.percentFrom(event);
    this.updateSchedule(index, (s) => {
      const window: CampaignAdSchedule = { ...s };
      delete window.bidModifier;
      return percent === null ? window : { ...window, bidModifier: googleBidModifierFromPercent(percent) };
    });
  }

  /** Default drops the device's entry; Exclude sends `0`; Adjust starts at 0% (a modifier of 1) until a percentage is typed. */
  protected onDeviceMode(device: GoogleAdsDevice, event: Event): void {
    const mode = (event.target as HTMLSelectElement).value as GoogleDeviceBidMode;
    if (mode === 'default') {
      this.setDevice(device, null);
      return;
    }
    this.setDevice(device, mode === 'exclude' ? 0 : 1);
  }

  /** A blank box resets the adjustment to 0% rather than dropping the device: a device entry must carry a modifier. */
  protected onDeviceAdjustment(device: GoogleAdsDevice, event: Event): void {
    const percent = this.percentFrom(event) ?? 0;
    (event.target as HTMLInputElement).value = String(percent);
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
  private percentFrom(event: Event): number | null {
    const box = event.target as HTMLInputElement;
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
