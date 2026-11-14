// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BreakpointObserver } from '@angular/cdk/layout';
import { OverlayContainer } from '@angular/cdk/overlay';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RecurrenceType } from '@lfx-one/shared/enums';
import { Meeting, MeetingHomeRow, MeetingOccurrence } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MeetingsHomeDeleteService } from '../../../services/meetings-home-delete.service';
import { MeetingsHomeEditService } from '../../../services/meetings-home-edit.service';
import { MeetingDetailsAgendaComponent } from '../agenda/meeting-details-agenda.component';
import { MeetingDetailsGuestsComponent } from '../guests/meeting-details-guests.component';
import { MeetingDetailsContext } from '../meeting-details.context';
import { MeetingDetailsSource } from '../meeting-details.source';
import { MeetingDetailsOccurrenceNavComponent } from '../occurrence-nav/meeting-details-occurrence-nav.component';
import { MeetingDetailsScheduleComponent } from '../schedule/meeting-details-schedule.component';
import { MeetingDetailsArtifactsService } from '../tools/meeting-details-artifacts.service';
import { MeetingDetailsOwnActionsComponent } from '../tools/own-actions/meeting-details-own-actions.component';
import { MeetingDetailsToolsComponent } from '../tools/meeting-details-tools.component';
import { MeetingDetailsBodyComponent } from './meeting-details-body.component';

@Component({ selector: 'lfx-meeting-details-own-actions', template: '' })
class OwnActionsStubComponent {}

@Component({
  selector:
    'lfx-meeting-details-occurrence-nav, lfx-meeting-details-schedule, lfx-meeting-details-tools, lfx-meeting-details-agenda, lfx-meeting-details-guests',
  template: '',
})
class SectionStubComponent {}

const MEETING = {
  id: 'mtg-1',
  title: 'Synthetic sync',
  duration: 30,
  organizer: true,
  project_name: 'Synthetic Project',
  project_slug: 'synthetic',
} as Meeting;
const ROW: MeetingHomeRow = {
  key: MEETING.id,
  meeting: MEETING,
  occurrence: null,
  title: MEETING.title,
  occurrenceId: null,
  startTime: '2050-01-01T09:00:00.000Z',
  durationMinutes: 30,
};

const configure = (row: MeetingHomeRow, extra: Partial<MeetingDetailsSource> = {}, cancelOccurrence = vi.fn()): void => {
  const source: MeetingDetailsSource = {
    row,
    tab: 'agenda',
    now: signal(new Date('2049-12-31T09:00:00.000Z')),
    upcomingRows: signal([]),
    hostRef: null,
    open: vi.fn(),
    applySummaryChange: vi.fn(),
    ...extra,
  };
  TestBed.configureTestingModule({
    providers: [
      MeetingDetailsContext,
      { provide: MeetingDetailsSource, useValue: source },
      { provide: MeetingDetailsArtifactsService, useValue: { flags: signal(null) } },
      { provide: MeetingService, useValue: { getMeetingDetail: () => of(row.meeting), removedRegistrationMeetingIds: signal(new Set<string>()) } },
      { provide: UserService, useValue: { viewerUsername: signal('synthetic-viewer') } },
      { provide: UiToastService, useValue: { show: vi.fn() } },
      { provide: MeetingsHomeEditService, useValue: { edit: vi.fn() } },
      { provide: MeetingsHomeDeleteService, useValue: { cancelOccurrence } },
      { provide: BreakpointObserver, useValue: { observe: () => of({ matches: false, breakpoints: {} }) } },
      provideRouter([]),
    ],
  });
  TestBed.overrideComponent(MeetingDetailsBodyComponent, {
    remove: {
      imports: [
        MeetingDetailsAgendaComponent,
        MeetingDetailsGuestsComponent,
        MeetingDetailsOccurrenceNavComponent,
        MeetingDetailsOwnActionsComponent,
        MeetingDetailsScheduleComponent,
        MeetingDetailsToolsComponent,
      ],
    },
    add: { imports: [OwnActionsStubComponent, SectionStubComponent] },
  });
};

describe('MeetingDetailsBodyComponent', () => {
  it('renders as a page from a source alone, outside a drawer: an h1, and the project leading the header row', async () => {
    configure(ROW);

    const fixture = TestBed.createComponent(MeetingDetailsBodyComponent);
    await fixture.whenStable();
    const find = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

    expect(find('meeting-details-title')?.textContent?.trim()).toBe('Synthetic sync');
    expect(find('meeting-details-title')?.tagName).toBe('H1');
    expect(find('meeting-details-header-compact')).toBeNull();
    expect(find('meeting-details-tabs')).not.toBeNull();
    expect(find('meeting-details-agenda')?.classList.contains('hidden')).toBe(false);
    expect(find('meeting-details-header')).not.toBeNull();
    expect(find('meeting-details-close')).toBeNull();

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const link = fixture.nativeElement.querySelector('[data-testid="meeting-details-header"] [data-testid="meeting-details-project"]') as HTMLElement;
    link.click();
    expect(navigate).toHaveBeenCalled();
  });

  describe('the ⋯ menu', () => {
    const settle = async (fixture: { whenStable: () => Promise<unknown> }): Promise<void> => {
      await fixture.whenStable();
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
    };
    const openMenu = async (): Promise<HTMLElement> => {
      const fixture = TestBed.createComponent(MeetingDetailsBodyComponent);
      await settle(fixture);
      (fixture.nativeElement.querySelector('[data-testid="meeting-details-more"] button') as HTMLButtonElement).click();
      await settle(fixture);
      return TestBed.inject(OverlayContainer).getContainerElement();
    };

    it('hands a cancelled date to the host', async () => {
      const occurrence = { occurrence_id: '2524640400', start_time: ROW.startTime, duration: 30 } as MeetingOccurrence;
      const meeting = { ...MEETING, recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1 }, occurrences: [occurrence] } as unknown as Meeting;
      const occurrenceCancelled = vi.fn();
      configure(
        { ...ROW, meeting, occurrence, occurrenceId: occurrence.occurrence_id },
        { occurrenceCancelled },
        vi.fn(() => of(true))
      );

      const overlay = await openMenu();
      (overlay.querySelector('[data-testid="meeting-details-cancel-occurrence"]') as HTMLElement).click();

      expect(occurrenceCancelled).toHaveBeenCalledWith(expect.objectContaining({ id: MEETING.id }), occurrence);
    });
  });
});
