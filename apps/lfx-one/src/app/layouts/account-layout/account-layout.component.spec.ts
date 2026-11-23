// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { PROFILE_AUTH_ERROR_MESSAGES } from '@lfx-one/shared/constants';
import { AccountUnsavedChangesService } from '@services/account-unsaved-changes.service';
import { NavbarCollapseService } from '@services/navbar-collapse.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountLayoutComponent } from './account-layout.component';

describe('AccountLayoutComponent', () => {
  let fixture: ComponentFixture<AccountLayoutComponent>;
  let impersonating: ReturnType<typeof signal<boolean>>;
  let add: ReturnType<typeof vi.fn>;
  let queryParams: Record<string, string>;
  let unsaved: {
    dirty: ReturnType<typeof signal<boolean>>;
    saving: ReturnType<typeof signal<boolean>>;
    save: ReturnType<typeof vi.fn>;
    revert: ReturnType<typeof vi.fn>;
  };

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  async function setup(): Promise<void> {
    TestBed.configureTestingModule({
      imports: [AccountLayoutComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ActivatedRoute, useValue: { queryParams: of(queryParams) } },
        { provide: UserService, useValue: { impersonating, user: signal(null) } },
        { provide: NavbarCollapseService, useValue: { railAtAnyWidth: signal(true) } },
        { provide: MessageService, useValue: { add, messageObserver: of(), clearObserver: of() } },
        { provide: AccountUnsavedChangesService, useValue: unsaved },
      ],
    });
    fixture = TestBed.createComponent(AccountLayoutComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  afterEach(() => {
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  });

  beforeEach(() => {
    TestBed.resetTestingModule();
    impersonating = signal(false);
    add = vi.fn();
    queryParams = {};
    unsaved = { dirty: signal(false), saving: signal(false), save: vi.fn(), revert: vi.fn() };
  });

  it('shows the save bar only while the page has unsaved changes', async () => {
    await setup();
    expect(query('account-layout-save-bar')).toBeNull();

    unsaved.dirty.set(true);
    fixture.detectChanges();

    expect(query('account-layout-save-bar')).not.toBeNull();
    (query('account-layout-save')?.querySelector('button') as HTMLButtonElement).click();
    expect(unsaved.save).toHaveBeenCalled();
    (query('account-layout-revert')?.querySelector('button') as HTMLButtonElement).click();
    expect(unsaved.revert).toHaveBeenCalled();
  });

  it('hides the save bar while impersonating, when editing is disabled', async () => {
    impersonating.set(true);
    unsaved.dirty.set(true);
    await setup();

    expect(query('account-layout-save-bar')).toBeNull();
  });

  it('holds Revert while a save is running', async () => {
    await setup();
    unsaved.dirty.set(true);
    unsaved.saving.set(true);
    fixture.detectChanges();

    expect((query('account-layout-revert')?.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the Account & Settings title and description', async () => {
    await setup();

    expect(query('account-layout-title')?.textContent?.trim()).toBe('Account & Settings');
    expect(query('account-layout-description')?.textContent?.trim()).toBe('Manage your work history, linked identities, agreements, billing and sign-in.');
  });

  it('lists the ten pages under Account and Settings', async () => {
    await setup();

    expect(query('account-layout-nav-group-account')?.textContent?.trim()).toBe('Account');
    expect(query('account-layout-nav-group-settings')?.textContent?.trim()).toBe('Settings');
    const links = Array.from(fixture.nativeElement.querySelectorAll('[data-testid^="account-layout-nav-"][href]')) as HTMLAnchorElement[];
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      'Personal information',
      'Work history & Affiliations',
      'Identities',
      'Linux.com email',
      'Individual Enrollment',
      'CLAs',
      'Transactions',
      'Email settings',
      'Password',
      'Developer settings',
    ]);
  });

  it('shows the read-only notice only while impersonating', async () => {
    impersonating.set(true);
    await setup();

    expect(query('account-layout-readonly-notice')).not.toBeNull();
  });

  it('hides the header fade until the page scrolls', async () => {
    await setup();
    const fade = query('account-layout-header-fade')!;
    expect(fade.classList.contains('opacity-0')).toBe(true);

    Object.defineProperty(window, 'scrollY', { value: 120, configurable: true });
    window.dispatchEvent(new Event('scroll'));
    fixture.detectChanges();

    expect(fade.classList.contains('opacity-0')).toBe(false);
  });

  it('handles a Flow C error return, as the hub did', async () => {
    queryParams = { error: 'profile_auth_failed' };
    await setup();

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: PROFILE_AUTH_ERROR_MESSAGES['profile_auth_failed'] }));
  });
});
