// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CampaignAdSchedule, CampaignDeviceBidModifier } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { CampaignGoogleTargetingPanelComponent } from './campaign-google-targeting-panel.component';

describe('CampaignGoogleTargetingPanelComponent', () => {
  let fixture: ComponentFixture<CampaignGoogleTargetingPanelComponent>;
  let schedules: CampaignAdSchedule[][];
  let devices: CampaignDeviceBidModifier[][];

  function query<T extends HTMLElement = HTMLElement>(testId: string): T | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  function change(testId: string, value: string): void {
    const control = query<HTMLInputElement | HTMLSelectElement>(testId) as HTMLInputElement | HTMLSelectElement;
    control.value = value;
    control.dispatchEvent(new Event('change'));
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
    schedules = [];
    devices = [];
    fixture.componentInstance.adSchedules.subscribe((list) => schedules.push(list));
    fixture.componentInstance.deviceBidModifiers.subscribe((list) => devices.push(list));
  });

  it('adds an all-day window on the first day without one', () => {
    render({ adSchedules: [{ dayOfWeek: 'MONDAY', startHour: 9, startMinute: 0, endHour: 17, endMinute: 0 }] });

    (query('implementation-google-ad-schedule-add')?.querySelector('button') as HTMLButtonElement).click();

    expect(schedules.at(-1)?.[1]).toEqual({ dayOfWeek: 'TUESDAY', startHour: 0, startMinute: 0, endHour: 24, endMinute: 0 });
  });

  it('writes the day, the times and a percentage adjustment as Google bid modifiers', () => {
    render({ adSchedules: [{ dayOfWeek: 'MONDAY', startHour: 0, startMinute: 0, endHour: 24, endMinute: 0 }] });

    change('implementation-google-ad-schedule-day-0', 'SATURDAY');
    expect(schedules.at(-1)?.[0].dayOfWeek).toBe('SATURDAY');

    fixture.componentRef.setInput('adSchedules', schedules.at(-1));
    change('implementation-google-ad-schedule-start-0', '570');
    expect(schedules.at(-1)?.[0]).toMatchObject({ startHour: 9, startMinute: 30 });

    fixture.componentRef.setInput('adSchedules', schedules.at(-1));
    change('implementation-google-ad-schedule-adjustment-0', '-50');
    expect(schedules.at(-1)?.[0].bidModifier).toBe(0.5);

    fixture.componentRef.setInput('adSchedules', schedules.at(-1));
    change('implementation-google-ad-schedule-adjustment-0', '');
    expect(schedules.at(-1)?.[0]).not.toHaveProperty('bidModifier');
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

    for (const id of ['day', 'start', 'end', 'adjustment']) {
      expect(fixture.nativeElement.querySelector(`label[for="google-ad-schedule-${id}-0"]`)).not.toBeNull();
    }
    expect(query('implementation-google-ad-schedule')?.getAttribute('aria-describedby')).toBe('google-ad-schedule-hint google-ad-schedule-error');
    expect(query('implementation-google-ad-schedule-error')?.textContent).toContain('overlaps');
    expect(query('implementation-google-targeting-live')?.textContent).toContain('overlaps');
  });

  it('turns each device choice into its modifier, in Google order, and drops a device set back to default', () => {
    render({});

    change('implementation-google-device-mode-TABLET', 'exclude');
    expect(devices.at(-1)).toEqual([{ device: 'TABLET', bidModifier: 0 }]);

    fixture.componentRef.setInput('deviceBidModifiers', devices.at(-1));
    change('implementation-google-device-mode-MOBILE', 'adjust');
    fixture.componentRef.setInput('deviceBidModifiers', devices.at(-1));
    fixture.detectChanges();
    change('implementation-google-device-adjustment-MOBILE', '25');
    expect(devices.at(-1)).toEqual([
      { device: 'MOBILE', bidModifier: 1.25 },
      { device: 'TABLET', bidModifier: 0 },
    ]);

    fixture.componentRef.setInput('deviceBidModifiers', devices.at(-1));
    change('implementation-google-device-mode-TABLET', 'default');
    expect(devices.at(-1)).toEqual([{ device: 'MOBILE', bidModifier: 1.25 }]);
  });

  it('shows only the sections it is asked for', () => {
    render({});
    fixture.componentRef.setInput('showDevices', false);
    fixture.detectChanges();

    expect(query('implementation-google-ad-schedule')).not.toBeNull();
    expect(query('implementation-google-devices')).toBeNull();
  });
});
