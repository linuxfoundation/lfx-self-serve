// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  EARLY_JOIN_CHIP_OPTIONS,
  MAX_CUSTOM_DURATION,
  MAX_EARLY_JOIN_TIME,
  MIN_CUSTOM_DURATION,
  MIN_EARLY_JOIN_TIME,
  WEEKDAY_CODES,
} from '@lfx-one/shared/constants';
import { RecurrenceType } from '@lfx-one/shared/enums';
import type { Meeting } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingComposerFormService } from '../meeting-composer-form.service';
import { ComposerDateScheduleComponent } from './composer-date-schedule.component';

/**
 * Covers the simple-cadence → `recurrence` mapping this section owns. The payload it writes is what
 * reaches Zoom, and two of its conversions are silent off-by-ones waiting to happen: `weekly_days` is
 * 1-7 upstream while `Date.getDay()` is 0-6, and the last occurrence of a weekday in a month is `-1`
 * rather than its week number. Neither is caught by a validator.
 */
describe('ComposerDateScheduleComponent', () => {
  let fixture: ComponentFixture<ComposerDateScheduleComponent>;
  let component: ComposerDateScheduleComponent;
  let formService: MeetingComposerFormService;

  // Thursday 8 January 2026 — the 2nd Thursday of a month with five of them, so `weekOfMonth` is a
  // plain 2 and `isLastWeek` is false. Its Thursday makes `getDay()` 4, so `weekly_days` must be '5'.
  const SECOND_THURSDAY = new Date(2026, 0, 8);
  // Thursday 29 January 2026 — the last Thursday of the same month.
  const LAST_THURSDAY = new Date(2026, 0, 29);

  const control = (name: string) => formService.form().get(name);
  const recurrence = () => formService.form().get('recurrence');

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        MeetingComposerFormService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: CommitteeService, useValue: {} },
        { provide: MeetingService, useValue: {} },
        { provide: ProjectContextService, useValue: { activeContextUid: () => null } },
      ],
    });
    TestBed.overrideComponent(ComposerDateScheduleComponent, { set: { template: '', imports: [] } });

    formService = TestBed.inject(MeetingComposerFormService);
    formService.initialize({ mode: 'create', projectUid: 'project-1' });

    fixture = TestBed.createComponent(ComposerDateScheduleComponent);
    fixture.componentRef.setInput('form', formService.form());
    component = fixture.componentInstance;
    // Explicit rather than relying on auto-detection: every subscription under test is wired in
    // `ngOnInit`, so nothing below works until first change detection has run.
    fixture.detectChanges();
    await fixture.whenStable();
  });

  describe('cadence options', () => {
    it('offers nothing while there is no start date to name a day from', () => {
      control('startDate')?.setValue(null);

      expect(component['cadenceOptions']()).toEqual([]);
    });

    it('names the weekly cadence after the start date day', () => {
      control('startDate')?.setValue(SECOND_THURSDAY);

      expect(component['cadenceOptions']().find((option) => option.value === 'weekly')?.label).toBe('Weekly on Thursday');
    });

    it('offers the nth-weekday cadence for a date mid-month', () => {
      control('startDate')?.setValue(SECOND_THURSDAY);

      const monthly = component['cadenceOptions']().find((option) => option.value.startsWith('monthly'));

      expect(monthly).toEqual({ label: 'Monthly on the 2nd Thursday', value: 'monthly_nth' });
    });

    it('swaps to the last-weekday cadence for the final occurrence in the month', () => {
      control('startDate')?.setValue(LAST_THURSDAY);

      const monthly = component['cadenceOptions']().find((option) => option.value.startsWith('monthly'));

      expect(monthly).toEqual({ label: 'Monthly on the last Thursday', value: 'monthly_last' });
    });
  });

  describe('recurring toggle', () => {
    it('starts a recurring meeting on the weekly cadence', () => {
      control('isRecurring')?.setValue(true);

      expect(control('recurrenceType')?.value).toBe('weekly');
    });

    it('keeps a cadence that is already set when recurrence is switched on', () => {
      // Edit mode hydrates the cadence before the toggle settles, so defaulting unconditionally to
      // weekly would overwrite a saved daily or monthly meeting on open.
      control('recurrenceType')?.setValue('daily');

      control('isRecurring')?.setValue(true);

      expect(control('recurrenceType')?.value).toBe('daily');
    });

    it('clears the cadence when recurrence is turned off', () => {
      control('isRecurring')?.setValue(true);

      control('isRecurring')?.setValue(false);

      expect(control('recurrenceType')?.value).toBe('none');
    });

    it('reveals the custom pattern editor only for the custom cadence', () => {
      control('recurrenceType')?.setValue('custom');
      expect(component['showCustomRecurrence']()).toBe(true);

      control('recurrenceType')?.setValue('weekly');
      expect(component['showCustomRecurrence']()).toBe(false);
    });
  });

  describe('recurrence payload', () => {
    beforeEach(() => {
      control('startDate')?.setValue(SECOND_THURSDAY);
    });

    it('maps daily to a one-day interval with no day selection', () => {
      control('recurrenceType')?.setValue('daily');

      expect(recurrence()?.value).toMatchObject({ type: RecurrenceType.DAILY, repeat_interval: 1, weekly_days: null });
    });

    it('maps weekly to the start date day in upstream 1-7 numbering', () => {
      control('recurrenceType')?.setValue('weekly');

      // Thursday is `getDay()` 4 but weekday 5 upstream.
      expect(recurrence()?.value).toMatchObject({ type: RecurrenceType.WEEKLY, repeat_interval: 1, weekly_days: '5' });
    });

    it('maps every-weekday to the Monday-to-Friday code list', () => {
      control('recurrenceType')?.setValue('weekdays');

      expect(recurrence()?.value).toMatchObject({ type: RecurrenceType.WEEKLY, repeat_interval: 1, weekly_days: WEEKDAY_CODES });
    });

    it('maps a mid-month monthly cadence to its week number', () => {
      control('recurrenceType')?.setValue('monthly_nth');

      expect(recurrence()?.value).toMatchObject({ type: RecurrenceType.MONTHLY, repeat_interval: 1, monthly_week: 2, monthly_week_day: 5 });
    });

    it('maps a last-occurrence monthly cadence to -1 rather than its week number', () => {
      control('startDate')?.setValue(LAST_THURSDAY);

      control('recurrenceType')?.setValue('monthly_last');

      expect(recurrence()?.value).toMatchObject({ type: RecurrenceType.MONTHLY, monthly_week: -1, monthly_week_day: 5 });
    });

    it('clears the previous cadence fields when the cadence changes', () => {
      control('recurrenceType')?.setValue('monthly_nth');

      control('recurrenceType')?.setValue('daily');

      // Leftover monthly fields would ride along in the payload and contradict the daily type.
      expect(recurrence()?.value).toMatchObject({ monthly_week: null, monthly_week_day: null });
    });

    it('leaves the cleared group alone for a non-recurring meeting', () => {
      control('recurrenceType')?.setValue('weekly');

      control('recurrenceType')?.setValue('none');

      expect(recurrence()?.value).toMatchObject({ type: null, weekly_days: null });
    });
  });

  /**
   * Covers the retained chip for a stored early-join value the four presets do not cover.
   * @description The control accepts every minute in [MIN_EARLY_JOIN_TIME, MAX_EARLY_JOIN_TIME]
   * and the API has always stored whatever it was given, so meetings saved with 20 or 45 predate
   * the chips. Without a chip the group renders unselected over a populated control and the only
   * way to touch the field is to overwrite the stored value.
   */
  describe('early-join options', () => {
    const options = (): { label: string; value: number }[] => component['earlyJoinOptions']();
    const stored = (minutes: number | undefined): void => formService.meeting.set({ early_join_time_minutes: minutes } as Meeting);

    it('offers just the presets when no meeting is loaded', () => {
      expect(options()).toEqual(EARLY_JOIN_CHIP_OPTIONS);
    });

    it('offers just the presets when the stored value is already one of them', () => {
      stored(EARLY_JOIN_CHIP_OPTIONS[1].value);

      expect(options()).toEqual(EARLY_JOIN_CHIP_OPTIONS);
    });

    it('retains a stored value the presets do not cover', () => {
      stored(45);

      expect(options().map((option) => option.value)).toContain(45);
      expect(options().find((option) => option.value === 45)?.label).toBe('45 min');
    });

    it('sorts the retained chip in among the presets rather than after them', () => {
      stored(45);

      expect(options().map((option) => option.value)).toEqual([10, 15, 30, 45, 60]);
    });

    it('keeps the retained chip on offer after the organizer picks a preset', () => {
      // The options are read from the loaded meeting, not from the control, so switching away
      // and back does not strand the original value.
      stored(20);
      control('early_join_time_minutes')?.setValue(EARLY_JOIN_CHIP_OPTIONS[0].value);

      expect(options().map((option) => option.value)).toContain(20);
    });

    it('offers no chip for a stored value outside the accepted range', () => {
      // A chip for it would offer a choice that cannot be submitted; the min/max messages under
      // the group already own that failure.
      stored(MAX_EARLY_JOIN_TIME + 5);
      expect(options()).toEqual(EARLY_JOIN_CHIP_OPTIONS);

      stored(MIN_EARLY_JOIN_TIME - 5);
      expect(options()).toEqual(EARLY_JOIN_CHIP_OPTIONS);
    });

    it('offers just the presets when the stored meeting has no early-join value', () => {
      stored(undefined);

      expect(options()).toEqual(EARLY_JOIN_CHIP_OPTIONS);
    });
  });

  describe('start date changes after a cadence is chosen', () => {
    it('re-derives the weekly day when the meeting moves to another weekday', () => {
      control('startDate')?.setValue(SECOND_THURSDAY);
      control('recurrenceType')?.setValue('weekly');

      // Friday 9 January 2026 — `getDay()` 5, so weekday 6 upstream.
      control('startDate')?.setValue(new Date(2026, 0, 9));

      expect(recurrence()?.get('weekly_days')?.value).toBe('6');
    });

    it('flips a monthly cadence to last-occurrence when the new date is the last one', () => {
      control('startDate')?.setValue(SECOND_THURSDAY);
      control('recurrenceType')?.setValue('monthly_nth');

      control('startDate')?.setValue(LAST_THURSDAY);

      expect(control('recurrenceType')?.value).toBe('monthly_last');
      expect(recurrence()?.get('monthly_week')?.value).toBe(-1);
    });

    it('leaves the cadence alone when the date is cleared', () => {
      control('startDate')?.setValue(SECOND_THURSDAY);
      control('recurrenceType')?.setValue('weekly');

      control('startDate')?.setValue(null);

      // Clearing the calendar input emits null; the day-derived payload has nothing to re-derive from
      // and must not be blanked out under the organizer.
      expect(recurrence()?.get('weekly_days')?.value).toBe('5');
    });
  });
});

