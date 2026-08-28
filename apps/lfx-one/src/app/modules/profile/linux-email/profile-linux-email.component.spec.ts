// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { LINUX_EMAIL_FORWARD_REAUTH_KEY } from '@lfx-one/shared/constants';
import { LinuxAliasData } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfileLinuxEmailComponent } from './profile-linux-email.component';

/**
 * Guards issue #1935 — the "Forward to" select rendering blank with no explanation when a
 * claimed alias's forward target can't be read without a Flow C management token. The panel
 * must swap the select for a re-auth action instead, and the FORWARD_SET_FAILED /
 * forward-genuinely-unset path (which does NOT set forwardAuthRequired) must keep working —
 * that's the path the issue's literal fix (gating on forwardTo === null) would have broken.
 */
describe('ProfileLinuxEmailComponent — forward re-auth state (#1935)', () => {
  const REAUTH_FLAG_KEY = LINUX_EMAIL_FORWARD_REAUTH_KEY;

  const claimedNeedsReauth: LinuxAliasData = {
    state: 'claimed',
    domain: 'linux.com',
    alias: 'jsmith',
    email: 'jsmith@linux.com',
    forwardTo: null,
    primaryEmail: 'jsmith@example.org',
    forwardAuthRequired: true,
    authorizeUrl: 'https://app.dev.lfx.dev/api/profile/auth/start?returnTo=/profile/identities',
  };

  const claimedForwardUnset: LinuxAliasData = {
    state: 'claimed',
    domain: 'linux.com',
    alias: 'jsmith',
    email: 'jsmith@linux.com',
    forwardTo: null,
    primaryEmail: 'jsmith@example.org',
  };

  const claimedWithForward: LinuxAliasData = {
    state: 'claimed',
    domain: 'linux.com',
    alias: 'jsmith',
    email: 'jsmith@linux.com',
    forwardTo: 'jsmith@example.org',
    primaryEmail: 'jsmith@example.org',
  };

  async function setup(alias: LinuxAliasData): Promise<{ fixture: ComponentFixture<ProfileLinuxEmailComponent>; locationHref: () => string }> {
    const hrefState = { value: 'https://app.dev.lfx.dev/profile/identities' };
    // jsdom throws on a bare `window.location.href = …` navigation; stub the setter so the
    // redirect is observable instead of erroring the test.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        get href() {
          return hrefState.value;
        },
        set href(v: string) {
          hrefState.value = v;
        },
      },
    });

    const userServiceMock = {
      impersonating: signal(false),
      getLinuxAlias: vi.fn(() => of(alias)),
    };

    TestBed.configureTestingModule({
      imports: [ProfileLinuxEmailComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: UserService, useValue: userServiceMock },
        // p-toast (rendered by the template) subscribes to MessageService's real Subjects on
        // init — a plain { add: vi.fn() } mock leaves them undefined and throws there.
        MessageService,
        // lfx-button's p-button always binds [routerLink], which injects ActivatedRoute even
        // when the input is undefined; lfx-message's p-message plays a synthetic animation.
        provideRouter([]),
        provideNoopAnimations(),
      ],
    });

    const fixture = TestBed.createComponent(ProfileLinuxEmailComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return { fixture, locationHref: () => hrefState.value };
  }

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
  });

  it('shows the re-auth panel (not the select) when the guard is already set, with the control left empty', async () => {
    sessionStorage.setItem(REAUTH_FLAG_KEY, '1');
    const { fixture, locationHref } = await setup(claimedNeedsReauth);
    const component = fixture.componentInstance;

    expect(component.forwardReauthRequired()).toBe(true);
    expect(component.editForm.controls.forwardTo.value).toBe('');
    // Guard already latched — no further automatic redirect.
    expect(locationHref()).toBe('https://app.dev.lfx.dev/profile/identities');

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[data-testid="linux-email-forward-reauth"]')).toBeTruthy();
    expect(compiled.querySelector('[data-testid="linux-email-forward-select"]')).toBeFalsy();
  });

  it('redirects once to authorizeUrl when the guard is unset, and latches it', async () => {
    const { locationHref } = await setup(claimedNeedsReauth);

    expect(locationHref()).toBe(claimedNeedsReauth.authorizeUrl);
    expect(sessionStorage.getItem(REAUTH_FLAG_KEY)).toBe('1');
  });

  it('reauthorizeForward() navigates to authorizeUrl and leaves the guard intact', async () => {
    sessionStorage.setItem(REAUTH_FLAG_KEY, '1');
    const { fixture, locationHref } = await setup(claimedNeedsReauth);

    fixture.componentInstance.reauthorizeForward();

    expect(locationHref()).toBe(claimedNeedsReauth.authorizeUrl);
    // Regression guard: clearing this here would reopen the automatic-redirect loop
    // maybeReauthForForward exists to prevent.
    expect(sessionStorage.getItem(REAUTH_FLAG_KEY)).toBe('1');
  });

  it('keeps the select usable when the forward is genuinely unset (no forwardAuthRequired)', async () => {
    const { fixture } = await setup(claimedForwardUnset);
    const component = fixture.componentInstance;

    expect(component.forwardReauthRequired()).toBe(false);
    expect(component.forwardNotSet()).toBe(true);

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[data-testid="linux-email-forward-select"]')).toBeTruthy();
    expect(compiled.querySelector('[data-testid="linux-email-forward-reauth"]')).toBeFalsy();
  });

  it('excludes the alias itself from forwardOptions and shows the empty state with no other verified email', async () => {
    const { fixture } = await setup({ ...claimedForwardUnset, primaryEmail: claimedForwardUnset.email });
    const component = fixture.componentInstance;

    expect(component.forwardOptions()).toEqual([]);
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[data-testid="linux-email-forward-empty"]')).toBeTruthy();
    expect(compiled.querySelector('[data-testid="linux-email-forward-select"]')).toBeFalsy();
  });

  it('selects the real forward target when one is present, with no dirty state', async () => {
    const { fixture } = await setup(claimedWithForward);
    const component = fixture.componentInstance;

    expect(component.forwardReauthRequired()).toBe(false);
    expect(component.forwardNotSet()).toBe(false);
    expect(component.editForm.controls.forwardTo.value).toBe('jsmith@example.org');
    expect(component.forwardDirty()).toBe(false);
  });
});
