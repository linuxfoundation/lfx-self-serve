// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Meeting, MeetingOccurrence } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AddToCalendarComponent } from './add-to-calendar.component';

/**
 * Template is stubbed: the subject is scope-form-driven URL construction and the Google/Outlook
 * menu items, not the PrimeNG radio-button/menu markup, which is covered by the wrapper components
 * themselves.
 */
describe('AddToCalendarComponent', () => {
  let fixture: ComponentFixture<AddToCalendarComponent>;
  let component: AddToCalendarComponent;
  let getMeetingCalendarIcsUrl: ReturnType<typeof vi.fn>;
  let windowOpen: ReturnType<typeof vi.fn>;

  const MEETING: Meeting = {
    id: 'meeting-1',
    title: 'Weekly Sync',
    start_time: '2026-01-15T14:00:00Z',
    duration: 30,
    description: 'Discuss roadmap',
  } as Meeting;

  const OCCURRENCE: MeetingOccurrence = {
    occurrence_id: 'occ-1',
    title: 'Weekly Sync',
    start_time: '2026-01-22T14:00:00Z',
    duration: 30,
  } as MeetingOccurrence;

  beforeEach(() => {
    getMeetingCalendarIcsUrl = vi.fn(() => '/api/meetings/meeting-1/calendar.ics?scope=occurrence');
    windowOpen = vi.fn();
    vi.stubGlobal('open', windowOpen);

    TestBed.configureTestingModule({
      providers: [{ provide: MeetingService, useValue: { getMeetingCalendarIcsUrl } }],
    });
    TestBed.overrideComponent(AddToCalendarComponent, { set: { template: '', imports: [] } });

    fixture = TestBed.createComponent(AddToCalendarComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('meeting', MEETING);
  });

  function downloadIcsItem(): { command: () => void } {
    return component.menuItems().find((item) => item.label === 'Download .ics') as { command: () => void };
  }

  function googleItem(): { command: () => void; disabled?: boolean } {
    return component.menuItems().find((item) => item.label === 'Google Calendar') as { command: () => void; disabled?: boolean };
  }

  it('is not recurring and sends no occurrenceId for a non-recurring meeting', () => {
    fixture.detectChanges();

    expect(component.isRecurring()).toBe(false);

    downloadIcsItem().command();

    expect(getMeetingCalendarIcsUrl).toHaveBeenCalledWith('meeting-1', { scope: 'occurrence', occurrenceId: undefined });
    expect(windowOpen).toHaveBeenCalledWith('/api/meetings/meeting-1/calendar.ics?scope=occurrence', '_blank', 'noopener,noreferrer');
  });

  it('sends the current occurrence id for a recurring meeting', () => {
    fixture.componentRef.setInput('meeting', { ...MEETING, recurrence: { type: 1 } });
    fixture.componentRef.setInput('currentOccurrence', OCCURRENCE);
    fixture.detectChanges();

    expect(component.isRecurring()).toBe(true);

    downloadIcsItem().command();

    expect(getMeetingCalendarIcsUrl).toHaveBeenCalledWith('meeting-1', { scope: 'occurrence', occurrenceId: 'occ-1' });
  });

  it('sends scope=series once the series radio is selected', () => {
    fixture.componentRef.setInput('meeting', { ...MEETING, recurrence: { type: 1 } });
    fixture.componentRef.setInput('currentOccurrence', OCCURRENCE);
    fixture.detectChanges();

    component.scopeForm.get('scope')?.setValue('series');
    downloadIcsItem().command();

    expect(getMeetingCalendarIcsUrl).toHaveBeenCalledWith('meeting-1', expect.objectContaining({ scope: 'series' }));
  });

  it('disables the Google Calendar and Outlook items once the series scope is selected', () => {
    fixture.componentRef.setInput('meeting', { ...MEETING, recurrence: { type: 1 } });
    fixture.detectChanges();

    expect(googleItem().disabled).toBe(false);

    component.scopeForm.get('scope')?.setValue('series');

    expect(googleItem().disabled).toBe(true);
  });

  it('opens a Google Calendar deep link with no password in the meeting page URL', () => {
    fixture.detectChanges();

    googleItem().command();

    expect(windowOpen).toHaveBeenCalledTimes(1);
    const [url] = windowOpen.mock.calls[0];
    expect(url).toContain('calendar.google.com');
    const details = new URL(url).searchParams.get('details') ?? '';
    expect(details).toContain('/meetings/meeting-1');
    expect(details).not.toContain('password');
  });

  it('preserves the selected occurrence in the Google Calendar join link for a recurring meeting (GH-3505)', () => {
    const upcomingOccurrence: MeetingOccurrence = { ...OCCURRENCE, start_time: '2099-01-22T14:00:00Z' };
    fixture.componentRef.setInput('meeting', { ...MEETING, recurrence: { type: 1 } });
    fixture.componentRef.setInput('currentOccurrence', upcomingOccurrence);
    fixture.detectChanges();

    googleItem().command();

    const [url] = windowOpen.mock.calls[0];
    const details = new URL(url).searchParams.get('details') ?? '';
    expect(details).toContain('/meetings/meeting-1');
    expect(details).toContain(`occurrence=${new Date(upcomingOccurrence.start_time).getTime()}`);
    expect(details).not.toContain('password');
  });
});
