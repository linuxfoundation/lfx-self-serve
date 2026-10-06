// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Meeting, MeetingOccurrence } from '@lfx-one/shared/interfaces';
import { FeatureFlagService } from '@services/feature-flag.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RecurringMeetingEditOptionsComponent } from './recurring-meeting-edit-options.component';

const FIRST = { occurrence_id: '2524640400', start_time: '2050-01-01T09:00:00.000Z', duration: 30 } as MeetingOccurrence;
const SECOND = { occurrence_id: '2525245200', start_time: '2050-01-08T09:00:00.000Z', duration: 30 } as MeetingOccurrence;
const MEETING = { id: 'meeting-1', title: 'Weekly sync', timezone: 'UTC', occurrences: [FIRST, SECOND] } as unknown as Meeting;

/**
 * Covers the edit scope dialog's occurrence picker: it opens on the occurrence the organizer clicked
 * from, can be pointed at another, and hands back whichever one is picked.
 */
describe('RecurringMeetingEditOptionsComponent', () => {
  let close: ReturnType<typeof vi.fn>;
  let meetingsV2Enabled: boolean;

  async function mount(occurrence: MeetingOccurrence | null = SECOND): Promise<RecurringMeetingEditOptionsComponent> {
    TestBed.configureTestingModule({
      providers: [
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: { meeting: MEETING, occurrence } } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(meetingsV2Enabled) } },
      ],
    });
    TestBed.overrideComponent(RecurringMeetingEditOptionsComponent, { set: { template: '', imports: [] } });
    await TestBed.compileComponents();

    const fixture = TestBed.createComponent(RecurringMeetingEditOptionsComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    close = vi.fn();
    meetingsV2Enabled = true;
  });

  it('opens on a single occurrence, preselected to the one clicked from', async () => {
    const component = await mount();

    expect(component.editForm.getRawValue()).toEqual({ scope: 'occurrence', occurrenceId: SECOND.occurrence_id });
    expect(component.occurrenceOptions.map((option) => option.value)).toEqual([FIRST.occurrence_id, SECOND.occurrence_id]);
  });

  it('returns the occurrence the organizer picked', async () => {
    const component = await mount();
    component.editForm.get('occurrenceId')?.setValue(FIRST.occurrence_id);

    component.onConfirm();

    expect(close).toHaveBeenCalledWith({ scope: 'occurrence', proceed: true, occurrenceId: FIRST.occurrence_id });
  });

  it('returns no occurrence for a series edit', async () => {
    const component = await mount();
    component.editForm.get('scope')?.setValue('series');

    component.onConfirm();

    expect(close).toHaveBeenCalledWith({ scope: 'series', proceed: true });
  });

  it('will not continue with a single occurrence and none picked', async () => {
    const component = await mount();
    component.editForm.get('occurrenceId')?.setValue(null);

    component.onConfirm();

    expect(close).not.toHaveBeenCalled();
  });

  it('closes without proceeding on cancel', async () => {
    const component = await mount();

    component.onCancel();

    expect(close).toHaveBeenCalledWith({ scope: 'occurrence', proceed: false });
  });

  it('edits the occurrence it was opened on while the meeting v2 flag is off', async () => {
    meetingsV2Enabled = false;
    const component = await mount();

    component.onConfirm();

    expect(close).toHaveBeenCalledWith({ scope: 'occurrence', proceed: true, occurrenceId: SECOND.occurrence_id });
  });

  it('keeps the occurrence it was opened on with the flag off, even when the picker would not list it', async () => {
    meetingsV2Enabled = false;
    const ended = { occurrence_id: '946717200', start_time: '2000-01-01T09:00:00.000Z', duration: 30 } as MeetingOccurrence;
    const component = await mount(ended);

    component.onConfirm();

    expect(close).toHaveBeenCalledWith({ scope: 'occurrence', proceed: true, occurrenceId: ended.occurrence_id });
  });
});
