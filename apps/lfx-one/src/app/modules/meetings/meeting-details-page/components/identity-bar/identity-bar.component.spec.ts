// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, ParamMap, provideRouter, Router } from '@angular/router';
import { environment } from '@environments/environment';
import { Meeting, MeetingDetailsLoadStatus, PublicMeetingProject, User } from '@lfx-one/shared/interfaces';
import { LensService } from '@services/lens.service';
import { UserService } from '@services/user.service';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';
import { MeetingIdentityBarComponent } from './identity-bar.component';

const MEETING_ID = '99152950841';

describe('MeetingIdentityBarComponent', () => {
  let fixture: ComponentFixture<MeetingIdentityBarComponent>;
  let authenticated: WritableSignal<boolean>;
  let status: WritableSignal<MeetingDetailsLoadStatus>;
  let queryParamMap$: BehaviorSubject<ParamMap>;
  let setLens: ReturnType<typeof vi.fn>;
  let now: WritableSignal<Date>;

  // A start a year out, so the subtitle's status is "Upcoming" whatever day the suite runs.
  const start = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const meeting = {
    id: MEETING_ID,
    title: 'Acme Weekly Sync',
    start_time: start.toISOString(),
    duration: 60,
    occurrences: [],
    project: { uid: 'p1', name: 'Acme Project', slug: 'acme-project' } as PublicMeetingProject,
  } as unknown as Meeting & { project: PublicMeetingProject };

  async function create(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [MeetingIdentityBarComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: MeetingDetailsStateService, useValue: { status, meeting: signal(meeting), now } },
        {
          provide: UserService,
          useValue: {
            authenticated,
            impersonating: signal(false),
            user: signal({ name: 'Ada Example', email: 'ada@acme-motors.example' } as User),
            effectiveAvatarUrl: signal(''),
          },
        },
        { provide: LensService, useValue: { setLens } },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: new BehaviorSubject(convertToParamMap({ id: MEETING_ID })).asObservable(),
            queryParamMap: queryParamMap$.asObservable(),
            snapshot: {
              paramMap: convertToParamMap({ id: MEETING_ID }),
              get queryParamMap() {
                return queryParamMap$.value;
              },
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MeetingIdentityBarComponent);
    fixture.detectChanges();
  }

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  beforeEach(() => {
    authenticated = signal(true);
    status = signal<MeetingDetailsLoadStatus>('ready');
    queryParamMap$ = new BehaviorSubject<ParamMap>(convertToParamMap({}));
    setLens = vi.fn();
    now = signal(new Date());
  });

  describe('signed in', () => {
    it('offers My Meetings and the account menu, and no sign-in', async () => {
      await create();

      expect(query('meeting-identity-bar-my-meetings')).not.toBeNull();
      expect(query('meeting-identity-bar-account')?.getAttribute('aria-label')).toBe('Account menu for Ada Example');
      expect(query('meeting-identity-bar-sign-in')).toBeNull();
    });

    it('reports whether the account menu is open', async () => {
      await create();
      const account = query('meeting-identity-bar-account');
      expect(account?.getAttribute('aria-expanded')).toBe('false');
      expect(account?.getAttribute('title')).toBe('ada@acme-motors.example');

      account?.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(account?.getAttribute('aria-expanded')).toBe('true');
    });

    it('sends My Meetings to the meetings list under the Me lens', async () => {
      await create();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      query('meeting-identity-bar-my-meetings')?.click();

      expect(setLens).toHaveBeenCalledWith('me');
      expect(navigate).toHaveBeenCalledWith(['/meetings']);
    });
  });

  describe('visitor', () => {
    beforeEach(() => authenticated.set(false));

    it('offers Create LFX account and Sign in, with the sign-in prompt', async () => {
      await create();

      expect(query('meeting-identity-bar-sign-in')).not.toBeNull();
      expect(query('meeting-identity-bar-create-account')).not.toBeNull();
      expect(query('meeting-identity-bar-visitor-prompt')?.textContent?.trim()).toBe('Sign in with your LFX account to join meetings');
      expect(query('meeting-identity-bar-account')).toBeNull();
    });

    it('signs in back to this meeting', async () => {
      await create();

      expect(query('meeting-identity-bar-sign-in')?.getAttribute('href')).toBe(
        `/login?returnTo=${encodeURIComponent(`${environment.urls.home}/meetings/${MEETING_ID}`)}`
      );
    });

    // FR-013: the password and the selected occurrence both survive the round trip through login.
    it('keeps the query string, ?password= included, in returnTo', async () => {
      queryParamMap$.next(convertToParamMap({ password: 'a&b c', occurrence: '1700000000000' }));
      await create();

      const href = query('meeting-identity-bar-sign-in')?.getAttribute('href') ?? '';
      const returnTo = new URL(href, 'http://localhost').searchParams.get('returnTo') ?? '';
      const target = new URL(returnTo);

      expect(target.pathname).toBe(`/meetings/${MEETING_ID}`);
      expect(target.searchParams.get('password')).toBe('a&b c');
      expect(target.searchParams.get('occurrence')).toBe('1700000000000');
    });

    it('hides the sign-in prompt once the meeting identity takes over', async () => {
      await create();
      fixture.componentRef.setInput('condensed', true);
      fixture.detectChanges();

      const prompt = query('meeting-identity-bar-visitor-prompt');
      expect(prompt?.classList).toContain('opacity-0');
      expect(prompt?.getAttribute('aria-hidden')).toBe('true');
    });
  });

  describe('meeting identity', () => {
    it('is hidden, and out of the accessibility tree, until the page header scrolls away', async () => {
      await create();

      const identity = query('meeting-identity-bar-meeting');
      expect(identity?.classList).toContain('opacity-0');
      expect(identity?.getAttribute('aria-hidden')).toBe('true');

      fixture.componentRef.setInput('condensed', true);
      fixture.detectChanges();

      expect(identity?.classList).not.toContain('opacity-0');
      expect(identity?.getAttribute('aria-hidden')).toBe('false');
    });

    it('shows the title and a "{group} · {status}" subtitle, each with its full text as a tooltip', async () => {
      await create();

      expect(query('meeting-identity-bar-title')?.textContent?.trim()).toBe('Acme Weekly Sync');
      expect(query('meeting-identity-bar-title')?.getAttribute('title')).toBe('Acme Weekly Sync');
      expect(query('meeting-identity-bar-subtitle')?.textContent?.trim()).toBe('Acme Project · Upcoming');
      expect(query('meeting-identity-bar-subtitle')?.getAttribute('title')).toBe('Acme Project · Upcoming');
    });

    it('moves the status on as the clock passes the meeting', async () => {
      await create();

      now.set(new Date(start.getTime() + 2 * 24 * 60 * 60 * 1000));
      fixture.detectChanges();

      expect(query('meeting-identity-bar-subtitle')?.textContent?.trim()).toBe('Acme Project · Ended');
    });

    it('is absent while the page is loading, so it never shows a previous meeting', async () => {
      status.set('loading');
      await create();

      expect(query('meeting-identity-bar-meeting')).toBeNull();
      expect(query('meeting-identity-bar-home')).not.toBeNull();
    });
  });
});
