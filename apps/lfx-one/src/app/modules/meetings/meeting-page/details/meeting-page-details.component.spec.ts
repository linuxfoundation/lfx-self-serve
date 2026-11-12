// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { Meeting, MeetingHomeRow, PastMeeting } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingDetailsSource } from '../../meetings-redesign/components/meeting-details-drawer/meeting-details.source';
import { MeetingPageDataService } from '../../services/meeting-page-data.service';
import { MeetingPageDetailsComponent, MeetingPageRowHost } from './meeting-page-details.component';

const PAST_ROW = {
  key: '123-1700000000000',
  meeting: { id: '123-1700000000000', meeting_id: '123', meeting_and_occurrence_id: '123-1700000000000', title: 'Review' } as PastMeeting,
  occurrence: null,
  title: 'Review',
  occurrenceId: null,
  startTime: '2023-11-14T22:13:20.000Z',
  durationMinutes: 30,
} as MeetingHomeRow;

describe('MeetingPageDetailsComponent', () => {
  let navigateByUrl: ReturnType<typeof vi.fn>;
  let row: ReturnType<typeof signal<MeetingHomeRow | null>>;

  const source = (): MeetingDetailsSource => {
    const fixture = TestBed.createComponent(MeetingPageDetailsComponent);
    return fixture.debugElement.query(By.css('lfx-meeting-details-body')).injector.get(MeetingDetailsSource);
  };

  beforeEach(() => {
    navigateByUrl = vi.fn().mockResolvedValue(true);
    row = signal<MeetingHomeRow | null>(PAST_ROW);
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { navigateByUrl } },
        { provide: MeetingPageRowHost, useValue: { row } },
        { provide: MeetingPageDataService, useValue: { clock: signal(Date.parse('2026-01-01T00:00:00Z')) } },
      ],
    });
    TestBed.overrideComponent(MeetingPageDetailsComponent, { set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA] } });
  });

  it('gives the details the host row and the page clock, with no dialog or list', () => {
    const page = source();

    expect(page.row).toBe(PAST_ROW);
    expect(page.now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(page.hostRef).toBeNull();
    expect(page.upcomingRows()).toEqual([]);
  });

  it('opens a past row at its {id}-{ms} page', () => {
    source().open(PAST_ROW);

    expect(navigateByUrl).toHaveBeenCalledWith('/meetings/123-1700000000000');
  });

  it('opens an upcoming date of a series at its occurrence', () => {
    const start = '2030-01-08T10:00:00.000Z';
    source().open({ ...PAST_ROW, meeting: { id: '123' } as Meeting, occurrenceId: 'occ-2', startTime: start });

    expect(navigateByUrl).toHaveBeenCalledWith(`/meetings/123?occurrence=${Date.parse(start)}`);
  });

  it('opens a one-time meeting at its plain page', () => {
    source().open({ ...PAST_ROW, meeting: { id: '456' } as Meeting, occurrenceId: null });

    expect(navigateByUrl).toHaveBeenCalledWith('/meetings/456');
  });
});