/**
 * Covers the custom-duration input's `aria-describedby` and `aria-invalid`, read off the rendered DOM.
 * @description The chip group is labelled and the adjacent "minutes" is a unit, so this input's whole
 * accessible story — its name, its validity, and which of three messages applies — is carried by
 * attributes. All three error paragraphs are gated on `touched`, which `markAsTouched()` publishes on
 * neither `valueChanges` nor `statusChanges`; the template is rendered here rather than stubbed so a
 * gate that went stale on blur would show up as an attribute naming a paragraph that is not there.
 */
describe('ComposerDateScheduleComponent — custom duration description ids', () => {
  let fixture: ComponentFixture<ComposerDateScheduleComponent>;
  let formService: MeetingComposerFormService;

  const durationInput = (): HTMLInputElement => fixture.nativeElement.querySelector('#composer-custom-duration') as HTMLInputElement;

  /** The attribute a screen reader would find, with every id it names resolved against the page. */
  const describedBy = (): string | null => {
    fixture.detectChanges();
    const value = durationInput().getAttribute('aria-describedby');

    for (const id of value?.split(' ') ?? []) {
      expect(fixture.nativeElement.querySelector(`#${id}`), `aria-describedby names "${id}", which is not on the page`).not.toBeNull();
    }

    return value;
  };

  const ariaInvalid = (): string | null => {
    fixture.detectChanges();
    return durationInput().getAttribute('aria-invalid');
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        MeetingComposerFormService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: CommitteeService, useValue: {} },
        { provide: MeetingService, useValue: {} },
        { provide: ProjectContextService, useValue: { activeContextUid: () => null } },
      ],
    });

    formService = TestBed.inject(MeetingComposerFormService);
    formService.initialize({ mode: 'create', projectUid: 'project-1' });

    fixture = TestBed.createComponent(ComposerDateScheduleComponent);
    fixture.componentRef.setInput('form', formService.form());
    fixture.detectChanges();
    await fixture.whenStable();

    // The whole block is behind the custom chip; picking it is also what attaches the validators.
    formService.form().get('duration')?.setValue('custom');
    fixture.detectChanges();
  });

  it('carries the id a `<label for>` can target, on the real input rather than the wrapper host', () => {
    // `inputId`, not `id`: a static `id` on the component would also stay on the `lfx-input-number`
    // host, and `for` resolves to that first — a label pointing at an element nothing can focus.
    expect(durationInput().tagName).toBe('INPUT');
    expect(fixture.nativeElement.querySelector('label[for="composer-custom-duration"]')).not.toBeNull();
  });

  it('says nothing while the field is untouched', () => {
    expect(describedBy()).toBeNull();
    expect(ariaInvalid()).toBeNull();
  });

  it('names the required error once the empty field is blurred', () => {
    expect(describedBy()).toBeNull();

    formService.form().get('customDuration')?.markAsTouched();

    expect(describedBy()).toBe('composer-custom-duration-required-error');
    expect(ariaInvalid()).toBe('true');
  });

  it('names the min error for a duration under the floor', () => {
    const control = formService.form().get('customDuration');
    control?.setValue(MIN_CUSTOM_DURATION - 1);
    control?.markAsTouched();

    expect(describedBy()).toBe('composer-custom-duration-min-error');
    expect(ariaInvalid()).toBe('true');
  });

  it('names the max error for a duration over the ceiling', () => {
    const control = formService.form().get('customDuration');
    control?.setValue(MAX_CUSTOM_DURATION + 1);
    control?.markAsTouched();

    expect(describedBy()).toBe('composer-custom-duration-max-error');
    expect(ariaInvalid()).toBe('true');
  });

  it('drops both once the duration is in range', () => {
    const control = formService.form().get('customDuration');
    control?.markAsTouched();
    expect(describedBy()).toBe('composer-custom-duration-required-error');

    control?.setValue(MIN_CUSTOM_DURATION + 5);

    expect(describedBy()).toBeNull();
    expect(ariaInvalid()).toBeNull();
  });
});
