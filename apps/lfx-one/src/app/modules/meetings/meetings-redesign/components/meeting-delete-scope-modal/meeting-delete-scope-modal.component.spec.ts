// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RecurrenceType } from '@lfx-one/shared/enums';
import { Meeting, MeetingDeleteDialogData, MeetingOccurrence } from '@lfx-one/shared/interfaces';
import { formatMeetingWhenFull } from '@lfx-one/shared/utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingDeleteScopeModalComponent } from './meeting-delete-scope-modal.component';

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

const buildData = (meeting: Meeting, occurrence: MeetingOccurrence | null): MeetingDeleteDialogData => {
  const { occurrence_id = null, start_time = FIRST.start_time } = occurrence ?? {};
  return {
    row: { key: 'row', meeting, occurrence, title: meeting.title, occurrenceId: occurrence_id, startTime: start_time, durationMinutes: 30 },
    occurrence,
  };
};

describe('MeetingDeleteScopeModalComponent', () => {
  let close: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<MeetingDeleteScopeModalComponent>;

  const render = async (data: MeetingDeleteDialogData): Promise<void> => {
    close = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: DIALOG_DATA, useValue: data },
        { provide: DialogRef, useValue: { id: 'synthetic-dialog', close } },
      ],
    });
    fixture = TestBed.createComponent(MeetingDeleteScopeModalComponent);
    await fixture.whenStable();
  };
  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const radio = (scope: string): HTMLInputElement => query(`meetings-home-delete-scope-${scope}`)?.querySelector('input') as HTMLInputElement;
  const button = (testId: string): HTMLButtonElement => query(testId)?.querySelector('button') as HTMLButtonElement;

  beforeEach(() => TestBed.resetTestingModule());

  it("opens on cancelling the row's date and closes with it", async () => {
    const data = buildData(MEETING, SECOND);
    await render(data);

    expect(radio('occurrence').checked).toBe(true);
    expect(query('meetings-home-delete-scope-info')?.textContent).toContain('Synthetic Project');
    expect(query('meeting-dialog-context-when')?.textContent?.trim()).toBe(formatMeetingWhenFull(data.row));
    expect(query('meetings-home-delete-scope-note')?.textContent).toContain('applies to all registrants of this meeting');
    expect(query('meetings-home-delete-scope-note')?.className).toContain('text-ui-danger-700');
    expect(query('meetings-home-delete-scope-note')?.className).not.toContain('ring-1');
    button('meetings-home-delete-scope-continue').click();

    expect(close).toHaveBeenCalledWith({ deleteType: 'occurrence', occurrenceId: SECOND.occurrence_id });
  });

  it('closes with the series and hides the picker once the entire series is chosen', async () => {
    await render(buildData(MEETING, FIRST));

    radio('series').click();
    await fixture.whenStable();
    expect(query('meetings-home-delete-scope-occurrence-select')).toBeNull();
    button('meetings-home-delete-scope-continue').click();

    expect(close).toHaveBeenCalledWith({ deleteType: 'series' });
  });

  it('picks an option from a click on its description', async () => {
    await render(buildData(MEETING, FIRST));

    query('meetings-home-delete-scope-series-description')?.click();
    await fixture.whenStable();

    expect(radio('series').checked).toBe(true);
    button('meetings-home-delete-scope-continue').click();
    expect(close).toHaveBeenCalledWith({ deleteType: 'series' });
  });

  it('opens with nothing chosen when it has no date of its own', async () => {
    await render(buildData(MEETING, null));

    expect(radio('occurrence').checked || radio('series').checked).toBe(false);
    expect(button('meetings-home-delete-scope-continue').disabled).toBe(true);
  });

  it('picks a single occurrence from a click on its description when it has no date of its own', async () => {
    await render(buildData(MEETING, null));

    query('meetings-home-delete-scope-occurrence-description')?.click();
    await fixture.whenStable();

    expect(radio('occurrence').checked).toBe(true);
    expect(query('meetings-home-delete-scope-occurrence-select')).not.toBeNull();
  });

  it('opens on the series when no date is left to cancel', async () => {
    await render(buildData({ ...MEETING, occurrences: [] }, null));

    expect(radio('series').checked).toBe(true);
    expect(radio('occurrence').disabled).toBe(true);
    expect(query('meetings-home-delete-scope-options')?.textContent).toContain('There are no upcoming occurrences left to cancel on their own.');
  });

  it('keeps the series from a click on the disabled occurrence description', async () => {
    await render(buildData({ ...MEETING, occurrences: [] }, null));
    const description = query('meetings-home-delete-scope-occurrence-description') as HTMLElement;
    expect(description).not.toBeNull();

    description.click();
    await fixture.whenStable();

    expect(radio('series').checked).toBe(true);
    expect(radio('occurrence').checked).toBe(false);
  });
});
