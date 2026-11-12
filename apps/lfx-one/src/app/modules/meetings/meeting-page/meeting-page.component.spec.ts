// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MEETING_PAGE_LEGACY_STATE } from '@lfx-one/shared/constants';
import { Meeting } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiEmptyStateComponent } from '@shared/uikit/empty-state/empty-state.component';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingPageDataService } from '../services/meeting-page-data.service';
import { MeetingPageComponent } from './meeting-page.component';

const PAST_MEETING = {
  id: '123-1700000000000',
  meeting_id: '123',
  meeting_and_occurrence_id: '123-1700000000000',
  title: 'Weekly sync',
  scheduled_start_time: '2023-11-14T22:13:20Z',
  duration: 30,
  organizer: false,
} as unknown as Meeting;

describe('MeetingPageComponent', () => {
  let meeting: ReturnType<typeof signal<Meeting | undefined>>;
  let loadedViaPastMeetingId: ReturnType<typeof signal<boolean>>;
  let pastMeetingFullAccess: ReturnType<typeof signal<boolean>>;
  let meetingLoadFailed: ReturnType<typeof signal<boolean>>;
  let navigateByUrl: ReturnType<typeof vi.fn>;
  let refresh: ReturnType<typeof vi.fn>;
  let trackPageview: ReturnType<typeof vi.fn>;
  let routeId: ReturnType<typeof signal<string | null>>;

  const render = (): HTMLElement => {
    const fixture = TestBed.createComponent(MeetingPageComponent);
    fixture.detectChanges();
    TestBed.tick();
    return fixture.nativeElement as HTMLElement;
  };

  beforeEach(() => {
    meeting = signal<Meeting | undefined>(PAST_MEETING);
    loadedViaPastMeetingId = signal(true);
    pastMeetingFullAccess = signal(true);
    meetingLoadFailed = signal(false);
    navigateByUrl = vi.fn().mockResolvedValue(true);
    refresh = vi.fn();
    trackPageview = vi.fn();
    routeId = signal<string | null>('123-1700000000000');

    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { url: '/meetings/123-1700000000000', navigateByUrl } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    });
    TestBed.overrideComponent(MeetingPageComponent, {
      set: {
        imports: [UiButtonComponent, UiEmptyStateComponent, UiSkeletonComponent],
        schemas: [CUSTOM_ELEMENTS_SCHEMA],
        providers: [
          {
            provide: MeetingPageDataService,
            useValue: {
              load: () => meeting,
              routeId,
              meetingMatchesRoute: signal(true),
              loadedViaPastMeetingId,
              pastMeetingFullAccess,
              meetingLoadFailed,
              startClock: vi.fn(),
              refresh,
              trackPageview,
            },
          },
        ],
      },
    });
  });

  it.each([
    ['a viewer with full access', () => undefined],
    ['the organizer', () => meeting.set({ ...PAST_MEETING, organizer: true })],
  ])('shows the details of an ended meeting to %s', (_case, arrange) => {
    arrange();
    const element = render();

    expect(element.querySelector('lfx-meeting-page-details')).not.toBeNull();
    expect(navigateByUrl).not.toHaveBeenCalled();
    expect(trackPageview).toHaveBeenCalledTimes(1);
  });

  it('sends a pageview for each meeting the reused page shows', () => {
    const element = render();
    expect(element.querySelector('lfx-meeting-page-details')).not.toBeNull();

    routeId.set('123-1700604800000');
    meeting.set(undefined);
    TestBed.tick();
    meeting.set({ ...PAST_MEETING, id: '123-1700604800000', meeting_and_occurrence_id: '123-1700604800000' } as unknown as Meeting);
    TestBed.tick();

    expect(trackPageview).toHaveBeenCalledTimes(2);
  });

  it('flattens the public project onto the row the details read', () => {
    meeting.set({ ...PAST_MEETING, project: { name: 'Parity Project', slug: 'parity', logo_url: 'https://logo.example.org/p.png' } } as unknown as Meeting);
    const fixture = TestBed.createComponent(MeetingPageComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.row()?.meeting).toMatchObject({
      project_name: 'Parity Project',
      project_slug: 'parity',
      project_logo_url: 'https://logo.example.org/p.png',
    });
  });

  it.each([
    ['an upcoming meeting', () => loadedViaPastMeetingId.set(false)],
    ['a viewer without full access', () => pastMeetingFullAccess.set(false)],
  ])('hands %s to the legacy page at the same URL', (_case, arrange) => {
    arrange();
    const element = render();

    expect(element.querySelector('lfx-meeting-page-details')).toBeNull();
    expect(navigateByUrl).toHaveBeenCalledWith('/meetings/123-1700000000000', {
      skipLocationChange: true,
      onSameUrlNavigation: 'reload',
      state: { [MEETING_PAGE_LEGACY_STATE]: true },
    });
    expect(trackPageview).not.toHaveBeenCalled();
  });

  it('shows the loading state until the meeting loads', () => {
    meeting.set(undefined);
    const element = render();

    expect(element.querySelector('[data-testid="meeting-page-loading"]')).not.toBeNull();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('shows the error state with a Refresh that reloads the meeting', () => {
    meeting.set(undefined);
    meetingLoadFailed.set(true);
    const element = render();

    expect(element.querySelector('[data-testid="meeting-page-error"]')).not.toBeNull();
    (element.querySelector('[data-testid="meeting-page-refresh"] button') as HTMLButtonElement).click();
    expect(refresh).toHaveBeenCalled();
  });
});
