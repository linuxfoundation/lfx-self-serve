// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BreakpointObserver } from '@angular/cdk/layout';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Meeting, MeetingHomeRow } from '@lfx-one/shared/interfaces';
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

describe('MeetingDetailsBodyComponent', () => {
  it('renders the header and project link from a source alone, outside a drawer and the meetings home page', async () => {
    const source: MeetingDetailsSource = {
      row: ROW,
      tab: 'agenda',
      now: signal(new Date('2049-12-31T09:00:00.000Z')),
      upcomingRows: signal([]),
      hostRef: null,
      open: vi.fn(),
      applySummaryChange: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        MeetingDetailsContext,
        { provide: MeetingDetailsSource, useValue: source },
        { provide: MeetingDetailsArtifactsService, useValue: { flags: signal(null) } },
        { provide: MeetingService, useValue: { getMeetingDetail: () => of(MEETING), removedRegistrationMeetingIds: signal(new Set<string>()) } },
        { provide: UserService, useValue: { viewerUsername: signal('synthetic-viewer') } },
        { provide: UiToastService, useValue: { show: vi.fn() } },
        { provide: MeetingsHomeEditService, useValue: { edit: vi.fn() } },
        { provide: MeetingsHomeDeleteService, useValue: { cancelOccurrence: vi.fn() } },
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

    const fixture = TestBed.createComponent(MeetingDetailsBodyComponent);
    await fixture.whenStable();
    const find = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

    expect(find('meeting-details-title')?.textContent?.trim()).toBe('Synthetic sync');
    expect(find('meeting-details-tabs')).not.toBeNull();
    expect(find('meeting-details-agenda')?.classList.contains('hidden')).toBe(false);
    expect(find('meeting-details-header')).not.toBeNull();
    expect(find('meeting-details-close')).toBeNull();

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const link = fixture.nativeElement.querySelector('[data-testid="meeting-details-title-block"] [data-testid="meeting-details-project"]') as HTMLElement;
    link.click();
    expect(navigate).toHaveBeenCalled();
  });
});
