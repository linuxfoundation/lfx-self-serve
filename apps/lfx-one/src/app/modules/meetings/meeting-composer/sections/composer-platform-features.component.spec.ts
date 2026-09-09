// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  DEFAULT_EMAIL_REMINDER_HOURS,
  DEFAULT_EMAIL_REMINDER_MINUTES,
  MAX_EMAIL_REMINDER_HOURS,
  MIN_EMAIL_REMINDER_HOURS,
  RECORDING_DEPENDENCY_NOTES,
} from '@lfx-one/shared/constants';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingComposerFormService } from '../meeting-composer-form.service';
import { ComposerPlatformFeaturesComponent } from './composer-platform-features.component';

/**
 * Covers the two dependency chains this section owns: recording → transcripts/YouTube, and the email
 * reminder → hours/minutes. Both are enforced by `valueChanges` subscriptions rather than by validators,
 * so nothing else in the app catches them regressing — the controls would simply stay writable and reach
 * `prepareMeetingData()` with values upstream rejects.
 */
describe('ComposerPlatformFeaturesComponent', () => {
  let fixture: ComponentFixture<ComposerPlatformFeaturesComponent>;
  let component: ComposerPlatformFeaturesComponent;
  let formService: MeetingComposerFormService;

  const control = (name: string) => formService.form().get(name);

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
    TestBed.overrideComponent(ComposerPlatformFeaturesComponent, { set: { template: '', imports: [] } });

    formService = TestBed.inject(MeetingComposerFormService);
    formService.initialize({ mode: 'create', projectUid: 'project-1' });

    fixture = TestBed.createComponent(ComposerPlatformFeaturesComponent);
    fixture.componentRef.setInput('form', formService.form());
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  describe('recording dependency', () => {
    it('enables transcripts and YouTube upload when recording is turned on', () => {
      control('recording_enabled')?.setValue(true);

      expect(control('transcript_enabled')?.enabled).toBe(true);
      expect(control('youtube_upload_enabled')?.enabled).toBe(true);
    });

    it('clears and disables both dependants when recording is turned back off', () => {
      control('recording_enabled')?.setValue(true);
      control('transcript_enabled')?.setValue(true);
      control('youtube_upload_enabled')?.setValue(true);

      control('recording_enabled')?.setValue(false);

      // Disabling alone would leave the values in the payload — they have to be cleared as well.
      expect(control('transcript_enabled')?.value).toBe(false);
      expect(control('youtube_upload_enabled')?.value).toBe(false);
      expect(control('transcript_enabled')?.disabled).toBe(true);
      expect(control('youtube_upload_enabled')?.disabled).toBe(true);
    });

    it('explains why each dependant is off while recording is off', () => {
      expect(component['transcriptNote']()).toBe(RECORDING_DEPENDENCY_NOTES['transcript_enabled']);
      expect(component['youtubeNote']()).toBe(RECORDING_DEPENDENCY_NOTES['youtube_upload_enabled']);
    });

    it('drops both notes once recording is on', () => {
      // Primed first: the notes are computeds, so a version that failed to recompute could only be
      // caught from a cached value.
      expect(component['transcriptNote']()).not.toBeNull();

      control('recording_enabled')?.setValue(true);

      expect(component['transcriptNote']()).toBeNull();
      expect(component['youtubeNote']()).toBeNull();
    });
  });

  describe('email reminder timing', () => {
    it('resets and disables both timing controls when the reminder is turned off', () => {
      control('auto_email_reminder_enabled')?.setValue(true);
      control('reminderHours')?.setValue(MIN_EMAIL_REMINDER_HOURS);

      control('auto_email_reminder_enabled')?.setValue(false);

      expect(control('reminderHours')?.value).toBe(DEFAULT_EMAIL_REMINDER_HOURS);
      expect(control('reminderMinutes')?.value).toBe(DEFAULT_EMAIL_REMINDER_MINUTES);
      expect(control('reminderHours')?.disabled).toBe(true);
      expect(control('reminderMinutes')?.disabled).toBe(true);
    });

    it('enables the hours control when the reminder is turned on', () => {
      control('auto_email_reminder_enabled')?.setValue(true);

      expect(control('reminderHours')?.enabled).toBe(true);
    });

    it('locks minutes at zero while hours sits at the 24-hour maximum', () => {
      control('auto_email_reminder_enabled')?.setValue(true);

      control('reminderHours')?.setValue(MAX_EMAIL_REMINDER_HOURS);

      // 24h + any minutes would exceed the upstream maximum lead time.
      expect(control('reminderMinutes')?.value).toBe(DEFAULT_EMAIL_REMINDER_MINUTES);
      expect(control('reminderMinutes')?.disabled).toBe(true);
    });

    it('re-enables minutes when hours drops back below the maximum', () => {
      control('auto_email_reminder_enabled')?.setValue(true);
      control('reminderHours')?.setValue(MAX_EMAIL_REMINDER_HOURS);

      control('reminderHours')?.setValue(MAX_EMAIL_REMINDER_HOURS - 1);

      expect(control('reminderMinutes')?.enabled).toBe(true);
    });

    it('leaves minutes alone while the reminder itself is off', () => {
      // The hours subscription fires on the programmatic reset too; without the enabled check it would
      // re-enable a control the reminder toggle had just disabled.
      control('auto_email_reminder_enabled')?.setValue(true);
      control('auto_email_reminder_enabled')?.setValue(false);

      control('reminderHours')?.setValue(MIN_EMAIL_REMINDER_HOURS);

      expect(control('reminderMinutes')?.disabled).toBe(true);
    });
  });

  describe('platform chips', () => {
    it('lists unavailable platforms as disabled rather than hiding them', () => {
      const unavailable = component['platformChipOptions'].filter((option) => option.disabled);

      expect(unavailable.length).toBeGreaterThan(0);
      unavailable.forEach((option) => expect(option.label).toContain('(Coming Soon)'));
    });

    it('leaves the available platform label unannotated', () => {
      const available = component['platformChipOptions'].filter((option) => !option.disabled);

      expect(available.length).toBeGreaterThan(0);
      available.forEach((option) => expect(option.label).not.toContain('Coming Soon'));
    });
  });

  describe('validation surfacing', () => {
    it('stays silent on an untouched empty platform', () => {
      control('platform')?.setValue(null);

      expect(component['platformError']()).toBe(false);
    });

    it('reports the error once the control has been touched', () => {
      control('platform')?.setValue(null);
      control('platform')?.markAsTouched();
      // `markAsTouched()` bumps neither valueChanges nor statusChanges, so the recompute rides the
      // status change from the value write above.
      control('platform')?.updateValueAndValidity();

      expect(component['platformError']()).toBe(true);
    });

    it('tracks the title length for the YouTube counter', () => {
      control('title')?.setValue('Weekly sync');

      expect(component['titleLength']()).toBe('Weekly sync'.length);
    });
  });
});
