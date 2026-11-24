// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RecurrenceType } from '@lfx-one/shared/enums';
import { Meeting, MeetingEditScopeDialogData, MeetingOccurrence } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingEditScopeModalComponent } from './meeting-edit-scope-modal.component';

const FIRST = { occurrence_id: '2524640400', start_time: '2050-01-01T09:00:00.000Z', duration: 30 } as MeetingOccurrence;
const SECOND = { occurrence_id: '2525245200', start_time: '2050-01-08T09:00:00.000Z', duration: 30 } as MeetingOccurrence;
const MEETING = {
  id: 'synthetic-meeting',
  title: 'Synthetic sync',
  project_name: 'Synthetic Project',
  meeting_type: 'Technical',
  timezone: 'UTC',
  recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1 },
  occurrences: [FIRST, SECOND],
} as unknown as Meeting;

function buildData(meeting: Meeting, occurrence: MeetingOccurrence): MeetingEditScopeDialogData {
  return {
    row: {
      key: 'row',
      meeting,
      occurrence,
      title: meeting.title,
      occurrenceId: occurrence.occurrence_id,
      startTime: occurrence.start_time,
      durationMinutes: 30,
    },
    meeting,
    occurrence,
  };
}

describe('MeetingEditScopeModalComponent', () => {
  let close: ReturnType<typeof vi.fn>;

  const render = async (data: MeetingEditScopeDialogData): Promise<ComponentFixture<MeetingEditScopeModalComponent>> => {
    close = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: DIALOG_DATA, useValue: data },
        { provide: DialogRef, useValue: { id: 'synthetic-dialog', close } },
      ],
    });
    const fixture = TestBed.createComponent(MeetingEditScopeModalComponent);
    await fixture.whenStable();
    return fixture;
  };
  const query = (fixture: ComponentFixture<MeetingEditScopeModalComponent>, testId: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const radio = (fixture: ComponentFixture<MeetingEditScopeModalComponent>, scope: string): HTMLInputElement =>
    query(fixture, `meetings-home-edit-scope-${scope}`)?.querySelector('input') as HTMLInputElement;
  const button = (fixture: ComponentFixture<MeetingEditScopeModalComponent>, testId: string): HTMLButtonElement =>
    query(fixture, testId)?.querySelector('button') as HTMLButtonElement;

  beforeEach(() => TestBed.resetTestingModule());

  it('opens on a single occurrence with the clicked date picked', async () => {
    const fixture = await render(buildData(MEETING, SECOND));

    expect(radio(fixture, 'occurrence').checked).toBe(true);
    expect(query(fixture, 'meetings-home-edit-scope-occurrence-select')).not.toBeNull();
    expect(query(fixture, 'meetings-home-edit-scope-info')?.textContent).toContain('Synthetic Project');
    button(fixture, 'meetings-home-edit-scope-continue').click();

    expect(close).toHaveBeenCalledWith({ scope: 'occurrence', proceed: true, occurrenceId: SECOND.occurrence_id });
  });

  it('closes with the series and hides the picker once the entire series is chosen', async () => {
    const fixture = await render(buildData(MEETING, SECOND));

    radio(fixture, 'series').click();
    await fixture.whenStable();
    expect(query(fixture, 'meetings-home-edit-scope-occurrence-select')).toBeNull();
    button(fixture, 'meetings-home-edit-scope-continue').click();

    expect(close).toHaveBeenCalledWith({ scope: 'series', proceed: true });
  });

  it('picks an option from a click on its description', async () => {
    const fixture = await render(buildData(MEETING, SECOND));

    query(fixture, 'meetings-home-edit-scope-series-description')?.click();
    await fixture.whenStable();

    expect(radio(fixture, 'series').checked).toBe(true);
    button(fixture, 'meetings-home-edit-scope-continue').click();
    expect(close).toHaveBeenCalledWith({ scope: 'series', proceed: true });
  });

  it('closes with nothing on Cancel', async () => {
    const fixture = await render(buildData(MEETING, FIRST));

    button(fixture, 'meetings-home-edit-scope-cancel').click();

    expect(close).toHaveBeenCalledWith();
  });
});
