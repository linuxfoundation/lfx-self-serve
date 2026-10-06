// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { Meeting, User } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, MockInstance, vi } from 'vitest';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';
import { MeetingJoinActionComponent } from './join-action.component';

const ZOOM_LINK = 'https://zoom.example/j/99152950841';

describe('MeetingJoinActionComponent', () => {
  let fixture: ComponentFixture<MeetingJoinActionComponent>;
  let getPublicMeetingJoinUrl: ReturnType<typeof vi.fn>;
  let add: ReturnType<typeof vi.fn>;
  let user: WritableSignal<User | null>;
  let open: MockInstance<typeof window.open>;

  function create(options: { platform?: 'browser' | 'server'; response?: unknown; zoomRedirect?: string } = {}): void {
    getPublicMeetingJoinUrl = vi.fn().mockReturnValue(options.response ?? of({ link: ZOOM_LINK }));
    add = vi.fn();
    user = signal<User | null>({ name: 'Ada Example', email: 'ada@acme-motors.example' } as User);
    open = vi.spyOn(window, 'open').mockReturnValue(null);

    TestBed.configureTestingModule({
      imports: [MeetingJoinActionComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: options.platform ?? 'browser' },
        { provide: MeetingDetailsStateService, useValue: { meeting: signal({ id: '99152950841', password: 'secret' } as Meeting) } },
        { provide: MeetingService, useValue: { getPublicMeetingJoinUrl } },
        { provide: UserService, useValue: { user, authenticated: signal(true) } },
        { provide: MessageService, useValue: { add } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(options.zoomRedirect ? { zoom_redirect: options.zoomRedirect } : {}) } },
        },
      ],
    });

    fixture = TestBed.createComponent(MeetingJoinActionComponent);
    fixture.detectChanges();
  }

  afterEach(() => vi.restoreAllMocks());

  const button = (): HTMLElement | null => fixture.nativeElement.querySelector('[data-testid="meeting-action-join-button"]');
  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  it('renders the loading state on the server, without fetching', () => {
    create({ platform: 'server' });

    expect(button()?.getAttribute('data-state')).toBe('loading');
    expect(getPublicMeetingJoinUrl).not.toHaveBeenCalled();
  });

  it("stays loading while the join URL is in flight, fetched with the viewer's email", () => {
    create({ response: new Subject() });

    expect(button()?.getAttribute('data-state')).toBe('loading');
    expect(getPublicMeetingJoinUrl).toHaveBeenCalledWith('99152950841', 'secret', { email: 'ada@acme-motors.example' });
  });

  it('links to the meeting in a new tab once the URL resolves', () => {
    create();

    const link = button()?.querySelector('a');
    expect(button()?.getAttribute('data-state')).toBe('ready');
    expect(link?.getAttribute('href')).toContain(ZOOM_LINK);
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  describe('auto-join', () => {
    it('opens the meeting once, as V1 does', () => {
      create();
      fixture.detectChanges();

      expect(open).toHaveBeenCalledTimes(1);
      expect(open.mock.calls[0][0]).toContain(ZOOM_LINK);
      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: 'Meeting Opened' }));
    });

    it('stays off with ?zoom_redirect=false', () => {
      create({ zoomRedirect: 'FALSE' });

      expect(open).not.toHaveBeenCalled();
    });

    it('reports a blocked popup', () => {
      create({ response: new Subject() });
      open.mockReturnValue({ closed: true } as Window);
      (getPublicMeetingJoinUrl.mock.results[0].value as Subject<unknown>).next({ link: ZOOM_LINK });
      fixture.detectChanges();

      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', summary: 'Popup Blocked' }));
    });
  });

  describe('errors', () => {
    it("shows the BFF's message and retries on request", () => {
      create({ response: throwError(() => ({ error: { error: 'Meeting not joinable yet' } })) });

      expect(button()?.getAttribute('data-state')).toBe('error');
      expect(query('meeting-action-join-error')?.getAttribute('role')).toBe('alert');
      expect(query('meeting-action-join-error')?.textContent).toContain('Meeting not joinable yet');

      getPublicMeetingJoinUrl.mockReturnValue(of({ link: ZOOM_LINK }));
      query('meeting-action-join-retry')?.click();
      fixture.detectChanges();

      expect(getPublicMeetingJoinUrl).toHaveBeenCalledTimes(2);
      expect(button()?.getAttribute('data-state')).toBe('ready');
    });

    it("explains a NOT_REGISTERED_FOR_MEETING error as the viewer's email missing from the invite list", () => {
      create({ response: throwError(() => ({ error: { error: 'Not registered', code: 'NOT_REGISTERED_FOR_MEETING' } })) });

      expect(query('meeting-action-join-error')?.textContent).toContain("Your account's email is not on this meeting's invite list.");
    });

    it('treats a response without a link as an error, not a button that never loads', () => {
      create({ response: of({}) });

      expect(button()?.getAttribute('data-state')).toBe('error');
      expect(query('meeting-action-join-error')?.textContent).toContain('Failed to load meeting join URL. Please try again.');
    });

    it('falls back to a generic message', () => {
      create({ response: throwError(() => ({ status: 500 })) });

      expect(query('meeting-action-join-error')?.textContent).toContain('Failed to load meeting join URL. Please try again.');
    });
  });
});
