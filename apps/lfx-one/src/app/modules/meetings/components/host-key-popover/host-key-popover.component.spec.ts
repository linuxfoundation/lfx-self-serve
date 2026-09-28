// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApplicationRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Meeting, MeetingOccurrence } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { MessageService } from 'primeng/api';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HostKeyPopoverComponent } from './host-key-popover.component';

describe('HostKeyPopoverComponent', () => {
  const MEETING_ID = 'meeting-1';
  const HOST_KEY = '123456';

  let getMeetingDetail: ReturnType<typeof vi.fn>;

  const buildMeeting = (overrides: Partial<Meeting> = {}) =>
    ({
      id: MEETING_ID,
      organizer: true,
      // 30 min from now — inside the 70-min host-key pre-window.
      start_time: new Date(Date.now() + 30 * 60_000).toISOString(),
      duration: 60,
      ...overrides,
    }) as Meeting;

  const buildOccurrence = (overrides: Partial<MeetingOccurrence> = {}) =>
    ({
      occurrence_id: 'occ-1',
      start_time: new Date(Date.now() + 30 * 60_000).toISOString(),
      duration: 60,
      ...overrides,
    }) as MeetingOccurrence;

  const createComponent = (): ComponentFixture<HostKeyPopoverComponent> => TestBed.createComponent(HostKeyPopoverComponent);

  const setInputs = (
    fixture: ComponentFixture<HostKeyPopoverComponent>,
    meeting: Meeting,
    occurrence: MeetingOccurrence | null = null,
    pastMeeting = false
  ) => {
    fixture.componentRef.setInput('meeting', meeting);
    fixture.componentRef.setInput('occurrence', occurrence);
    fixture.componentRef.setInput('pastMeeting', pastMeeting);
  };

  const clickElement = (root: ParentNode, testid: string): void => {
    const host = root.querySelector(`[data-testid="${testid}"]`);
    const button = host?.querySelector('button') ?? host;
    (button as HTMLElement).click();
  };

  const openPopover = async (fixture: ComponentFixture<HostKeyPopoverComponent>): Promise<void> => {
    clickElement(fixture.nativeElement, 'host-controls-button');
    fixture.detectChanges();
    await TestBed.inject(ApplicationRef).whenStable();
    fixture.detectChanges();
  };

  const closePopover = async (fixture: ComponentFixture<HostKeyPopoverComponent>): Promise<void> => {
    // Toggling with the same trigger target hides the popover.
    clickElement(fixture.nativeElement, 'host-controls-button');
    fixture.detectChanges();
    await TestBed.inject(ApplicationRef).whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    getMeetingDetail = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        { provide: MeetingService, useValue: { getMeetingDetail } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
  });

  it('hides the trigger when the viewer is not an organizer', () => {
    const fixture = createComponent();
    setInputs(fixture, buildMeeting({ organizer: false }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="host-controls-button"]')).toBeNull();
  });

  it('hides the trigger for past meetings', () => {
    const fixture = createComponent();
    setInputs(fixture, buildMeeting(), null, true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="host-controls-button"]')).toBeNull();
  });

  it('hides the trigger outside the host-key window', () => {
    const fixture = createComponent();
    setInputs(fixture, buildMeeting({ start_time: new Date(Date.now() + 3 * 24 * 3600_000).toISOString() }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="host-controls-button"]')).toBeNull();
  });

  it('shows the trigger to an organizer inside the window and prefers an in-window occurrence over a far-out series start', () => {
    const fixture = createComponent();
    setInputs(fixture, buildMeeting({ start_time: new Date(Date.now() + 3 * 24 * 3600_000).toISOString() }), buildOccurrence());
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="host-controls-button"]')).not.toBeNull();
  });

  it('shows the trigger via next_occurrence_start_time when the series start is far past and no occurrence is supplied', () => {
    const fixture = createComponent();
    setInputs(
      fixture,
      buildMeeting({
        start_time: new Date(Date.now() - 7 * 24 * 3600_000).toISOString(),
        next_occurrence_start_time: new Date(Date.now() + 30 * 60_000).toISOString(),
      })
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="host-controls-button"]')).not.toBeNull();
  });

  it('hides the trigger when the explicit occurrence is outside the window even if next_occurrence_start_time is inside it', () => {
    const fixture = createComponent();
    // The meeting's own chain is in-window, so a hidden trigger proves the explicit occurrence won.
    setInputs(
      fixture,
      buildMeeting({ next_occurrence_start_time: new Date(Date.now() + 30 * 60_000).toISOString() }),
      buildOccurrence({ start_time: new Date(Date.now() + 3 * 24 * 3600_000).toISOString() })
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="host-controls-button"]')).toBeNull();
  });

  it('fetches the meeting detail on every open, with skipCache', async () => {
    getMeetingDetail.mockReturnValue(of(buildMeeting({ host_key: HOST_KEY, can_view_host_key: true })));
    const fixture = createComponent();
    setInputs(fixture, buildMeeting());
    fixture.detectChanges();

    await openPopover(fixture);
    await closePopover(fixture);
    await openPopover(fixture);

    // The key can rotate, so reopening re-fetches rather than serving the first open's value.
    expect(getMeetingDetail).toHaveBeenCalledTimes(2);
    expect(getMeetingDetail).toHaveBeenCalledWith(MEETING_ID, { skipCache: true });
  });

  it('renders the masked host-key panel on success', async () => {
    getMeetingDetail.mockReturnValue(of(buildMeeting({ host_key: HOST_KEY, can_view_host_key: true })));
    const fixture = createComponent();
    setInputs(fixture, buildMeeting());
    fixture.detectChanges();

    await openPopover(fixture);

    const content = document.querySelector('[data-testid="host-key-popover-content"]');
    expect(content).not.toBeNull();
    expect(content!.querySelector('[data-testid="meeting-host-key"]')).not.toBeNull();
    expect(content!.querySelector('[data-testid="host-key-toggle"]')!.textContent).toContain('Host Key');
    expect(content!.querySelector('[data-testid="host-key-toggle"]')!.textContent).not.toContain(HOST_KEY);
  });

  it('renders the empty state when the detail carries no viewable key', async () => {
    getMeetingDetail.mockReturnValue(of(buildMeeting({ host_key: undefined, can_view_host_key: false })));
    const fixture = createComponent();
    setInputs(fixture, buildMeeting());
    fixture.detectChanges();

    await openPopover(fixture);

    expect(document.querySelector('[data-testid="host-key-empty"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="meeting-host-key"]')).toBeNull();
  });

  it('renders the error state on fetch failure and refetches on retry', async () => {
    getMeetingDetail.mockReturnValueOnce(throwError(() => new Error('500'))).mockReturnValue(of(buildMeeting({ host_key: HOST_KEY, can_view_host_key: true })));
    const fixture = createComponent();
    setInputs(fixture, buildMeeting());
    fixture.detectChanges();

    await openPopover(fixture);

    expect(document.querySelector('[data-testid="host-key-error"]')).not.toBeNull();

    clickElement(document, 'host-key-retry');
    fixture.detectChanges();
    await TestBed.inject(ApplicationRef).whenStable();
    fixture.detectChanges();

    expect(getMeetingDetail).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[data-testid="meeting-host-key"]')).not.toBeNull();
  });

  it('supersedes an in-flight retry so the latest request wins', async () => {
    const pendingFirst = new Subject<Meeting>();
    const pendingSecond = new Subject<Meeting>();
    getMeetingDetail
      .mockReturnValueOnce(throwError(() => new Error('500')))
      .mockReturnValueOnce(pendingFirst.asObservable())
      .mockReturnValueOnce(pendingSecond.asObservable());
    const fixture = createComponent();
    setInputs(fixture, buildMeeting());
    fixture.detectChanges();

    await openPopover(fixture);
    expect(document.querySelector('[data-testid="host-key-error"]')).not.toBeNull();

    // The UI hides the retry button while loading, so drive retry() directly to pin the switchMap
    // contract: a second retry while the first is in flight cancels it and issues a new request.
    fixture.componentInstance.retry();
    fixture.componentInstance.retry();

    expect(getMeetingDetail).toHaveBeenCalledTimes(3);

    // The superseded request resolving late must not clobber state — only the latest applies.
    pendingFirst.next(buildMeeting({ host_key: 'stale-key', can_view_host_key: true }));
    pendingFirst.complete();
    pendingSecond.next(buildMeeting({ host_key: HOST_KEY, can_view_host_key: true }));
    pendingSecond.complete();
    await TestBed.inject(ApplicationRef).whenStable();
    fixture.detectChanges();

    expect(document.querySelector('[data-testid="meeting-host-key"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="host-key-error"]')).toBeNull();
  });

  it('shows the trigger when the host-key window opens as time passes, without input changes', () => {
    vi.useFakeTimers();
    try {
      const fixture = createComponent();
      // 71 minutes out — just outside the 70-minute early window.
      setInputs(fixture, buildMeeting({ start_time: new Date(Date.now() + 71 * 60_000).toISOString() }));
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="host-controls-button"]')).toBeNull();

      // Two minute-ticks of the component clock cross the boundary with no input change.
      vi.advanceTimersByTime(2 * 60_000);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('[data-testid="host-controls-button"]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('hides the trigger when the host-key window closes as time passes, without input changes', () => {
    vi.useFakeTimers();
    try {
      const fixture = createComponent();
      // Started 99 minutes ago with a 60-minute duration: the window (start + duration + 40 min)
      // closes 1 minute from now.
      setInputs(fixture, buildMeeting({ start_time: new Date(Date.now() - 99 * 60_000).toISOString() }));
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="host-controls-button"]')).not.toBeNull();

      vi.advanceTimersByTime(2 * 60_000);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('[data-testid="host-controls-button"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
