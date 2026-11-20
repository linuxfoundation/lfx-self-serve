// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsSubscribeDialogComponent } from './meetings-subscribe-dialog.component';

const FEED = 'https://app.example.test/public/api/projects/project-1/calendar.ics';

describe('MeetingsSubscribeDialogComponent', () => {
  let copy: ReturnType<typeof vi.fn<(text: string) => boolean>>;
  let show: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    copy = vi.fn<(text: string) => boolean>(() => true);
    show = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: DIALOG_DATA, useValue: { feedUrl: FEED, name: 'Synthetic Foundation' } },
        { provide: DialogRef, useValue: { id: 'subscribe', close: vi.fn() } },
        { provide: Clipboard, useValue: { copy } },
        { provide: UiToastService, useValue: { show } },
      ],
    });
  });

  const render = async (): Promise<ComponentFixture<MeetingsSubscribeDialogComponent>> => {
    const fixture = TestBed.createComponent(MeetingsSubscribeDialogComponent);
    await fixture.whenStable();
    return fixture;
  };
  const query = (fixture: ComponentFixture<MeetingsSubscribeDialogComponent>, testId: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  it('titles the dialog and names the project', async () => {
    const fixture = await render();

    expect(query(fixture, 'ui-modal-title')?.textContent?.trim()).toBe('Subscribe to calendar');
    expect(query(fixture, 'ui-modal-subtitle')?.textContent?.trim()).toBe(
      'Add Synthetic Foundation meetings to your calendar. New and updated meetings sync automatically.'
    );
  });

  it('shows the feed in a read-only field and copies it with a toast', async () => {
    const fixture = await render();
    const input = query(fixture, 'meetings-subscribe-dialog-feed')?.querySelector('input');
    expect(input?.value).toBe(FEED);
    expect(input?.readOnly).toBe(true);
    expect(input?.disabled).toBe(false);

    query(fixture, 'meetings-subscribe-dialog-copy')?.querySelector('button')?.click();

    expect(copy).toHaveBeenCalledWith(FEED);
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ message: 'Feed URL copied', description: 'Paste it into any calendar app to subscribe.' }));
  });

  it('reports a failed copy', async () => {
    copy.mockReturnValue(false);
    const fixture = await render();

    query(fixture, 'meetings-subscribe-dialog-copy')?.querySelector('button')?.click();

    expect(show).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }));
  });

  it('links each calendar app to the real feed', async () => {
    const fixture = await render();
    const link = (key: string): HTMLAnchorElement | null => query(fixture, `meetings-subscribe-dialog-app-${key}`) as HTMLAnchorElement | null;

    expect(['google', 'outlookLive', 'outlook365', 'apple'].map((key) => link(key)?.textContent?.trim())).toEqual([
      'Google Calendar',
      'Outlook.com',
      'Outlook 365',
      'Apple Calendar',
    ]);
    expect(link('google')?.getAttribute('href')).toBe(
      `https://calendar.google.com/calendar/r?cid=${encodeURIComponent('webcal://app.example.test/public/api/projects/project-1/calendar.ics')}`
    );
    expect(link('outlookLive')?.getAttribute('href')).toBe(
      `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(FEED)}&name=Synthetic%20Foundation`
    );
    expect(link('outlook365')?.getAttribute('href')).toContain('https://outlook.office.com/calendar/0/addfromweb?url=');
    expect(link('apple')?.getAttribute('href')).toBe('webcal://app.example.test/public/api/projects/project-1/calendar.ics');
    expect(link('google')?.getAttribute('target')).toBe('_blank');
    expect(link('google')?.getAttribute('rel')).toBe('noopener noreferrer');
    // webcal:// hands off to the OS calendar app, so it opens in place.
    expect(link('apple')?.getAttribute('target')).toBeNull();
  });
});
