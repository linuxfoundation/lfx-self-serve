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
  let meeting: WritableSignal<Meeting>;
  let autoJoined: Set<string>;
  let open: MockInstance<typeof window.open>;

  function create(options: { platform?: 'browser' | 'server'; response?: unknown; zoomRedirect?: string } = {}): void {
    getPublicMeetingJoinUrl = vi.fn().mockReturnValue(options.response ?? of({ link: ZOOM_LINK }));
    add = vi.fn();
    user = signal<User | null>({ name: 'Ada Example', email: 'ada@acme-motors.example' } as User);
    meeting = signal({ id: '99152950841', password: 'secret' } as Meeting);
    autoJoined = new Set<string>();
    open = vi.spyOn(window, 'open').mockReturnValue(null);

    TestBed.configureTestingModule({
      imports: [MeetingJoinActionComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: options.platform ?? 'browser' },
        {
          provide: MeetingDetailsStateService,
          useValue: { meeting, claimAutoJoin: (id: string) => !autoJoined.has(id) && !!autoJoined.add(id) },
        },
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

  // A new meeting object for the same meeting (a `?occurrence=` change, a refresh) keeps the link.
  it('does not refetch when the meeting object changes but the meeting does not', () => {
    create();
    meeting.set({ id: '99152950841', password: 'secret', title: 'Renamed' } as Meeting);
    fixture.detectChanges();

    expect(getPublicMeetingJoinUrl).toHaveBeenCalledTimes(1);
    expect(button()?.getAttribute('data-state')).toBe('ready');
  });

  describe('auto-join', () => {
    it('opens the meeting once, as V1 does, and points at the Join button in case it was blocked', () => {
      create();
      fixture.detectChanges();

      expect(open).toHaveBeenCalledTimes(1);
      expect(open.mock.calls[0][0]).toContain(ZOOM_LINK);
      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'info', summary: 'Opening the meeting' }));
    });

    // The attempt is the page's: a remounted Join control does not open the meeting again.
    it('does not open the meeting again when the slot remounts', () => {
      create();
      fixture.detectChanges();
      fixture.destroy();

      const remounted = TestBed.createComponent(MeetingJoinActionComponent);
      remounted.detectChanges();
      remounted.detectChanges();

      expect(open).toHaveBeenCalledTimes(1);
    });

    it('stays off with ?zoom_redirect=false', () => {
      create({ zoomRedirect: 'FALSE' });
      fixture.detectChanges();

      // Same flushes as the positive case, so only the zoom_redirect check keeps the tab closed.
      expect(button()?.getAttribute('data-state')).toBe('ready');
      expect(open).not.toHaveBeenCalled();
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

    // V1's escape hatch (E2-06): join with another email through the guest form.
    it('offers joining with a different email, through the guest form that replaces the account error', () => {
      create({ response: throwError(() => ({ error: { error: 'Not registered', code: 'NOT_REGISTERED_FOR_MEETING' } })) });
      expect(query('meeting-guest-join-form')).toBeNull();

      query('meeting-action-join-different-email')?.click();
      fixture.detectChanges();

      expect(query('meeting-guest-join-form')).not.toBeNull();
      // V1 clears the account's error: no second Join, error or retry to fight the form.
      expect(query('meeting-action-join-error')).toBeNull();
      expect(query('meeting-action-join-retry')).toBeNull();
      expect(button()).toBeNull();
      expect(document.activeElement?.id).toBe('meeting-guest-join-name');
    });

    it('joins with the typed email on that path, and never auto-joins the account', async () => {
      create({ response: throwError(() => ({ error: { error: 'Not registered', code: 'NOT_REGISTERED_FOR_MEETING' } })) });
      query('meeting-action-join-different-email')?.click();
      fixture.detectChanges();
      getPublicMeetingJoinUrl.mockReturnValue(of({ link: ZOOM_LINK }));

      const field = (id: string, value: string): void => {
        const el = fixture.nativeElement.querySelector(`#${id}`) as HTMLInputElement;
        el.value = value;
        el.dispatchEvent(new Event('input'));
      };
      field('meeting-guest-join-name', 'Ada Example');
      field('meeting-guest-join-email', 'ada.personal@acme-motors.example');
      fixture.detectChanges();
      await new Promise((resolve) => setTimeout(resolve, 350));
      fixture.detectChanges();

      expect(getPublicMeetingJoinUrl).toHaveBeenLastCalledWith('99152950841', 'secret', { email: 'ada.personal@acme-motors.example' });
      expect(fixture.nativeElement.querySelector('[data-testid="meeting-guest-join-button"]')?.getAttribute('data-state')).toBe('ready');
      expect(open).not.toHaveBeenCalled();
    });

    it('does not offer a different email for other errors', () => {
      create({ response: throwError(() => ({ error: { error: 'Meeting not joinable yet' } })) });

      expect(query('meeting-action-join-different-email')).toBeNull();
    });

    it('treats a response without a link as an error, not a button that never loads', () => {
      create({ response: of({}) });

      expect(button()?.getAttribute('data-state')).toBe('error');
      expect(query('meeting-action-join-error')?.textContent).toContain('Failed to load meeting join URL. Please try again.');
    });

    it('refuses a link that is not http(s)', () => {
      create({ response: of({ link: 'javascript:alert(1)' }) });
      fixture.detectChanges();

      expect(button()?.getAttribute('data-state')).toBe('error');
      expect(fixture.nativeElement.querySelector('a[href^="javascript"]')).toBeNull();
      expect(open).not.toHaveBeenCalled();
    });

    it('falls back to a generic message', () => {
      create({ response: throwError(() => ({ status: 500 })) });

      expect(query('meeting-action-join-error')?.textContent).toContain('Failed to load meeting join URL. Please try again.');
    });
  });
});
