// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CampaignAdSchedule, CampaignDeviceBidModifier } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CampaignGoogleTargetingPanelComponent } from './campaign-google-targeting-panel.component';

describe('CampaignGoogleTargetingPanelComponent', () => {
  let fixture: ComponentFixture<CampaignGoogleTargetingPanelComponent>;
  let schedules: CampaignAdSchedule[][];
  let devices: CampaignDeviceBidModifier[][];

  function query<T extends HTMLElement = HTMLElement>(testId: string): T | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  /** Types into one of the two native percentage boxes and commits it, as leaving the box does. */
  function type(testId: string, value: string): void {
    const box = query<HTMLInputElement>(testId) as HTMLInputElement;
    box.value = value;
    box.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fixture.whenStable();
  }

  /** The labels an `lfx-ui-select` offers, read from its open list and closed again. */
  async function optionLabels(testId: string): Promise<string[]> {
    const trigger = query(testId)?.querySelector('[data-testid="ui-select-trigger"]') as HTMLElement;
    trigger.click();
    await settle();
    const labels = Array.from(document.querySelectorAll('[data-testid="ui-option"]')).map((option) => option.textContent?.trim() ?? '');
    trigger.click();
    await settle();
    return labels;
  }

  /** Opens an `lfx-ui-select` and clicks the option with this label, as a user picks one. */
  async function pick(testId: string, label: string): Promise<void> {
    (query(testId)?.querySelector('[data-testid="ui-select-trigger"]') as HTMLElement).click();
    await settle();
    (
      Array.from(document.querySelectorAll<HTMLElement>('[data-testid="ui-option"]')).find((option) => option.textContent?.trim() === label) as HTMLElement
    ).click();
    await settle();
  }

  function clickAdd(): void {
    (query('implementation-google-ad-schedule-add')?.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  function render(inputs: { adSchedules?: CampaignAdSchedule[]; devices?: CampaignDeviceBidModifier[]; scheduleError?: string | null }): void {
    fixture.componentRef.setInput('showAdSchedules', true);
    fixture.componentRef.setInput('showDevices', true);
    fixture.componentRef.setInput('adSchedules', inputs.adSchedules ?? []);
    fixture.componentRef.setInput('deviceBidModifiers', inputs.devices ?? []);
    fixture.componentRef.setInput('adSchedulesError', inputs.scheduleError ?? null);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CampaignGoogleTargetingPanelComponent] }).compileComponents();
    fixture = TestBed.createComponent(CampaignGoogleTargetingPanelComponent);
    document.body.appendChild(fixture.nativeElement);
    schedules = [];
    devices = [];
    fixture.componentInstance.adSchedules.subscribe((list) => schedules.push(list));
    fixture.componentInstance.deviceBidModifiers.subscribe((list) => devices.push(list));
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('adds an all-day window on the first day without one', () => {
    render({ adSchedules: [{ dayOfWeek: 'MONDAY', startHour: 9, startMinute: 0, endHour: 17, endMinute: 0 }] });

    clickAdd();

    expect(schedules.at(-1)?.[1]).toEqual({ dayOfWeek: 'TUESDAY', startHour: 0, startMinute: 0, endHour: 24, endMinute: 0 });
  });

  it('never adds an overlapping window: the eighth click fills the first gap, and Add is disabled with a reason when none is left', () => {
    render({});
    for (let click = 0; click < 7; click++) {
      clickAdd();
      fixture.componentRef.setInput('adSchedules', schedules.at(-1));
      fixture.detectChanges();
    }
    expect(schedules.at(-1)?.map((s) => s.dayOfWeek)).toEqual(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']);

    // Every day all day: no gap anywhere, so the eighth click has nothing to add.
    const writes = schedules.length;
    expect((query('implementation-google-ad-schedule-add')?.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    expect(query('implementation-google-ad-schedule-add-reason')?.textContent).toContain('a new window would overlap one');
    expect(query('implementation-google-ad-schedule-add')?.querySelector('button')?.getAttribute('aria-describedby')).toBe('google-ad-schedule-add-reason');
    clickAdd();
    expect(schedules).toHaveLength(writes);

    // Shorten Wednesday to start at 09:00: the eighth click fills 00:00-09:00 there, not Monday again.
    const shortened = (schedules.at(-1) ?? []).map((s) => (s.dayOfWeek === 'WEDNESDAY' ? { ...s, startHour: 9 } : s));
    fixture.componentRef.setInput('adSchedules', shortened);
    fixture.detectChanges();
    expect(query('implementation-google-ad-schedule-add-reason')).toBeNull();
    clickAdd();
    expect(schedules.at(-1)?.[7]).toEqual({ dayOfWeek: 'WEDNESDAY', startHour: 0, startMinute: 0, endHour: 9, endMinute: 0 });
  });

  it('skips a gap that would end before 01:00, since an end hour of 0 is refused, and says that is why', () => {
    const allDay = { startHour: 0, startMinute: 0 as const, endHour: 24, endMinute: 0 as const };
    render({
      adSchedules: [
        { dayOfWeek: 'MONDAY', startHour: 0, startMinute: 30, endHour: 24, endMinute: 0 },
        ...(['TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const).map((dayOfWeek) => ({ dayOfWeek, ...allDay })),
      ],
    });

    // Monday is neither covered nor at the per-day cap, so the reason must not claim either of it.
    expect(query('implementation-google-ad-schedule-add-reason')?.textContent?.trim()).toBe(
      'Monday only has free time before 01:00, and Google Ads cannot end a window that early; every other day is covered from 00:00 to 24:00. Shorten or remove a window to add another.'
    );
  });

  it('names the days at the per-day cap when those are what leave no room', () => {
    const allDay = { startHour: 0, startMinute: 0 as const, endHour: 24, endMinute: 0 as const };
    const mondayHours = Array.from({ length: 6 }, (_, hour) => ({
      dayOfWeek: 'MONDAY' as const,
      startHour: hour,
      startMinute: 0 as const,
      endHour: hour + 1,
      endMinute: 0 as const,
    }));
    render({
      adSchedules: [
        ...mondayHours,
        { dayOfWeek: 'TUESDAY', startHour: 0, startMinute: 15, endHour: 24, endMinute: 0 },
        ...(['WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const).map((dayOfWeek) => ({ dayOfWeek, ...allDay })),
      ],
    });

    expect(query('implementation-google-ad-schedule-add-reason')?.textContent?.trim()).toBe(
      'Monday already has 6 windows; Tuesday only has free time before 01:00, and Google Ads cannot end a window that early; every other day is covered from 00:00 to 24:00. Shorten or remove a window to add another.'
    );
  });

  it('offers end times from 01:00, never an end hour of 0, and start times up to 23:45', async () => {
    render({ adSchedules: [{ dayOfWeek: 'MONDAY', startHour: 0, startMinute: 0, endHour: 24, endMinute: 0 }] });

    const ends = await optionLabels('implementation-google-ad-schedule-end-0');
    expect(ends[0]).toBe('01:00');
    expect(ends.at(-1)).toBe('24:00');
    const starts = await optionLabels('implementation-google-ad-schedule-start-0');
    expect(starts[0]).toBe('00:00');
    expect(starts.at(-1)).toBe('23:45');
  });

  it('writes the day, the times and a percentage adjustment as Google bid modifiers', async () => {
    render({ adSchedules: [{ dayOfWeek: 'MONDAY', startHour: 0, startMinute: 0, endHour: 24, endMinute: 0 }] });

    await pick('implementation-google-ad-schedule-day-0', 'Saturday');
    expect(schedules.at(-1)?.[0].dayOfWeek).toBe('SATURDAY');

    fixture.componentRef.setInput('adSchedules', schedules.at(-1));
    await pick('implementation-google-ad-schedule-start-0', '09:30');
    expect(schedules.at(-1)?.[0]).toMatchObject({ startHour: 9, startMinute: 30 });

    fixture.componentRef.setInput('adSchedules', schedules.at(-1));
    await pick('implementation-google-ad-schedule-end-0', '17:45');
    expect(schedules.at(-1)?.[0]).toMatchObject({ endHour: 17, endMinute: 45 });

    fixture.componentRef.setInput('adSchedules', schedules.at(-1));
    type('implementation-google-ad-schedule-adjustment-0', '-50');
    expect(schedules.at(-1)?.[0].bidModifier).toBe(0.5);

    fixture.componentRef.setInput('adSchedules', schedules.at(-1));
    type('implementation-google-ad-schedule-adjustment-0', '');
    expect(schedules.at(-1)?.[0]).not.toHaveProperty('bidModifier');
  });

  it('bounds the schedule adjustment at -90%, the lowest Google takes on a schedule, and no longer offers -100%', () => {
    render({ adSchedules: [{ dayOfWeek: 'MONDAY', startHour: 0, startMinute: 0, endHour: 24, endMinute: 0 }] });

    const box = query<HTMLInputElement>('implementation-google-ad-schedule-adjustment-0') as HTMLInputElement;
    expect(box.min).toBe('-90');
    expect(box.max).toBe('900');
    const hint = query('implementation-google-ad-schedule-hint')?.textContent ?? '';
    expect(hint).toContain('A bid adjustment runs from -90% to +900%; leave it blank for none.');
    expect(hint).not.toContain('-100%');

    // -90% is a bid modifier of 0.1, the bottom of Google's schedule range.
    type('implementation-google-ad-schedule-adjustment-0', '-90');
    expect(schedules.at(-1)?.[0].bidModifier).toBe(0.1);
  });

  it('offers no adjustment box while the strategy ignores schedule adjustments, says why, and keeps the windows editable', async () => {
    const reason = 'Google Ads applies an ad schedule bid adjustment only under Manual CPC or Maximize Clicks.';
    render({ adSchedules: [{ dayOfWeek: 'MONDAY', startHour: 0, startMinute: 0, endHour: 24, endMinute: 0 }] });
    fixture.componentRef.setInput('scheduleAdjustBlockedReason', reason);
    fixture.detectChanges();

    expect(query('implementation-google-ad-schedule-adjustment-0')).toBeNull();
    expect(query('implementation-google-ad-schedule-clear-0')).toBeNull();
    const hint = query('implementation-google-ad-schedule-hint')?.textContent ?? '';
    expect(hint).toContain(reason);
    expect(hint).not.toContain('-90% to +900%');

    await pick('implementation-google-ad-schedule-day-0', 'Friday');
    expect(schedules.at(-1)?.[0].dayOfWeek).toBe('FRIDAY');
    fixture.componentRef.setInput('adSchedules', schedules.at(-1));
    clickAdd();
    expect(schedules.at(-1)).toHaveLength(2);
  });

  it('holds an adjustment read-only (still reachable, not disabled) while the strategy ignores it, and Clear drops only the adjustment', () => {
    render({
      adSchedules: [
        { dayOfWeek: 'MONDAY', startHour: 9, startMinute: 0, endHour: 17, endMinute: 0, bidModifier: 1.5 },
        { dayOfWeek: 'TUESDAY', startHour: 9, startMinute: 0, endHour: 17, endMinute: 0 },
      ],
    });
    fixture.componentRef.setInput('scheduleAdjustBlockedReason', 'Held under Target CPA.');
    fixture.detectChanges();

    const box = query<HTMLInputElement>('implementation-google-ad-schedule-adjustment-0') as HTMLInputElement;
    expect(box.value).toBe('50');
    expect(box.readOnly).toBe(true);
    expect(box.getAttribute('aria-readonly')).toBe('true');
    expect(box.disabled).toBe(false);
    expect(query('implementation-google-ad-schedule-adjustment-1')).toBeNull();
    expect(query('implementation-google-ad-schedule-clear-1')).toBeNull();

    // A change event from a stale box writes nothing: the held value can only be cleared.
    const writes = schedules.length;
    type('implementation-google-ad-schedule-adjustment-0', '20');
    expect(schedules).toHaveLength(writes);

    const clear = query('implementation-google-ad-schedule-clear-0')?.querySelector('button') as HTMLButtonElement;
    // The accessible name starts with the visible label (WCAG 2.5.3).
    expect(clear.getAttribute('aria-label')).toBe('Clear adjustment on ad schedule window 1');
    clear.click();
    expect(schedules.at(-1)).toEqual([
      { dayOfWeek: 'MONDAY', startHour: 9, startMinute: 0, endHour: 17, endMinute: 0 },
      { dayOfWeek: 'TUESDAY', startHour: 9, startMinute: 0, endHour: 17, endMinute: 0 },
    ]);
  });

  it("moves focus to the window's remove button after Clear, since the Clear button leaves the row", async () => {
    const held = { dayOfWeek: 'MONDAY' as const, startHour: 9, startMinute: 0 as const, endHour: 17, endMinute: 0 as const, bidModifier: 1.5 };
    render({ adSchedules: [{ ...held, dayOfWeek: 'SUNDAY' }, held] });
    fixture.componentRef.setInput('scheduleAdjustBlockedReason', 'Held under Target CPA.');
    fixture.detectChanges();

    (query('implementation-google-ad-schedule-clear-1')?.querySelector('button') as HTMLButtonElement).click();
    // The tab feeds the cleared list back, as it does in the app.
    fixture.componentRef.setInput('adSchedules', schedules.at(-1));
    fixture.detectChanges();
    await settle();

    expect(query('implementation-google-ad-schedule-clear-1')).toBeNull();
    expect(document.activeElement).toBe(query('implementation-google-ad-schedule-remove-1')?.querySelector('button'));
  });

  it('shows each picker with the value of the list it is given', () => {
    render({
      adSchedules: [{ dayOfWeek: 'FRIDAY', startHour: 9, startMinute: 15, endHour: 24, endMinute: 0 }],
      devices: [{ device: 'TABLET', bidModifier: 0 }],
    });
    const shown = (testId: string) => query(testId)?.querySelector('[data-testid="ui-select-value"]')?.textContent?.trim();

    expect(shown('implementation-google-ad-schedule-day-0')).toBe('Friday');
    expect(shown('implementation-google-ad-schedule-start-0')).toBe('09:15');
    expect(shown('implementation-google-ad-schedule-end-0')).toBe('24:00');
    expect(shown('implementation-google-device-mode-TABLET')).toBe('Exclude');
    expect(shown('implementation-google-device-mode-MOBILE')).toBe('Default bid');
  });

  it('removes a window by index', () => {
    render({
      adSchedules: [
        { dayOfWeek: 'MONDAY', startHour: 0, startMinute: 0, endHour: 24, endMinute: 0 },
        { dayOfWeek: 'TUESDAY', startHour: 0, startMinute: 0, endHour: 24, endMinute: 0 },
      ],
    });

    (query('implementation-google-ad-schedule-remove-0')?.querySelector('button') as HTMLButtonElement).click();

    expect(schedules.at(-1)?.map((s) => s.dayOfWeek)).toEqual(['TUESDAY']);
  });

  it('labels every schedule control and wires the error to the section', () => {
    render({
      adSchedules: [{ dayOfWeek: 'MONDAY', startHour: 0, startMinute: 0, endHour: 24, endMinute: 0 }],
      scheduleError: 'The Google Ads ad schedule 1 overlaps.',
    });

    // The pickers carry their own visible label, which names the combobox; the box keeps its <label for>.
    for (const [id, label] of [
      ['day', 'Day'],
      ['start', 'From'],
      ['end', 'To'],
    ]) {
      const select = query(`implementation-google-ad-schedule-${id}-0`) as HTMLElement;
      const labelledBy = select.querySelector('[data-testid="ui-select-trigger"]')?.getAttribute('aria-labelledby') ?? '';
      expect(document.getElementById(labelledBy)?.textContent?.trim()).toBe(label);
    }
    expect(fixture.nativeElement.querySelector('label[for="google-ad-schedule-adjustment-0"]')).not.toBeNull();
    expect(query('implementation-google-ad-schedule')?.getAttribute('aria-describedby')).toBe('google-ad-schedule-hint google-ad-schedule-error');
    expect(query('implementation-google-ad-schedule-error')?.textContent).toContain('overlaps');
    expect(query('implementation-google-targeting-live')?.textContent).toContain('overlaps');
  });

  it('turns each device choice into its modifier, in Google order, and drops a device set back to default', async () => {
    render({});

    await pick('implementation-google-device-mode-TABLET', 'Exclude');
    expect(devices.at(-1)).toEqual([{ device: 'TABLET', bidModifier: 0 }]);

    fixture.componentRef.setInput('deviceBidModifiers', devices.at(-1));
    await pick('implementation-google-device-mode-MOBILE', 'Adjust bid');
    fixture.componentRef.setInput('deviceBidModifiers', devices.at(-1));
    fixture.detectChanges();
    const deviceBox = query<HTMLInputElement>('implementation-google-device-adjustment-MOBILE') as HTMLInputElement;
    expect([deviceBox.min, deviceBox.max]).toEqual(['-90', '900']);
    type('implementation-google-device-adjustment-MOBILE', '25');
    expect(devices.at(-1)).toEqual([
      { device: 'MOBILE', bidModifier: 1.25 },
      { device: 'TABLET', bidModifier: 0 },
    ]);

    fixture.componentRef.setInput('deviceBidModifiers', devices.at(-1));
    await pick('implementation-google-device-mode-TABLET', 'Default bid');
    expect(devices.at(-1)).toEqual([{ device: 'MOBILE', bidModifier: 1.25 }]);
  });

  it('lists a row per device it is given, TV screens on Demand Gen, and excludes it', async () => {
    render({});
    expect(query('implementation-google-device-CONNECTED_TV')).toBeNull();

    fixture.componentRef.setInput('devices', ['MOBILE', 'DESKTOP', 'TABLET', 'CONNECTED_TV']);
    fixture.componentRef.setInput('deviceAdjustBlockedReason', 'Exclusions only.');
    fixture.detectChanges();
    expect(query('implementation-google-device-CONNECTED_TV')?.textContent).toContain('TV screens');
    expect(await optionLabels('implementation-google-device-mode-CONNECTED_TV')).toEqual(['Default bid', 'Exclude']);

    await pick('implementation-google-device-mode-CONNECTED_TV', 'Exclude');
    expect(devices.at(-1)).toEqual([{ device: 'CONNECTED_TV', bidModifier: 0 }]);
  });

  it('keeps a TV screens entry the rows do not list when another device changes, so a held exclusion survives', async () => {
    render({ devices: [{ device: 'CONNECTED_TV', bidModifier: 0 }] });

    await pick('implementation-google-device-mode-MOBILE', 'Exclude');
    expect(devices.at(-1)).toEqual([
      { device: 'MOBILE', bidModifier: 0 },
      { device: 'CONNECTED_TV', bidModifier: 0 },
    ]);
  });

  it('offers Adjust bid under Manual CPC and says the adjustment range', async () => {
    render({});

    expect(await optionLabels('implementation-google-device-mode-MOBILE')).toEqual(['Default bid', 'Adjust bid', 'Exclude']);
    expect(query('implementation-google-devices-hint')?.textContent).toContain('Adjust the bid on a device from -90% to +900%');
  });

  it('offers only Default bid and Exclude while the strategy refuses adjustments, says why, and still excludes', async () => {
    const reason = "Google Ads doesn't apply a device bid adjustment under Maximize Conversions, except a -100% exclusion, so LFX One doesn't send one.";
    render({});
    fixture.componentRef.setInput('deviceAdjustBlockedReason', reason);
    fixture.detectChanges();

    expect(await optionLabels('implementation-google-device-mode-MOBILE')).toEqual(['Default bid', 'Exclude']);
    expect(query('implementation-google-devices-hint')?.textContent).toContain(reason);
    expect(query('implementation-google-devices-hint')?.textContent).not.toContain('-90% to +900%');

    await pick('implementation-google-device-mode-MOBILE', 'Exclude');
    expect(devices.at(-1)).toEqual([{ device: 'MOBILE', bidModifier: 0 }]);

    // A stale Adjust choice from an option list rendered before the switch writes nothing.
    const writes = devices.length;
    (fixture.componentInstance as unknown as { onDeviceMode: (device: string, mode: string) => void }).onDeviceMode('TABLET', 'adjust');
    expect(devices).toHaveLength(writes);
  });

  it('shows a held adjustment with Adjust bid disabled and its box read-only (still reachable, not disabled), so it can only be moved to Default bid or Exclude', async () => {
    render({ devices: [{ device: 'MOBILE', bidModifier: 1.25 }] });
    fixture.componentRef.setInput('deviceAdjustBlockedReason', 'Blocked under Target CPA.');
    fixture.detectChanges();

    expect(query('implementation-google-device-mode-MOBILE')?.querySelector('[data-testid="ui-select-value"]')?.textContent?.trim()).toBe('Adjust bid');
    const box = query<HTMLInputElement>('implementation-google-device-adjustment-MOBILE') as HTMLInputElement;
    expect(box.readOnly).toBe(true);
    expect(box.getAttribute('aria-readonly')).toBe('true');
    expect(box.disabled).toBe(false);
    expect(box.value).toBe('25');

    const trigger = query('implementation-google-device-mode-MOBILE')?.querySelector('[data-testid="ui-select-trigger"]') as HTMLElement;
    trigger.click();
    await settle();
    const adjust = Array.from(document.querySelectorAll('[data-testid="ui-option"]')).find((option) => option.textContent?.trim() === 'Adjust bid');
    expect(adjust?.getAttribute('aria-disabled')).toBe('true');
    trigger.click();
    await settle();

    await pick('implementation-google-device-mode-MOBILE', 'Default bid');
    expect(devices.at(-1)).toEqual([]);
  });

  it('shows only the sections it is asked for', () => {
    render({});
    fixture.componentRef.setInput('showDevices', false);
    fixture.detectChanges();

    expect(query('implementation-google-ad-schedule')).not.toBeNull();
    expect(query('implementation-google-devices')).toBeNull();
  });
});
