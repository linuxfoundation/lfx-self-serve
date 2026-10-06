// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Meeting, MeetingOccurrence } from '@lfx-one/shared/interfaces';
import { FeatureFlagService } from '@services/feature-flag.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingDeleteTypeSelectionComponent } from './meeting-delete-type-selection.component';

const FIRST = { occurrence_id: '2524640400', start_time: '2050-01-01T09:00:00.000Z', duration: 30 } as MeetingOccurrence;
const SECOND = { occurrence_id: '2525245200', start_time: '2050-01-08T09:00:00.000Z', duration: 30 } as MeetingOccurrence;

/**
 * Covers the delete scope dialog's occurrence picker, which mirrors the edit scope dialog's: cancelling
 * one occurrence names which, and deleting the series names none.
 */
describe('MeetingDeleteTypeSelectionComponent', () => {
  let close: ReturnType<typeof vi.fn>;
  let meetingsV2Enabled: boolean;

  async function mount(occurrences: MeetingOccurrence[] = [FIRST, SECOND], occurrence: MeetingOccurrence | null = FIRST) {
    const meeting = { id: 'meeting-1', title: 'Weekly sync', timezone: 'UTC', occurrences } as unknown as Meeting;
    TestBed.configureTestingModule({
      providers: [
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: { meeting, occurrence } } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(meetingsV2Enabled) } },
      ],
    });
    TestBed.overrideComponent(MeetingDeleteTypeSelectionComponent, { set: { template: '', imports: [] } });
    await TestBed.compileComponents();

    const fixture = TestBed.createComponent(MeetingDeleteTypeSelectionComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  beforeEach(() => {
    close = vi.fn();
    meetingsV2Enabled = true;
  });

  it('opens on cancelling a single occurrence, preselected to the one clicked from', async () => {
    const component = await mount();

    expect(component.deleteForm.getRawValue()).toEqual({ deleteType: 'occurrence', occurrenceId: FIRST.occurrence_id });
  });

  it('cancels the occurrence the organizer picked', async () => {
    const component = await mount();
    component.deleteForm.get('occurrenceId')?.setValue(SECOND.occurrence_id);

    component.onContinue();

    expect(close).toHaveBeenCalledWith({ deleteType: 'occurrence', occurrenceId: SECOND.occurrence_id });
  });

  it('deletes the series without naming an occurrence', async () => {
    const component = await mount();
    component.deleteForm.get('deleteType')?.setValue('series');

    component.onContinue();

    expect(close).toHaveBeenCalledWith({ deleteType: 'series' });
  });

  it('opens on the series when no occurrence is left to cancel on its own', async () => {
    const component = await mount([], null);

    expect(component.deleteForm.get('deleteType')?.value).toBe('series');
  });

  it('will not continue with a single occurrence and none picked', async () => {
    const component = await mount();
    component.deleteForm.get('occurrenceId')?.setValue(null);

    component.onContinue();

    expect(close).not.toHaveBeenCalled();
  });

  describe('with the meeting v2 flag off', () => {
    beforeEach(() => {
      meetingsV2Enabled = false;
    });

    it('opens with nothing selected and will not continue until a type is chosen', async () => {
      const component = await mount();

      component.onContinue();

      expect(component.deleteForm.get('deleteType')?.value).toBeNull();
      expect(close).not.toHaveBeenCalled();
    });

    it('cancels without naming an occurrence, so the caller uses the one it opened on', async () => {
      const component = await mount();
      component.selectType('occurrence');

      component.onContinue();

      expect(close).toHaveBeenCalledWith({ deleteType: 'occurrence' });
    });
  });

  it('preselects the occurrence it was opened on even when its id is in milliseconds', async () => {
    const component = await mount([FIRST, SECOND], { ...SECOND, occurrence_id: `${SECOND.occurrence_id}000` });

    expect(component.deleteForm.get('occurrenceId')?.value).toBe(SECOND.occurrence_id);
  });
});
