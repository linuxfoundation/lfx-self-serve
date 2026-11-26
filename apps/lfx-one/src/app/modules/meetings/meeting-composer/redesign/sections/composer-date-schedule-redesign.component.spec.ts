// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MEETING_START_TIME_SLOTS } from '@lfx-one/shared/constants';
import { getCurrentTimeInTimezone } from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { SearchService } from '@services/search.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingRecurrencePatternComponent } from '../../../components/meeting-recurrence-pattern/meeting-recurrence-pattern.component';
import { MeetingComposerFormService } from '../../meeting-composer-form.service';
import { ComposerDateScheduleRedesignComponent } from './composer-date-schedule-redesign.component';

/** Same class without its template, for the computed-signal and form-write tests. */
@Component({ selector: 'lfx-state-only-date-schedule', template: '' })
class StateOnlyDateScheduleComponent extends ComposerDateScheduleRedesignComponent {}

describe('ComposerDateScheduleRedesignComponent', () => {
  let fixture: ComponentFixture<ComposerDateScheduleRedesignComponent>;
  let formService: MeetingComposerFormService;

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  function slots(): { label: string; value: string }[] {
    return fixture.componentInstance['timeSlots']();
  }

  function futureDate(): Date {
    const date = new Date();
    date.setDate(date.getDate() + 7);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        MeetingComposerFormService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: CommitteeService, useValue: {} },
        { provide: MeetingService, useValue: {} },
        { provide: SearchService, useValue: { searchUsers: () => of([]) } },
        { provide: ProjectContextService, useValue: { activeContextUid: () => null } },
        { provide: PersonaService, useValue: { currentPersona: () => null } },
      ],
    });

    formService = TestBed.inject(MeetingComposerFormService);
    formService.initialize({ mode: 'create' });
  });

  async function render(stateOnly = false): Promise<void> {
    fixture = TestBed.createComponent(stateOnly ? StateOnlyDateScheduleComponent : ComposerDateScheduleRedesignComponent);
    fixture.componentRef.setInput('form', formService.form());
    await fixture.whenStable();
    fixture.detectChanges();
  }

  describe('start time', () => {
    it('offers every 15-minute slot for a future date', async () => {
      await render(true);
      formService.form().get('startDate')?.setValue(futureDate());
      fixture.detectChanges();

      expect(slots()).toHaveLength(96);
      expect(slots()[0].label).toBe('12:00 AM');
      expect(slots()[37].label).toBe('9:15 AM');
      expect(slots()[95].label).toBe('11:45 PM');
    });

    it('starts at the next whole hour when the date is today', async () => {
      await render(true);
      formService.form().get('timezone')?.setValue('Asia/Tokyo');
      const now = getCurrentTimeInTimezone('Asia/Tokyo');
      formService.form().get('startDate')?.setValue(now);
      fixture.detectChanges();

      const firstMinute = (now.getHours() + 1) * 60;
      const upcoming = MEETING_START_TIME_SLOTS.filter((slot) => slot.minuteOfDay >= firstMinute).length;
      // After 11 PM in Tokyo nothing is left, so every slot is listed.
      expect(slots()).toHaveLength(upcoming || MEETING_START_TIME_SLOTS.length);
    });

    it('lists every slot late in the day, even with a time stored', async () => {
      await render(true);
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(new Date(2030, 9, 8, 23, 30));
        formService.form().get('timezone')?.setValue('');
        formService
          .form()
          .get('startDate')
          ?.setValue(new Date(2030, 9, 8));
        formService.form().get('startTime')?.setValue('11:30 PM');

        expect(slots()).toHaveLength(96);
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps a stored off-grid time selectable, in order', async () => {
      await render(true);
      formService.form().get('startDate')?.setValue(futureDate());
      formService.form().get('startTime')?.setValue('09:10 AM');
      fixture.detectChanges();

      const labels = slots().map((slot) => slot.label);
      expect(labels.indexOf('09:10 AM')).toBe(labels.indexOf('9:00 AM') + 1);
    });

    it('matches a stored padded time to its grid row', async () => {
      await render(true);
      formService.form().get('startDate')?.setValue(futureDate());
      formService.form().get('startTime')?.setValue('09:30 AM');
      fixture.detectChanges();

      expect(slots()).toHaveLength(96);
      expect(slots().find((slot) => slot.label === '9:30 AM')?.value).toBe('09:30 AM');
    });
  });

  describe('date', () => {
    it('shows the picked date on the trigger and marks it dirty', async () => {
      await render();
      const close = vi.fn();
      fixture.componentInstance['pickStartDate'](new Date(2030, 9, 8), close);
      fixture.detectChanges();

      expect(query('composer-start-date-value')?.textContent?.trim()).toBe('Tue, Oct 8, 2030');
      expect(formService.form().get('startDate')?.dirty).toBe(true);
      expect(close).toHaveBeenCalled();
    });

    it('disables days before the minimum date', async () => {
      await render(true);
      const isDisabled = fixture.componentInstance['isDateDisabled']();
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 2);

      expect(isDisabled(yesterday)).toBe(true);
      expect(isDisabled(futureDate())).toBe(false);
    });
  });

  describe('duration', () => {
    it('writes numbers back and reveals the custom minutes field', async () => {
      await render();
      fixture.componentInstance['setDuration']('30');
      fixture.detectChanges();
      expect(formService.form().get('duration')?.value).toBe(30);
      expect(query('composer-custom-duration')).toBeNull();

      fixture.componentInstance['setDuration']('custom');
      fixture.detectChanges();
      expect(query('composer-custom-duration')).not.toBeNull();

      fixture.componentInstance['setCustomDuration']('700');
      fixture.detectChanges();
      expect(formService.form().get('customDuration')?.value).toBe(700);
      expect(query('composer-custom-duration-error')?.textContent).toContain('Enter a duration between 5 and 600 minutes');
    });

    it('writes the early-join choice back as minutes', async () => {
      await render(true);
      fixture.componentInstance['setEarlyJoin']('30');
      expect(formService.form().get('early_join_time_minutes')?.value).toBe(30);
    });
  });

  describe('series fields', () => {
    it('shows the recurring card only once a date is picked, and the cadence once it is on', async () => {
      await render();
      expect(query('composer-recurring-card')).toBeNull();

      formService.form().get('startDate')?.setValue(futureDate());
      fixture.detectChanges();
      expect(query('composer-recurring-card')).not.toBeNull();
      expect(query('composer-cadence-select')).toBeNull();

      formService.form().get('isRecurring')?.setValue(true);
      fixture.detectChanges();
      expect(query('composer-cadence-select')).not.toBeNull();
      expect(formService.form().get('recurrenceType')?.value).toBe('weekly');
    });

    it('keeps the custom recurrence editor and renders its panels inside the modal', async () => {
      await render();
      formService.form().get('startDate')?.setValue(futureDate());
      formService.form().get('isRecurring')?.setValue(true);
      formService.form().get('recurrenceType')?.setValue('custom');
      fixture.detectChanges();

      const pattern = fixture.debugElement.query(By.directive(MeetingRecurrencePatternComponent));
      expect(pattern).not.toBeNull();
      expect((pattern.componentInstance as MeetingRecurrencePatternComponent).appendTo()).toBe('self');
    });

    it('swaps the timezone and recurrence for the series timezone line in an occurrence edit', async () => {
      await render();
      formService.form().get('startDate')?.setValue(futureDate());
      fixture.componentRef.setInput('showSeriesSchedule', false);
      fixture.componentRef.setInput('showEarlyJoin', false);
      fixture.detectChanges();

      expect(query('composer-timezone-select')).toBeNull();
      expect(query('composer-early-join-chips')).toBeNull();
      expect(query('composer-recurring-card')).toBeNull();
      expect(query('composer-series-timezone')).not.toBeNull();
    });
  });
});
