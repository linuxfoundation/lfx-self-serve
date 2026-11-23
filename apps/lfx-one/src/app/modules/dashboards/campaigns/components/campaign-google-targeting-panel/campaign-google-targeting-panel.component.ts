// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, Component, computed, ElementRef, inject, Injector, input, model, Signal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import {
  GOOGLE_ADS_DEMAND_GEN_DEVICES,
  GOOGLE_ADS_DEVICE_LABELS,
  GOOGLE_ADS_MAX_BID_MODIFIER,
  GOOGLE_ADS_DEVICES,
  GOOGLE_ADS_MAX_AD_SCHEDULES,
  GOOGLE_ADS_MAX_AD_SCHEDULES_PER_DAY,
  GOOGLE_ADS_MIN_BID_MODIFIER,
  GOOGLE_ADS_SCHEDULE_DAY_LABELS,
  GOOGLE_ADS_SCHEDULE_DAYS,
  GOOGLE_ADS_SCHEDULE_TIME_OPTIONS,
  GOOGLE_DEVICE_BID_MODE_LABELS,
} from '@lfx-one/shared/constants';
import type {
  CampaignAdSchedule,
  CampaignDeviceBidModifier,
  GoogleAdScheduleEdge,
  GoogleAdScheduleFreeSlot,
  GoogleAdScheduleRowView,
  GoogleAdScheduleSelectOption,
  GoogleAdScheduleSpan,
  GoogleAdsDevice,
  GoogleAdsScheduleDay,
  GoogleAdsScheduleMinute,
  GoogleDeviceBidMode,
  GoogleDeviceBidRowView,
} from '@lfx-one/shared/interfaces';
import { googleBidAdjustmentPercent, googleBidAdjustmentRangeText, googleBidModifierFromPercent, joinAsSentenceList } from '@lfx-one/shared/utils';
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
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  public readonly showAdSchedules = input.required<boolean>();
  public readonly showDevices = input.required<boolean>();
  public readonly adSchedulesError = input<string | null>(null);
  public readonly devicesError = input<string | null>(null);
  /**
   * Why a window offers no Bid adjustment box, or `null` while it does: the tab's sentence for an
   * effective bidding strategy Google ignores schedule adjustments under (anything but Manual CPC and
   * Maximize Clicks). The windows stay editable. A window already adjusted keeps its value read-only,
   * held, with a Clear button.
   */
  public readonly scheduleAdjustBlockedReason = input<string | null>(null);
  /**
   * Why Adjust bid is not offered, or `null` while it is: the tab's sentence for an effective bidding
   * strategy other than Manual CPC, under which campaign-service refuses a non-zero device modifier.
   * While set, a device offers Default bid and Exclude only, and one already adjusted is shown held.
   */
  public readonly deviceAdjustBlockedReason = input<string | null>(null);
  /**
   * The devices the channel takes, one row each: the tab's `googleAdsDevicesOn` answer. Demand Gen
   * and Performance Max add TV screens; the default is the three every other channel takes.
   */
  public readonly devices = input<readonly GoogleAdsDevice[]>(GOOGLE_ADS_DEVICES);

  public readonly adSchedules = model.required<CampaignAdSchedule[]>();
  public readonly deviceBidModifiers = model.required<CampaignDeviceBidModifier[]>();

  protected readonly maxAdSchedules = GOOGLE_ADS_MAX_AD_SCHEDULES;
  /** Google's adjustment range as whole percentages and as text, from the shared modifier bounds, for both boxes and hints. */
  protected readonly minAdjustment = googleBidAdjustmentPercent(GOOGLE_ADS_MIN_BID_MODIFIER);
  protected readonly maxAdjustment = googleBidAdjustmentPercent(GOOGLE_ADS_MAX_BID_MODIFIER);
  protected readonly adjustmentRange = googleBidAdjustmentRangeText();
  protected readonly dayOptions: GoogleAdScheduleSelectOption[] = GOOGLE_ADS_SCHEDULE_DAYS.map((day) => ({
    value: day,
    label: GOOGLE_ADS_SCHEDULE_DAY_LABELS[day],
  }));
  /**
   * Start times run 00:00 to 23:45 and end times 01:00 to 24:00, as strings for `lfx-ui-select`.
   * 24:00 can only end a window, and an end hour of 0 is always refused (`googleAdScheduleRefusal`
   * takes end hours 1 to 24), so 00:15, 00:30 and 00:45 are not offered as ends.
   */
  protected readonly startTimeOptions: GoogleAdScheduleSelectOption[] = GOOGLE_ADS_SCHEDULE_TIME_OPTIONS.slice(0, -1).map((t) => ({
    value: String(t.value),
    label: t.label,
  }));
  protected readonly endTimeOptions: GoogleAdScheduleSelectOption[] = GOOGLE_ADS_SCHEDULE_TIME_OPTIONS.filter((t) => t.value >= 60).map((t) => ({
    value: String(t.value),
    label: t.label,
  }));

  protected readonly scheduleRows: Signal<GoogleAdScheduleRowView[]> = this.initScheduleRows();
  protected readonly scheduleFull: Signal<boolean> = computed(() => this.adSchedules().length >= GOOGLE_ADS_MAX_AD_SCHEDULES);
  /** Where "Add window" would put a new window, or, when every free stretch is gone, which days ruled it out. */
  protected readonly freeSlot: Signal<GoogleAdScheduleFreeSlot> = this.initFreeSlot();
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
    const { slot } = this.freeSlot();
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

  protected onScheduleTime(index: number, edge: GoogleAdScheduleEdge, value: string | null): void {
    if (value === null) return;
    const minutes = Number(value);
    const hour = Math.floor(minutes / 60);
    const minute = (minutes % 60) as GoogleAdsScheduleMinute;
    this.updateSchedule(index, (s) => (edge === 'start' ? { ...s, startHour: hour, startMinute: minute } : { ...s, endHour: hour, endMinute: minute }));
  }

  /**
   * A blank box removes the adjustment, which is not the same as 0%: see `CampaignAdSchedule.bidModifier`.
   * Ignored while {@link scheduleAdjustBlockedReason} is set, as a stale Adjust bid is for devices: a held
   * box is read-only, and the only edit left is {@link clearScheduleAdjustment}.
   */
  protected onScheduleAdjustment(index: number, change: Event): void {
    if (this.scheduleAdjustBlockedReason() !== null) return;
    const percent = this.percentFrom(change);
    this.updateSchedule(index, (s) => {
      const unadjusted: CampaignAdSchedule = { ...s };
      delete unadjusted.bidModifier;
      return percent === null ? unadjusted : { ...unadjusted, bidModifier: googleBidModifierFromPercent(percent) };
    });
  }

  /**
   * Drops a window's bid adjustment, leaving the window: how a held adjustment is let go. The Clear
   * button and the read-only box leave the row once the list comes back without the adjustment, so
   * focus moves to that row's remove button after the next render rather than falling to the page.
   */
  protected clearScheduleAdjustment(index: number): void {
    this.updateSchedule(index, (s) => {
      const unadjusted: CampaignAdSchedule = { ...s };
      delete unadjusted.bidModifier;
      return unadjusted;
    });
    afterNextRender(
      () => {
        this.host.nativeElement.querySelector<HTMLButtonElement>(`[data-testid="implementation-google-ad-schedule-remove-${index}"] button`)?.focus();
      },
      { injector: this.injector }
    );
  }

  /**
   * Default drops the device's entry; Exclude sends `0`; Adjust starts at 0% (a modifier of 1) until a
   * percentage is typed. Adjust is ignored while {@link deviceAdjustBlockedReason} is set: even 0% is a
   * modifier of 1, which campaign-service refuses under any strategy but Manual CPC.
   */
  protected onDeviceMode(device: GoogleAdsDevice, mode: string | null): void {
    if (mode === null) return;
    if (mode === 'adjust' && this.deviceAdjustBlockedReason() !== null) return;
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

  /** One row per window; an adjustment is `held` while {@link scheduleAdjustBlockedReason} is set. */
  private initScheduleRows(): Signal<GoogleAdScheduleRowView[]> {
    return computed(() => {
      const blocked = this.scheduleAdjustBlockedReason() !== null;
      return this.adSchedules().map((s) => ({
        dayOfWeek: s.dayOfWeek,
        start: s.startHour * 60 + s.startMinute,
        end: s.endHour * 60 + s.endMinute,
        adjustment: s.bidModifier === undefined ? null : googleBidAdjustmentPercent(s.bidModifier),
        held: blocked && s.bidModifier !== undefined,
      }));
    });
  }

  /**
   * Where the next window goes, filling a stretch no listed window covers: all of the first day (in
   * {@link GOOGLE_ADS_SCHEDULE_DAYS} order) with no window, or, once every day has one, the first gap
   * of the week. A day already holding {@link GOOGLE_ADS_MAX_AD_SCHEDULES_PER_DAY} windows is
   * skipped, and so is a gap that ends before 01:00, since an end hour of 0 is refused. Windows are
   * compared half-open, as `googleAdScheduleRefusal` compares them, so a gap starts where the window
   * before it ends. When nothing is found, the days skipped for each of those two reasons are
   * returned, so {@link addBlockedReason} can say which one applies.
   */
  private initFreeSlot(): Signal<GoogleAdScheduleFreeSlot> {
    return computed(() => {
      const dayEnd = 24 * 60;
      const fullDays: GoogleAdsScheduleDay[] = [];
      const earlyOnlyDays: GoogleAdsScheduleDay[] = [];
      const used = new Set(this.adSchedules().map((s) => s.dayOfWeek));
      const emptyDay = GOOGLE_ADS_SCHEDULE_DAYS.find((d) => !used.has(d));
      if (emptyDay !== undefined) return { slot: { dayOfWeek: emptyDay, startHour: 0, startMinute: 0, endHour: 24, endMinute: 0 }, fullDays, earlyOnlyDays };
      for (const day of GOOGLE_ADS_SCHEDULE_DAYS) {
        const taken: GoogleAdScheduleSpan[] = this.adSchedules()
          .filter((s) => s.dayOfWeek === day)
          .map((s) => ({ start: s.startHour * 60 + s.startMinute, end: Math.min(s.endHour * 60 + s.endMinute, dayEnd) }))
          .sort((a, b) => a.start - b.start);
        if (taken.length >= GOOGLE_ADS_MAX_AD_SCHEDULES_PER_DAY) {
          fullDays.push(day);
          continue;
        }
        let cursor = 0;
        let earlyGap = false;
        for (const span of [...taken, { start: dayEnd, end: dayEnd }]) {
          if (span.start > cursor) {
            if (span.start >= 60) {
              const slot: CampaignAdSchedule = {
                dayOfWeek: day,
                startHour: Math.floor(cursor / 60),
                startMinute: (cursor % 60) as GoogleAdsScheduleMinute,
                endHour: Math.floor(span.start / 60),
                endMinute: (span.start % 60) as GoogleAdsScheduleMinute,
              };
              return { slot, fullDays, earlyOnlyDays };
            }
            earlyGap = true;
          }
          cursor = Math.max(cursor, span.end);
        }
        if (earlyGap) earlyOnlyDays.push(day);
      }
      return { slot: null, fullDays, earlyOnlyDays };
    });
  }

  /**
   * Why "Add window" is disabled, naming only the reasons that hold: the overall cap, days at the
   * per-day cap, days whose only free time ends before 01:00, and days covered from 00:00 to 24:00.
   */
  private initAddBlockedReason(): Signal<string | null> {
    return computed(() => {
      if (this.scheduleFull()) return `Google Ads takes at most ${GOOGLE_ADS_MAX_AD_SCHEDULES} windows. Remove one to add another.`;
      const { slot, fullDays, earlyOnlyDays } = this.freeSlot();
      if (slot !== null) return null;
      if (fullDays.length === 0 && earlyOnlyDays.length === 0) {
        return 'Every day is covered from 00:00 to 24:00, so a new window would overlap one. Shorten or remove a window to add another.';
      }
      const parts: string[] = [];
      if (fullDays.length > 0) {
        parts.push(`${this.dayList(fullDays)} already ${fullDays.length === 1 ? 'has' : 'have'} ${GOOGLE_ADS_MAX_AD_SCHEDULES_PER_DAY} windows`);
      }
      if (earlyOnlyDays.length > 0) {
        parts.push(
          `${this.dayList(earlyOnlyDays)} only ${earlyOnlyDays.length === 1 ? 'has' : 'have'} free time before 01:00, and Google Ads cannot end a window that early`
        );
      }
      if (fullDays.length + earlyOnlyDays.length < GOOGLE_ADS_SCHEDULE_DAYS.length) parts.push('every other day is covered from 00:00 to 24:00');
      return `${parts.join('; ')}. Shorten or remove a window to add another.`;
    });
  }

  /**
   * One row per device. While {@link deviceAdjustBlockedReason} is set, Adjust bid is left out of the
   * picker, except on a device that already holds an adjustment: there it stays, disabled, and the
   * percentage box turns read-only (still focusable and announced), so the held value can be read
   * and the operator moves it to Default bid or Exclude.
   */
  private initDeviceRows(): Signal<GoogleDeviceBidRowView[]> {
    return computed(() => {
      const blocked = this.deviceAdjustBlockedReason() !== null;
      const byDevice = new Map(this.deviceBidModifiers().map((d) => [d.device, d.bidModifier]));
      return this.devices().map((device) => {
        const modifier = byDevice.get(device);
        let mode: GoogleDeviceBidMode = 'adjust';
        if (modifier === undefined) mode = 'default';
        else if (modifier === 0) mode = 'exclude';
        const held = blocked && mode === 'adjust';
        const modeOptions = (Object.keys(GOOGLE_DEVICE_BID_MODE_LABELS) as GoogleDeviceBidMode[])
          .filter((value) => value !== 'adjust' || !blocked || held)
          .map((value) => ({ value, label: GOOGLE_DEVICE_BID_MODE_LABELS[value], disabled: value === 'adjust' && blocked }));
        return {
          device,
          label: GOOGLE_ADS_DEVICE_LABELS[device],
          mode,
          adjustment: mode === 'adjust' ? googleBidAdjustmentPercent(modifier ?? 1) : null,
          held,
          modeOptions,
        };
      });
    });
  }

  private updateSchedule(index: number, change: (schedule: CampaignAdSchedule) => CampaignAdSchedule): void {
    this.adSchedules.update((list) => list.map((s, i) => (i === index ? change(s) : s)));
  }

  /**
   * Writes one device's modifier, or drops its entry for `null`, keeping the list in
   * {@link GOOGLE_ADS_DEMAND_GEN_DEVICES} order. Ordered by that widest vocabulary rather than by
   * {@link devices}, so an entry the current channel does not list (TV screens, held after a switch
   * away from Demand Gen or Performance Max) survives an edit to another row.
   */
  private setDevice(device: GoogleAdsDevice, bidModifier: number | null): void {
    const others = new Map(this.deviceBidModifiers().map((d) => [d.device, d.bidModifier]));
    if (bidModifier === null) others.delete(device);
    else others.set(device, bidModifier);
    this.deviceBidModifiers.set(GOOGLE_ADS_DEMAND_GEN_DEVICES.filter((d) => others.has(d)).map((d) => ({ device: d, bidModifier: others.get(d) as number })));
  }

  /** Day names as a sentence fragment, through the shared {@link joinAsSentenceList}: "Monday, Tuesday and Friday". */
  private dayList(days: GoogleAdsScheduleDay[]): string {
    return joinAsSentenceList(days.map((day) => GOOGLE_ADS_SCHEDULE_DAY_LABELS[day]));
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
