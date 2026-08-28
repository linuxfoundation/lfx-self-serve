// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { EMPTY, of } from 'rxjs';
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

  it('toasts the specific message for no_code', async () => {
    const { add } = await setup({ error: 'no_code' });
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: 'Authorization did not complete. Please try again.' }));
  });

  it('falls back to the generic message for an unmapped code', async () => {
    const { add } = await setup({ error: 'zzz_unknown' });
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: 'An error occurred. Please try again.' }));
  });
});
