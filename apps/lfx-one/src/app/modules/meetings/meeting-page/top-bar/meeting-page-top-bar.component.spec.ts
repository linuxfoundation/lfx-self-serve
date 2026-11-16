// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Meeting, MeetingHomeRow } from '@lfx-one/shared/interfaces';
import { IntercomService } from '@services/intercom.service';
import { LensService } from '@services/lens.service';
import { UserService } from '@services/user.service';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingPageTopBarComponent } from './meeting-page-top-bar.component';

const ROW = {
  key: '123-1700000000000',
  meeting: { id: '123', title: 'Weekly sync', project_name: 'Synthetic Project' } as Meeting,
  occurrence: null,
  title: 'Weekly sync',
  occurrenceId: null,
  startTime: '2023-11-14T22:13:20Z',
  durationMinutes: 30,
} as MeetingHomeRow;

describe('MeetingPageTopBarComponent', () => {
  let setLens: ReturnType<typeof vi.fn>;
  let open: ReturnType<typeof vi.fn>;
  const authenticated = signal(true);

  const render = (): { el: HTMLElement; component: MeetingPageTopBarComponent } => {
    const fixture = TestBed.createComponent(MeetingPageTopBarComponent);
    fixture.componentRef.setInput('row', ROW);
    fixture.componentRef.setInput('past', true);
    fixture.detectChanges();
    return { el: fixture.nativeElement as HTMLElement, component: fixture.componentInstance };
  };

  beforeEach(() => {
    setLens = vi.fn();
    open = vi.fn();
    authenticated.set(true);
    TestBed.configureTestingModule({
      imports: [MeetingPageTopBarComponent],
      providers: [
        provideRouter([]),
        { provide: LensService, useValue: { setLens } },
        { provide: IntercomService, useValue: { shutdown: vi.fn() } },
        {
          provide: UserService,
          useValue: { authenticated, user: signal({ name: 'Pat Viewer', email: 'pat.viewer@example.org' }), effectiveAvatarUrl: signal('') },
        },
      ],
    });
    TestBed.overrideComponent(MeetingPageTopBarComponent, { set: { providers: [{ provide: OpenIntercomDirective, useValue: { open } }] } });
  });

  it('shows the viewer and keeps the meeting line hidden until the page scrolls past its title', () => {
    const { el } = render();

    expect(el.querySelector('[data-testid="meeting-page-account"]')?.textContent).toContain('pat.viewer@example.org');
    const meeting = el.querySelector('[data-testid="meeting-page-top-bar-meeting"]') as HTMLElement;
    expect(meeting.textContent).toContain('Weekly sync');
    expect(meeting.textContent).toContain('Synthetic Project');
    expect(meeting.getAttribute('aria-hidden')).toBe('true');
    expect(meeting.hasAttribute('inert')).toBe(true);
    const account = el.querySelector('[data-testid="meeting-page-account"]') as HTMLElement;
    // The name labels the button only by reference, so it never sits in an unmasked attribute.
    expect(account.getAttribute('aria-label')).toBeNull();
    expect(
      account
        .getAttribute('aria-labelledby')!
        .split(' ')
        .map((id) => el.querySelector(`#${id}`)?.textContent?.trim())
    ).toEqual(['Pat Viewer', 'account menu']);
    expect(el.querySelector('#meeting-page-account-name')!.closest('[data-dd-privacy="mask"]')).not.toBeNull();
  });

  it('opens My Meetings on the Me lens', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const { el } = render();

    (el.querySelector('[data-testid="meeting-page-my-meetings"] button') as HTMLButtonElement).click();

    expect(setLens).toHaveBeenCalledWith('me');
    expect(navigate).toHaveBeenCalledWith(['/meetings']);
  });

  it('opens support from the account menu without a click', () => {
    const { component } = render();

    (component as unknown as { openSupport(): void }).openSupport();

    expect(open).toHaveBeenCalledTimes(1);
  });

  it('offers a signed-out visitor Sign in and Create LFX account, both back to this page', () => {
    authenticated.set(false);
    vi.spyOn(TestBed.inject(Router), 'url', 'get').mockReturnValue('/meetings/123?password=secret');
    const { el, component } = render();
    const view = component as unknown as { signIn(): void; signInUrl(): string };
    const signIn = vi.spyOn(view, 'signIn').mockImplementation(() => undefined);

    expect(el.querySelector('[data-testid="meeting-page-account"]')).toBeNull();
    expect(el.querySelector('[data-testid="meeting-page-signed-out"]')?.textContent).toContain('Sign in with your LFX account to join meetings');
    (el.querySelector('[data-testid="meeting-page-sign-in"] button') as HTMLButtonElement).click();
    (el.querySelector('[data-testid="meeting-page-create-account"] button') as HTMLButtonElement).click();

    expect(signIn).toHaveBeenCalledTimes(2);
    expect(view.signInUrl()).toBe('/login?returnTo=%2Fmeetings%2F123%3Fpassword%3Dsecret');
  });
});
