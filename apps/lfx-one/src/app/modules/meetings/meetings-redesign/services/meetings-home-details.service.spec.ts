// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { Meeting, MeetingDetailsDrawerData, MeetingHomeRow } from '@lfx-one/shared/interfaces';
import { OverlayStateService } from '@services/overlay-state.service';
import { PlausibleService } from '@services/plausible.service';
import { SegmentService } from '@services/segment.service';
import { UiDrawerService } from '@shared/uikit/drawer/drawer.service';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingDetailsDrawerComponent } from '../components/meeting-details-drawer/meeting-details-drawer.component';
import { MeetingsHomeDetailsService } from './meetings-home-details.service';

@Component({ selector: 'lfx-details-host', template: '', providers: [MeetingsHomeDetailsService] })
class HostComponent {
  public readonly details = inject(MeetingsHomeDetailsService);
}

const ROW = { key: 'synthetic-meeting', meeting: { id: 'synthetic-meeting' } as Meeting, title: 'Synthetic sync' } as MeetingHomeRow;

describe('MeetingsHomeDetailsService', () => {
  let open: ReturnType<typeof vi.fn>;
  let refs: { close: ReturnType<typeof vi.fn>; closed: Subject<void> }[];
  let router: { url: string };
  let plausibleEvent: ReturnType<typeof vi.fn>;
  let segmentEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    refs = [];
    open = vi.fn(() => {
      const ref = { close: vi.fn(), closed: new Subject<void>() };
      refs.push(ref);
      return ref;
    });
    router = { url: '/meetings' };
    plausibleEvent = vi.fn();
    segmentEvent = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: UiDrawerService, useValue: { open } },
        { provide: Router, useValue: router },
        { provide: PlausibleService, useValue: { trackEvent: plausibleEvent } },
        { provide: SegmentService, useValue: { trackEvent: segmentEvent } },
      ],
    });
  });

  it('opens a 1080px drawer on the agenda with the page injector', () => {
    const host = TestBed.createComponent(HostComponent).componentInstance;
    host.details.open(ROW, 'row');

    const [content, config] = open.mock.calls[0] as [unknown, { width: number; data: MeetingDetailsDrawerData }];
    expect(content).toBe(MeetingDetailsDrawerComponent);
    expect(config.width).toBe(1080);
    expect(config.data.row).toBe(ROW);
    expect(config.data.tab).toBe('agenda');
    expect(config.data.injector.get(MeetingsHomeDetailsService)).toBe(host.details);
  });

  it('opens on the requested tab and replaces a drawer already open', () => {
    const host = TestBed.createComponent(HostComponent).componentInstance;
    host.details.open(ROW, 'row');
    host.details.open(ROW, 'attendance', { tab: 'guests' });

    expect(refs[0].close).toHaveBeenCalled();
    expect((open.mock.calls[1][1] as { data: MeetingDetailsDrawerData }).data.tab).toBe('guests');
  });

  it('sends its own analytics event with the meeting and where it was opened from', () => {
    const host = TestBed.createComponent(HostComponent).componentInstance;
    host.details.open(ROW, 'pending_rsvps');

    const expected = ['Meeting Details Opened', { meetingId: 'synthetic-meeting', entryPoint: 'pending_rsvps' }];
    expect(plausibleEvent).toHaveBeenCalledWith(...expected);
    expect(segmentEvent).toHaveBeenCalledWith(...expected);
  });

  it('reports the series id for a past date', () => {
    const host = TestBed.createComponent(HostComponent).componentInstance;
    const past = {
      ...ROW,
      meeting: { id: 'synthetic-meeting-1762362000000', meeting_id: 'synthetic-meeting', scheduled_start_time: '2026-11-01T18:00:00Z' },
    } as unknown as MeetingHomeRow;
    host.details.open(past, 'last_card');

    expect(plausibleEvent).toHaveBeenCalledWith('Meeting Details Opened', { meetingId: 'synthetic-meeting', entryPoint: 'last_card' });
  });

  it('closes the open drawer when the page goes away', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.details.open(ROW, 'row');
    refs[0].closed.next();
    fixture.componentInstance.details.open(ROW, 'row');
    fixture.destroy();

    expect(refs[0].close).not.toHaveBeenCalled();
    expect(refs[1].close).toHaveBeenCalled();
  });

  it('steps the support launcher aside and restores the page title only when the last drawer closes', () => {
    const title = TestBed.inject(Title);
    const overlayState = TestBed.inject(OverlayStateService);
    title.setTitle('Meetings · LFX');
    const host = TestBed.createComponent(HostComponent).componentInstance;

    host.details.open(ROW, 'row');
    expect(overlayState.anyOpen()).toBe(true);
    title.setTitle('First · LFX');
    host.details.open(ROW, 'row');
    title.setTitle('Second · LFX');

    // The replaced drawer finishes closing after its successor opened.
    refs[0].closed.next();
    expect(overlayState.anyOpen()).toBe(true);
    expect(title.getTitle()).toBe('Second · LFX');

    refs[1].closed.next();
    expect(overlayState.anyOpen()).toBe(false);
    expect(title.getTitle()).toBe('Meetings · LFX');
  });

  it('leaves the title to the page the drawer navigated to', () => {
    const title = TestBed.inject(Title);
    title.setTitle('Meetings · LFX');
    const host = TestBed.createComponent(HostComponent).componentInstance;

    host.details.open(ROW, 'row');
    router.url = '/project/overview';
    title.setTitle('Overview · LFX');
    refs[0].closed.next();

    expect(title.getTitle()).toBe('Overview · LFX');
  });
});
