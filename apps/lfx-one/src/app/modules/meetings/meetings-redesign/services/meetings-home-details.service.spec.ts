// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { Meeting, MeetingDetailsDrawerData, MeetingHomeRow } from '@lfx-one/shared/interfaces';
import { OverlayStateService } from '@services/overlay-state.service';
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

  beforeEach(() => {
    refs = [];
    open = vi.fn(() => {
      const ref = { close: vi.fn(), closed: new Subject<void>() };
      refs.push(ref);
      return ref;
    });
    router = { url: '/meetings' };
    TestBed.configureTestingModule({
      providers: [
        { provide: UiDrawerService, useValue: { open } },
        { provide: Router, useValue: router },
      ],
    });
  });

  it('opens a 1080px drawer on the agenda with the page injector', () => {
    const host = TestBed.createComponent(HostComponent).componentInstance;
    host.details.open(ROW);

    const [content, config] = open.mock.calls[0] as [unknown, { width: number; data: MeetingDetailsDrawerData }];
    expect(content).toBe(MeetingDetailsDrawerComponent);
    expect(config.width).toBe(1080);
    expect(config.data.row).toBe(ROW);
    expect(config.data.tab).toBe('agenda');
    expect(config.data.injector.get(MeetingsHomeDetailsService)).toBe(host.details);
  });

  it('opens on the requested tab and replaces a drawer already open', () => {
    const host = TestBed.createComponent(HostComponent).componentInstance;
    host.details.open(ROW);
    host.details.open(ROW, { tab: 'guests' });

    expect(refs[0].close).toHaveBeenCalled();
    expect((open.mock.calls[1][1] as { data: MeetingDetailsDrawerData }).data.tab).toBe('guests');
  });

  it('closes the open drawer when the page goes away', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.details.open(ROW);
    refs[0].closed.next();
    fixture.componentInstance.details.open(ROW);
    fixture.destroy();

    expect(refs[0].close).not.toHaveBeenCalled();
    expect(refs[1].close).toHaveBeenCalled();
  });

  it('steps the support launcher aside and restores the page title only when the last drawer closes', () => {
    const title = TestBed.inject(Title);
    const overlayState = TestBed.inject(OverlayStateService);
    title.setTitle('Meetings · LFX');
    const host = TestBed.createComponent(HostComponent).componentInstance;

    host.details.open(ROW);
    expect(overlayState.anyOpen()).toBe(true);
    title.setTitle('First · LFX');
    host.details.open(ROW);
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

    host.details.open(ROW);
    router.url = '/project/overview';
    title.setTitle('Overview · LFX');
    refs[0].closed.next();

    expect(title.getTitle()).toBe('Overview · LFX');
  });
});
