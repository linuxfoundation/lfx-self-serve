// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RecurrenceType } from '@lfx-one/shared/enums';
import { Meeting, MeetingHomeRow, MeetingRsvpScopeDialogData } from '@lfx-one/shared/interfaces';
import { formatMeetingWhenFull } from '@lfx-one/shared/utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingRsvpScopeModalComponent } from './meeting-rsvp-scope-modal.component';

// Thursday, Oct 1 2026, 09:00 in the runner's local zone.
const START = new Date(2026, 9, 1, 9, 0);
const MEETING = {
  id: 'synthetic-meeting',
  title: 'Synthetic sync',
  project_name: 'Synthetic Project',
  meeting_type: 'Technical',
  recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1 },
} as Meeting;

function buildRow(occurrenceId: string | null): MeetingHomeRow {
  return { key: 'row', meeting: MEETING, occurrence: null, title: 'Synthetic sync', occurrenceId, startTime: START.toISOString(), durationMinutes: 60 };
}

describe('MeetingRsvpScopeModalComponent', () => {
  let close: ReturnType<typeof vi.fn>;

  const render = async (data: MeetingRsvpScopeDialogData): Promise<ComponentFixture<MeetingRsvpScopeModalComponent>> => {
    close = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: DIALOG_DATA, useValue: data },
        { provide: DialogRef, useValue: { id: 'synthetic-dialog', close } },
      ],
    });
    const fixture = TestBed.createComponent(MeetingRsvpScopeModalComponent);
    await fixture.whenStable();
    return fixture;
  };
  const query = (fixture: ComponentFixture<MeetingRsvpScopeModalComponent>, testId: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const radio = (fixture: ComponentFixture<MeetingRsvpScopeModalComponent>, scope: string): HTMLInputElement =>
    query(fixture, `meetings-home-rsvp-scope-${scope}`)?.querySelector('input') as HTMLInputElement;
  const click = (fixture: ComponentFixture<MeetingRsvpScopeModalComponent>, testId: string): void =>
    (query(fixture, testId)?.querySelector('button') as HTMLButtonElement).click();

  beforeEach(() => TestBed.resetTestingModule());

  it('offers this occurrence, this and following, and all, defaulting to this occurrence', async () => {
    const fixture = await render({ row: buildRow('1790845200'), response: 'accepted' });

    expect(query(fixture, 'meetings-home-rsvp-scope-text')?.textContent?.trim()).toBe('You are responding “Going” to a recurring meeting. Apply it to:');
    const labels = [...fixture.nativeElement.querySelectorAll('[data-testid="ui-radio-text"]')].map((el: Element) => el.textContent?.trim());
    expect(labels).toEqual(['This occurrence', 'This and following occurrences', 'All occurrences']);
    expect(radio(fixture, 'single').checked).toBe(true);
    expect(query(fixture, 'meetings-home-rsvp-scope-all-only')).toBeNull();
    expect(query(fixture, 'meetings-home-rsvp-scope-info')?.textContent).toContain('Synthetic Project');
    expect(query(fixture, 'meetings-home-rsvp-scope-info')?.textContent).toContain('Thu, Oct 1');
  });

  it('closes with the chosen scope on OK', async () => {
    const fixture = await render({ row: buildRow('1790845200'), response: 'declined' });

    radio(fixture, 'this_and_following').click();
    await fixture.whenStable();
    click(fixture, 'meetings-home-rsvp-scope-ok');

    expect(close).toHaveBeenCalledWith('this_and_following');
  });

  it('shows the meeting as a band with the full date line and the options without descriptions', async () => {
    const row = buildRow('1790845200');
    const fixture = await render({ row, response: 'declined' });

    expect(query(fixture, 'meeting-dialog-context-block')?.className).toContain('border-y');
    expect(query(fixture, 'meeting-dialog-context-when')?.textContent?.trim()).toBe(formatMeetingWhenFull(row));
    expect(query(fixture, 'meeting-dialog-context-when')?.textContent).toMatch(/^Thu, Oct 1 · 9:00 AM · 60 min/);
    expect(fixture.nativeElement.querySelector('[data-testid$="-description"]')).toBeNull();
  });

  it('swaps the meeting band for a single divider when opened from the drawer', async () => {
    const fixture = await render({ row: buildRow('1790845200'), response: 'accepted', origin: 'drawer' });

    expect(query(fixture, 'meeting-dialog-context-divider')).not.toBeNull();
    expect(query(fixture, 'meeting-dialog-context-block')).toBeNull();
  });

  it('closes with nothing on Cancel', async () => {
    const fixture = await render({ row: buildRow('1790845200'), response: 'maybe' });

    click(fixture, 'meetings-home-rsvp-scope-cancel');

    expect(close).toHaveBeenCalledWith();
  });

  it('offers only all occurrences when the date is not resolved', async () => {
    const fixture = await render({ row: buildRow(null), response: 'accepted' });

    expect(query(fixture, 'meetings-home-rsvp-scope-single')).toBeNull();
    expect(query(fixture, 'meetings-home-rsvp-scope-this_and_following')).toBeNull();
    expect(radio(fixture, 'all').checked).toBe(true);
    expect(query(fixture, 'meetings-home-rsvp-scope-all-only')?.textContent?.trim()).toBe(
      'A specific upcoming date could not be resolved. Only all dates can be selected.'
    );

    click(fixture, 'meetings-home-rsvp-scope-ok');
    expect(close).toHaveBeenCalledWith('all');
  });
});
