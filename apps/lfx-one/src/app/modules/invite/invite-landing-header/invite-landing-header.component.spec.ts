// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UserService } from '@services/user.service';
import { describe, expect, it } from 'vitest';

import { InviteLandingHeaderComponent } from './invite-landing-header.component';

describe('InviteLandingHeaderComponent', () => {
  function createFixture(authenticated: boolean): ComponentFixture<InviteLandingHeaderComponent> {
    TestBed.configureTestingModule({
      imports: [InviteLandingHeaderComponent],
      providers: [{ provide: UserService, useValue: { authenticated: signal(authenticated) } }],
    });

    const fixture = TestBed.createComponent(InviteLandingHeaderComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('always renders a full-page home link', () => {
    const fixture = createFixture(false);
    const home = fixture.nativeElement.querySelector('[data-testid="invite-home-link"]') as HTMLAnchorElement | null;

    expect(home).not.toBeNull();
    expect(home?.getAttribute('href')).toBe('/');
  });

  it('shows the logout link only when authenticated', () => {
    const signedOut = createFixture(false);
    expect(signedOut.nativeElement.querySelector('[data-testid="invite-logout-link"]')).toBeNull();

    TestBed.resetTestingModule();
    const signedIn = createFixture(true);
    const logout = signedIn.nativeElement.querySelector('[data-testid="invite-logout-link"]') as HTMLAnchorElement | null;

    expect(logout).not.toBeNull();
    expect(logout?.getAttribute('href')).toBe('/logout');
  });
});
