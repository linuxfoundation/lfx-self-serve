// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { beforeEach, describe, expect, it } from 'vitest';

import { MeetingRecurrencePatternComponent } from './meeting-recurrence-pattern.component';

/** A Wednesday, so the derived weekday is 4 (0-6 mapped to 1-7) and the week of the month is the 3rd. */
const WEDNESDAY = new Date(2026, 8, 16);

/**
 * The parent form this panel reads, in the shape both hosts build it.
 * @description `MeetingComposerFormService.createMeetingFormGroup` seeds `startDate: null` and
 * `recurrence.type: null` on a new meeting; the pre-v2 wizard seeds a real date. `startDate` is the
 * only difference between the two, so one factory covers both by taking it as an argument.
 */
function buildForm(startDate: Date | null): FormGroup {
  return new FormGroup({
    startDate: new FormControl<Date | null>(startDate),
    patternTypeUI: new FormControl('weekly'),
    recurrence: new FormGroup({
      type: new FormControl(null),
      repeat_interval: new FormControl(1),
      weekly_days: new FormControl(null),
      monthly_day: new FormControl(null),
      monthly_week: new FormControl(null),
      monthly_week_day: new FormControl(null),
      end_date_time: new FormControl(null),
      end_times: new FormControl(null),
      monthlyTypeUI: new FormControl('dayOfMonth'),
      endTypeUI: new FormControl('never'),
    }),
  });
}

/**
 * Covers the panel's start-date dependency on both sides of `MEETING_V2_ENABLED_FLAG`.
 * @description Every pattern default here is derived from the start date's weekday or week of month.
 * The composer stopped seeding a start date, so choosing Custom recurrence before picking a date used
 * to take `getDay()` on `null` and blank out Date & Schedule. The pre-v2 wizard always seeds a date,
 * so the flag-off cases below assert the old behaviour is untouched, not merely that it survives.
 */
describe('MeetingRecurrencePatternComponent — start date not yet picked', () => {
  /** Mounts the panel over `form` with an empty template: this suite exercises the defaults, not the markup. */
  async function mount(startDate: Date | null): Promise<{ component: MeetingRecurrencePatternComponent; form: FormGroup }> {
    const form = buildForm(startDate);

    TestBed.overrideComponent(MeetingRecurrencePatternComponent, { set: { template: '', imports: [] } });
    await TestBed.compileComponents();

    const fixture = TestBed.createComponent(MeetingRecurrencePatternComponent);
    fixture.componentRef.setInput('form', form);
    fixture.detectChanges();

    return { component: fixture.componentInstance, form };
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('mounts on a meeting with no start date instead of throwing on the weekly default', async () => {
    const { form } = await mount(null);

    // The crash was here: the weekly default is the start date's weekday, and there is no date yet.
    expect(form.get('recurrence')?.value).toMatchObject({ type: 2, repeat_interval: 1, weekly_days: null });
  });

  it('seeds the weekly day from the start date once the organizer picks one', async () => {
    const { form } = await mount(null);

    form.get('startDate')?.setValue(WEDNESDAY);

    // Deferring the default is only safe because it lands here — otherwise the day chips would stay
    // empty for the rest of the session and the pattern would go out with no day at all.
    expect(form.get('recurrence.weekly_days')?.value).toBe('4');
  });

  it('leaves a multi-day weekly selection alone when the start date arrives', async () => {
    const { form } = await mount(null);
    form.get('recurrence.weekly_days')?.setValue('2,4,6');

    form.get('startDate')?.setValue(WEDNESDAY);

    expect(form.get('recurrence.weekly_days')?.value).toBe('2,4,6');
  });

  it('defers the monthly day rather than reading it off a missing start date', async () => {
    const { form } = await mount(null);

    form.get('patternTypeUI')?.setValue('monthly');

    expect(form.get('recurrence')?.value).toMatchObject({ type: 3, monthly_day: null });
  });

  it('defers the monthly week and weekday for a day-of-week pattern with no start date', async () => {
    const { form } = await mount(null);

    form.get('recurrence.monthlyTypeUI')?.setValue('dayOfWeek');

    expect(form.get('recurrence')?.value).toMatchObject({ monthly_day: null, monthly_week: null, monthly_week_day: null });
  });
});

describe('MeetingRecurrencePatternComponent — start date already seeded', () => {
  async function mount(): Promise<FormGroup> {
    const form = buildForm(WEDNESDAY);

    TestBed.overrideComponent(MeetingRecurrencePatternComponent, { set: { template: '', imports: [] } });
    await TestBed.compileComponents();

    const fixture = TestBed.createComponent(MeetingRecurrencePatternComponent);
    fixture.componentRef.setInput('form', form);
    fixture.detectChanges();

    return form;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('still defaults weekly to the start date weekday on mount', async () => {
    const form = await mount();

    expect(form.get('recurrence')?.value).toMatchObject({ type: 2, repeat_interval: 1, weekly_days: '4' });
  });

  it('still derives the monthly day from the start date', async () => {
    const form = await mount();

    form.get('patternTypeUI')?.setValue('monthly');

    expect(form.get('recurrence')?.value).toMatchObject({ type: 3, monthly_day: 16 });
  });

  it('still derives the monthly week and weekday for a day-of-week pattern', async () => {
    const form = await mount();

    form.get('recurrence.monthlyTypeUI')?.setValue('dayOfWeek');

    // 16 September 2026 is the third Wednesday of the month.
    expect(form.get('recurrence')?.value).toMatchObject({ monthly_day: null, monthly_week: 3, monthly_week_day: 4 });
  });
});
