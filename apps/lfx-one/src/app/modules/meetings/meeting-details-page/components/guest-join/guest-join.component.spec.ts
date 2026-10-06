// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Meeting, MeetingJoinUrlState, User } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { Observable, of, Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';
import { MeetingJoinUrlService } from '../../meeting-join-url.service';
import { MeetingGuestJoinComponent } from './guest-join.component';

const ZOOM_LINK = 'https://zoom.example/j/99152950841';
// The form's fetch is debounced by 300ms, as V1's is.
const debounce = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 350));

describe('MeetingGuestJoinComponent', () => {
  let fixture: ComponentFixture<MeetingGuestJoinComponent>;
  let fetch: ReturnType<typeof vi.fn>;

  function create(options: { platform?: 'browser' | 'server'; response?: () => Observable<MeetingJoinUrlState>; user?: User | null } = {}): void {
    fetch = vi.fn().mockImplementation(options.response ?? (() => of<MeetingJoinUrlState>({ status: 'ready', url: ZOOM_LINK })));
    TestBed.configureTestingModule({
      imports: [MeetingGuestJoinComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: options.platform ?? 'browser' },
        { provide: MeetingDetailsStateService, useValue: { meeting: signal({ id: '99152950841', password: 'secret' } as Meeting) } },
        { provide: MeetingJoinUrlService, useValue: { fetch } },
        { provide: UserService, useValue: { user: signal(options.user ?? null) } },
      ],
    });
    fixture = TestBed.createComponent(MeetingGuestJoinComponent);
    fixture.detectChanges();
  }

  afterEach(() => vi.restoreAllMocks());

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const input = (testId: string): HTMLInputElement => query(testId)?.querySelector('input') as HTMLInputElement;
  const button = (): HTMLElement | null => query('meeting-guest-join-button');

  function type(testId: string, value: string): void {
    const field = input(testId);
    field.value = value;
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  async function fillIn(email = 'grace@acme-motors.example'): Promise<void> {
    type('meeting-guest-join-name', 'Grace Example');
    type('meeting-guest-join-email', email);
    type('meeting-guest-join-organization', 'Acme Motors');
    await debounce();
    fixture.detectChanges();
  }

  it('keeps Join disabled, and fetches nothing, until the form is valid', async () => {
    create();
    type('meeting-guest-join-name', 'Grace Example');
    await debounce();
    fixture.detectChanges();

    expect(button()?.getAttribute('data-state')).toBe('idle');
    expect(button()?.querySelector('button')?.disabled).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fetches with the typed email and joins with the typed name and organization as the Zoom display name', async () => {
    create();
    await fillIn();

    expect(fetch).toHaveBeenCalledWith('99152950841', 'secret', 'grace@acme-motors.example');
    const link = button()?.querySelector('a');
    expect(button()?.getAttribute('data-state')).toBe('ready');
    expect(link?.getAttribute('href')).toContain(ZOOM_LINK);
    expect(decodeURIComponent(link?.getAttribute('href') ?? '')).toContain('Grace Example');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('refetches when the email changes, but not when the name does', async () => {
    create();
    await fillIn();
    type('meeting-guest-join-name', 'Grace Q. Example');
    await debounce();
    expect(fetch).toHaveBeenCalledTimes(1);

    type('meeting-guest-join-email', 'grace@vendor-corp.example');
    await debounce();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('shows loading while the link is in flight', async () => {
    const pending = new Subject<MeetingJoinUrlState>();
    create({ response: () => pending.pipe() });
    await fillIn();
    pending.next({ status: 'loading' });
    fixture.detectChanges();

    expect(button()?.getAttribute('data-state')).toBe('loading');
  });

  // FR-025: on a restricted meeting the server matches the email; a mismatch is explained, and the
  // viewer can try another address.
  it('explains a NOT_REGISTERED_FOR_MEETING answer as the email missing from the invite list', async () => {
    create({ response: () => of<MeetingJoinUrlState>({ status: 'error', error: 'Not registered', code: 'NOT_REGISTERED_FOR_MEETING' }) });
    await fillIn();

    expect(query('meeting-guest-join-error')?.getAttribute('role')).toBe('alert');
    expect(query('meeting-guest-join-error')?.textContent).toContain("This email is not on the meeting's invite list.");
  });

  it('starts the name from a signed-in viewer, for the different-email path', () => {
    create({ user: { name: 'Ada Example', email: 'ada@acme-motors.example' } as User });

    expect(input('meeting-guest-join-name').value).toBe('Ada Example');
    expect(input('meeting-guest-join-email').value).toBe('');
  });

  // The URL builder trims the name, so spaces alone would join with no display name.
  it('rejects a name that is only whitespace', async () => {
    create();
    type('meeting-guest-join-name', '   ');
    type('meeting-guest-join-email', 'grace@acme-motors.example');
    await debounce();
    fixture.detectChanges();

    expect(fetch).not.toHaveBeenCalled();
    expect(button()?.getAttribute('data-state')).toBe('idle');
  });

  it('holds Join again when a field turns invalid after the link resolved', async () => {
    create();
    await fillIn();
    expect(button()?.getAttribute('data-state')).toBe('ready');

    type('meeting-guest-join-name', '');

    expect(button()?.getAttribute('data-state')).toBe('idle');
  });

  it('marks the required fields for assistive tech, and explains an invalid email', () => {
    create();
    type('meeting-guest-join-email', 'not-an-email');

    expect(input('meeting-guest-join-name').getAttribute('aria-required')).toBe('true');
    expect(input('meeting-guest-join-email').getAttribute('aria-required')).toBe('true');
    expect(query('meeting-guest-join-email-hint')?.textContent?.trim()).toBe('Enter a valid email address.');
    expect(input('meeting-guest-join-email').getAttribute('aria-describedby')).toBe('meeting-guest-join-email-hint');
  });

  it('ties the mismatch answer to the email field', async () => {
    create({ response: () => of<MeetingJoinUrlState>({ status: 'error', error: 'Not registered', code: 'NOT_REGISTERED_FOR_MEETING' }) });
    await fillIn();

    expect(input('meeting-guest-join-email').getAttribute('aria-describedby')).toBe('meeting-guest-join-error');
  });

  it('labels every field', () => {
    create();

    for (const id of ['meeting-guest-join-name', 'meeting-guest-join-email', 'meeting-guest-join-organization']) {
      expect(fixture.nativeElement.querySelector(`label[for="${id}"]`)).not.toBeNull();
      expect(fixture.nativeElement.querySelector(`#${id}`)?.tagName).toBe('INPUT');
    }
  });

  it('renders an idle form on the server, without fetching', async () => {
    create({ platform: 'server' });
    await fillIn();

    expect(button()?.getAttribute('data-state')).toBe('idle');
    expect(fetch).not.toHaveBeenCalled();
  });
});
