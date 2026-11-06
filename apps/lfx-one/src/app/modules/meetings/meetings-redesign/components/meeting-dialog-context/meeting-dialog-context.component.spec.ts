// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RecurrenceType } from '@lfx-one/shared/enums';
import { Meeting, MeetingDialogOrigin, MeetingHomeRow } from '@lfx-one/shared/interfaces';
import { formatMeetingWhenFull } from '@lfx-one/shared/utils';
import { describe, expect, it } from 'vitest';

import { MeetingDialogContextComponent } from './meeting-dialog-context.component';

// Thursday, Oct 1 2026, 09:00 in the runner's local zone.
const START = new Date(2026, 9, 1, 9, 0);
const MEETING = {
  id: 'synthetic-meeting',
  title: 'Synthetic sync',
  project_name: 'Synthetic Project',
  meeting_type: 'Technical',
  recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1 },
} as Meeting;
const ROW: MeetingHomeRow = {
  key: 'row',
  meeting: MEETING,
  occurrence: null,
  title: 'Synthetic sync',
  occurrenceId: '1790845200',
  startTime: START.toISOString(),
  durationMinutes: 60,
};

describe('MeetingDialogContextComponent', () => {
  const render = async (row: MeetingHomeRow, origin?: MeetingDialogOrigin): Promise<ComponentFixture<MeetingDialogContextComponent>> => {
    const fixture = TestBed.createComponent(MeetingDialogContextComponent);
    fixture.componentRef.setInput('row', row);
    if (origin) fixture.componentRef.setInput('origin', origin);
    await fixture.whenStable();
    return fixture;
  };
  const query = (fixture: ComponentFixture<MeetingDialogContextComponent>, testId: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  it('shows the project, title and full date line between two full-bleed rules', async () => {
    const fixture = await render(ROW);
    const block = query(fixture, 'meeting-dialog-context-block');

    expect(Array.from((fixture.nativeElement as HTMLElement).classList)).toContain('-mx-[24px]');
    expect(Array.from(block?.classList ?? [])).toEqual(expect.arrayContaining(['border-y', 'border-gray-200', 'px-[24px]', 'py-[16px]']));
    expect(query(fixture, 'meeting-dialog-context-project')?.textContent?.trim()).toBe('Synthetic Project');
    expect(query(fixture, 'meeting-dialog-context-title')?.textContent?.trim()).toBe('Synthetic sync');
    expect(query(fixture, 'meeting-dialog-context-when')?.textContent?.trim()).toBe(formatMeetingWhenFull(ROW));
    expect(query(fixture, 'meeting-dialog-context-divider')).toBeNull();
  });

  it('leaves out the project line when the meeting has no project', async () => {
    const fixture = await render({ ...ROW, meeting: { ...MEETING, project_name: undefined } as Meeting });

    expect(query(fixture, 'meeting-dialog-context-project')).toBeNull();
    expect(query(fixture, 'meeting-dialog-context-title')?.textContent?.trim()).toBe('Synthetic sync');
  });

  it('shows only a single divider when opened from the drawer', async () => {
    const fixture = await render(ROW, 'drawer');
    const divider = query(fixture, 'meeting-dialog-context-divider');

    expect(query(fixture, 'meeting-dialog-context-block')).toBeNull();
    expect(Array.from(divider?.classList ?? [])).toEqual(expect.arrayContaining(['border-t', 'border-gray-200']));
    expect(divider?.getAttribute('aria-hidden')).toBe('true');
  });
});
