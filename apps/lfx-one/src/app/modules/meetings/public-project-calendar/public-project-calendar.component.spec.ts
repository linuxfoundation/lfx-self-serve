// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { MeetingService } from '@services/meeting.service';
import { headerTestProviders, installMatchMediaShim } from '@shared/testing/header-test-providers';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { PublicCalendarMeeting, PublicProjectMeetingsResponse } from '@lfx-one/shared/interfaces';

import { PublicProjectCalendarComponent } from './public-project-calendar.component';

beforeAll(installMatchMediaShim);

function meeting(over: Partial<PublicCalendarMeeting> = {}): PublicCalendarMeeting {
  return {
    id: 'meeting-1',
    title: 'Technical Steering Committee',
    start_time: '2026-09-01T15:00:00Z',
    duration: 60,
    timezone: 'America/New_York',
    ...over,
  };
}

function response(over: Partial<PublicProjectMeetingsResponse> = {}): PublicProjectMeetingsResponse {
  return {
    meetings: [meeting()],
    total: 1,
    project: { uid: 'p1', name: 'Kubernetes' },
    ...over,
  };
}

describe('PublicProjectCalendarComponent', () => {
  let fixture: ComponentFixture<PublicProjectCalendarComponent>;
  let getPublicProjectMeetings: ReturnType<typeof vi.fn>;
  let queryParamMap: BehaviorSubject<Map<string, string>>;

  async function render(
    options: {
      response?: PublicProjectMeetingsResponse;
      fail?: boolean;
      slug?: string;
      query?: Map<string, string>;
    } = {}
  ): Promise<void> {
    const { fail = false, slug = 'kubernetes' } = options;
    queryParamMap = new BehaviorSubject(options.query ?? new Map<string, string>());
    getPublicProjectMeetings = vi.fn(() => (fail ? throwError(() => new Error('upstream 503')) : of(options.response ?? response())));

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PublicProjectCalendarComponent],
      providers: [
        ...headerTestProviders(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MeetingService, useValue: { getPublicProjectMeetings } },
        // After provideRouter, which also provides ActivatedRoute — the last provider wins, and the
        // router's own empty paramMap would otherwise silently swallow the slug/committee assertions.
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(new Map([['projectSlug', slug]])), queryParamMap: queryParamMap.asObservable() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PublicProjectCalendarComponent);
    await fixture.whenStable();
  }

  it('renders the project name and meeting count once the feed resolves', async () => {
    await render();

    const title = fixture.nativeElement.querySelector('[data-testid="public-project-calendar-title"]');
    const subtitle = fixture.nativeElement.querySelector('[data-testid="public-project-calendar-subtitle"]');
    expect(title?.textContent?.trim()).toBe('Kubernetes — Calendar');
    expect(subtitle?.textContent?.trim()).toBe('1 meeting');
    expect(fixture.nativeElement.querySelector('[data-testid="public-project-calendar-container"]')).not.toBeNull();
  });

  it('shows the error state and no calendar when the feed fails', async () => {
    await render({ fail: true });

    expect(fixture.nativeElement.querySelector('[data-testid="public-project-calendar-error"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="public-project-calendar-container"]')).toBeNull();
  });

  it('scopes the request to a committee when ?committee= is present', async () => {
    await render({ query: new Map([['committee', 'committee-uid-1234']]) });

    expect(getPublicProjectMeetings).toHaveBeenCalledWith('kubernetes', 'committee-uid-1234');
  });

  it('opens on the week view when ?view=week, and the month view otherwise', async () => {
    await render({ query: new Map([['view', 'week']]) });
    expect((fixture.componentInstance as unknown as { initialView: () => string }).initialView()).toBe('timeGridWeek');

    await render();
    expect((fixture.componentInstance as unknown as { initialView: () => string }).initialView()).toBe('dayGridMonth');
  });

  it('does not refetch when only ?view changes', async () => {
    // Regression lock: the fetch pipeline reads queryParamMap for `committee`, so without
    // distinctUntilChanged on {slug, committeeUid} a pure month/week toggle would re-enter
    // switchMap, re-hit the upstream feed, and flash the loading skeleton.
    await render();
    expect(getPublicProjectMeetings).toHaveBeenCalledTimes(1);

    queryParamMap.next(new Map([['view', 'week']]));
    await fixture.whenStable();

    expect(getPublicProjectMeetings).toHaveBeenCalledTimes(1);
  });

  it('refetches when the committee filter changes', async () => {
    await render();
    expect(getPublicProjectMeetings).toHaveBeenCalledTimes(1);

    queryParamMap.next(new Map([['committee', 'committee-uid-1234']]));
    await fixture.whenStable();

    expect(getPublicProjectMeetings).toHaveBeenCalledTimes(2);
    expect(getPublicProjectMeetings).toHaveBeenLastCalledWith('kubernetes', 'committee-uid-1234');
  });
});
