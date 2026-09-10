// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { EnrichedIdentity } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { EMPTY, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfileIdentitiesComponent } from './profile-identities.component';

/**
 * Guards issue #1935's ownership split: Flow C (/passwordless/callback) error codes are already
 * toasted once by ProfileLayoutComponent (alive on this route) — this component must skip them
 * rather than toast a second time, and keep owning the identity-link (social auth) codes.
 */
describe('ProfileIdentitiesComponent — Flow C vs identity-link error ownership (#1935)', () => {
  async function setup(queryParams: Record<string, string>): Promise<{ fixture: ComponentFixture<ProfileIdentitiesComponent>; add: ReturnType<typeof vi.fn> }> {
    const add = vi.fn();
    const userServiceMock = {
      impersonating: signal(false),
      identitiesRefresh$: EMPTY,
      getIdentities: vi.fn(() => of([])),
      getMeetingInviteEmail: vi.fn(() => of({ email_id: null, email: null })),
      refreshUserIdentities: vi.fn(),
    };

    TestBed.configureTestingModule({
      imports: [ProfileIdentitiesComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParams } } },
        { provide: UserService, useValue: userServiceMock },
        { provide: MessageService, useValue: { add } },
        { provide: DialogService, useValue: { open: vi.fn() } },
      ],
    });
    // Empty template: exercise ngOnInit's error handling without the dialog/panel child graph.
    TestBed.overrideComponent(ProfileIdentitiesComponent, { set: { template: '', imports: [] } });

    const fixture = TestBed.createComponent(ProfileIdentitiesComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return { fixture, add };
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('does not toast a Flow C (profile-auth) code — the layout owns it', async () => {
    const { add } = await setup({ error: 'profile_auth_failed' });
    expect(add).not.toHaveBeenCalled();
  });

  it('toasts the specific message for a social-auth-owned code', async () => {
    const { add } = await setup({ error: 'social_auth_failed' });
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: 'Social authentication failed. Please try again.' }));
  });

  // invalid_state/no_code moved into PROFILE_AUTH_ERROR_MESSAGES (owned by the layout) so a
  // failure toasts on every /profile/* route, not just this tab — this component must now skip
  // them the same as any other Flow C code.
  it('does not toast invalid_state — the layout owns it', async () => {
    const { add } = await setup({ error: 'invalid_state' });
    expect(add).not.toHaveBeenCalled();
  });

  it('does not toast no_code — the layout owns it', async () => {
    const { add } = await setup({ error: 'no_code' });
    expect(add).not.toHaveBeenCalled();
  });

  it('falls back to the generic message for an unmapped code', async () => {
    const { add } = await setup({ error: 'zzz_unknown' });
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: 'An error occurred. Please try again.' }));
  });

  it('treats an inherited Object.prototype key as unmapped rather than a truthy hit', async () => {
    // Regression guard: without an own-property check, 'toString' would resolve to
    // Object.prototype.toString in both maps — wrongly suppressing the toast here.
    const { add } = await setup({ error: 'toString' });
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: 'An error occurred. Please try again.' }));
  });

  it('does not toast for an empty error param', async () => {
    // Regression guard: `typeof params['error'] === 'string'` alone is true for '' — the
    // truthiness check must survive alongside it, or a bare ?error= starts toasting/clearing.
    const { add } = await setup({ error: '' });
    expect(add).not.toHaveBeenCalled();
  });
});

/**
 * Guards the Remove-guard's identity match (Copilot review, PR #1073): it must key off `type`
 * (not `provider`), match case-insensitively, leave non-email identities removable even when
 * their identifier coincidentally matches, and fail closed — protect every email identity —
 * when the invite fetch itself failed.
 */
describe('ProfileIdentitiesComponent — meeting-invite Remove guard (Copilot review, PR #1073)', () => {
  function makeIdentity(overrides: Partial<EnrichedIdentity> & Pick<EnrichedIdentity, 'id' | 'type' | 'value'>): EnrichedIdentity {
    return {
      platform: 'email',
      verified: true,
      source: 'cdp',
      icon: 'fa-light fa-envelope',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      displayState: 'verified',
      inAuth0: false,
      ...overrides,
    };
  }

  async function setup(identities: EnrichedIdentity[], invite: { email: string | null } | 'error'): Promise<ComponentFixture<ProfileIdentitiesComponent>> {
    const userServiceMock = {
      impersonating: signal(false),
      identitiesRefresh$: EMPTY,
      getIdentities: vi.fn(() => of(identities)),
      getMeetingInviteEmail: vi.fn(() => (invite === 'error' ? throwError(() => new Error('nats down')) : of({ email_id: null, ...invite }))),
      refreshUserIdentities: vi.fn(),
    };

    TestBed.configureTestingModule({
      imports: [ProfileIdentitiesComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParams: {} } } },
        { provide: UserService, useValue: userServiceMock },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn() } },
      ],
    });
    // Empty template: exercise menuItemsMap without the full panel/dialog child graph.
    TestBed.overrideComponent(ProfileIdentitiesComponent, { set: { template: '', imports: [] } });

    const fixture = TestBed.createComponent(ProfileIdentitiesComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  it('disables Remove for an exact-match meeting-invite email', async () => {
    const identity = makeIdentity({ id: 'id-1', type: 'email', value: 'primary@example.com' });
    const fixture = await setup([identity], { email: 'primary@example.com' });

    expect(fixture.componentInstance.menuItemsMap().get('id-1')?.[0]).toEqual(expect.objectContaining({ disabled: true }));
  });

  it('disables Remove for a case-insensitive meeting-invite email match', async () => {
    const identity = makeIdentity({ id: 'id-1', type: 'email', value: 'Primary@Example.com' });
    const fixture = await setup([identity], { email: 'primary@example.com' });

    expect(fixture.componentInstance.menuItemsMap().get('id-1')?.[0]).toEqual(expect.objectContaining({ disabled: true }));
  });

  it('leaves Remove enabled for a non-email identity sharing the invite-email identifier', async () => {
    // Same `value` as the invite email, but `type: 'username'` — e.g. the server rewrote this
    // row's `platform` to 'github' while it stayed a username, not an email, identity.
    const identity = makeIdentity({ id: 'id-1', type: 'username', platform: 'github', value: 'primary@example.com' });
    const fixture = await setup([identity], { email: 'primary@example.com' });

    const item = fixture.componentInstance.menuItemsMap().get('id-1')?.[0];
    expect(item?.disabled).toBeFalsy();
    expect(item?.command).toBeDefined();
  });

  it('disables Remove for every email identity when the invite fetch itself failed', async () => {
    const emailA = makeIdentity({ id: 'id-1', type: 'email', value: 'a@example.com' });
    const emailB = makeIdentity({ id: 'id-2', type: 'email', value: 'b@example.com' });
    const username = makeIdentity({ id: 'id-3', type: 'username', platform: 'github', value: 'someone' });
    const fixture = await setup([emailA, emailB, username], 'error');

    const menuMap = fixture.componentInstance.menuItemsMap();
    expect(menuMap.get('id-1')?.[0]).toEqual(expect.objectContaining({ disabled: true }));
    expect(menuMap.get('id-2')?.[0]).toEqual(expect.objectContaining({ disabled: true }));
    expect(menuMap.get('id-3')?.[0]?.disabled).toBeFalsy();
  });
});
