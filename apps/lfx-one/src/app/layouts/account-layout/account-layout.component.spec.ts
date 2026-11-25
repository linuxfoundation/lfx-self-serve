// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, Event as RouterEvent, NavigationEnd, provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { PENDING_PROFILE_SAVE_KEY, PROFILE_AUTH_ERROR_MESSAGES } from '@lfx-one/shared/constants';
import { AccountProfileService } from '@services/account-profile.service';
import { AccountUnsavedChangesService } from '@services/account-unsaved-changes.service';
import { NavbarCollapseService } from '@services/navbar-collapse.service';
import { ProfileSaveSyncService } from '@services/profile-save-sync.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountLayoutComponent } from './account-layout.component';

describe('AccountLayoutComponent', () => {
  let fixture: ComponentFixture<AccountLayoutComponent>;
  let impersonating: ReturnType<typeof signal<boolean>>;
  let add: ReturnType<typeof vi.fn>;
  let queryParams: Record<string, string>;
  let updateUserProfile: ReturnType<typeof vi.fn>;
  let childConfig: { path: string };
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
        { provide: ActivatedRoute, useValue: { queryParams: of(queryParams), firstChild: { snapshot: { routeConfig: childConfig } } } },
        { provide: UserService, useValue: { impersonating, user: signal(null), updateUserProfile } },
        { provide: ProfileSaveSyncService, useValue: { apply: vi.fn() } },
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
    updateUserProfile = vi.fn(() => of({}));
    childConfig = { path: 'identities' };
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

  it('moves the nav down when the header grows, such as a description wrapping beside the save bar', async () => {
    let resized: () => void = () => undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        public constructor(callback: () => void) {
          resized = callback;
        }
        public observe(): void {}
        public disconnect(): void {}
      }
    );
    await setup();
    const header = query('account-layout-header')!;
    const navTop = () => (query('account-layout-nav')?.firstElementChild as HTMLElement).style.top;

    Object.defineProperty(header, 'offsetHeight', { value: 140, configurable: true });
    resized();
    fixture.detectChanges();

    expect(navTop()).toBe('160px');
    vi.unstubAllGlobals();
  });

  it('moves focus to the heading when Save or Revert clears the changes and the bar goes', async () => {
    await setup();
    document.body.appendChild(fixture.nativeElement);
    unsaved.dirty.set(true);
    fixture.detectChanges();

    (query('account-layout-revert')?.querySelector('button') as HTMLButtonElement).focus();
    unsaved.dirty.set(false);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.activeElement).toBe(query('account-layout-title'));
    fixture.nativeElement.remove();
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

  it('drops the left nav and the header rule on the landing page', async () => {
    childConfig.path = '';
    await setup();

    expect(query('account-layout-nav')).toBeNull();
    expect(query('account-layout-header-rule')?.classList.contains('hidden')).toBe(true);
  });

  it('adds the nav when a page opens from the landing page, keeping the one content outlet', async () => {
    childConfig.path = '';
    await setup();
    const content = query('account-layout-content');

    childConfig.path = 'transactions';
    (TestBed.inject(Router).events as Subject<RouterEvent>).next(new NavigationEnd(2, '/account/transactions', '/account/transactions'));
    fixture.detectChanges();

    expect(query('account-layout-nav')).not.toBeNull();
    expect(query('account-layout-content')).toBe(content);
  });

  it('keeps the left nav and the header rule on a page', async () => {
    await setup();

    expect(query('account-layout-nav')).not.toBeNull();
    expect(query('account-layout-header-rule')?.classList.contains('hidden')).toBe(false);
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

  it('replays a profile save stashed before Flow C into the profile the pages read', async () => {
    queryParams = { success: 'profile_token_obtained' };
    sessionStorage.setItem(PENDING_PROFILE_SAVE_KEY, JSON.stringify({ savedAt: Date.now(), userMetadata: { job_title: 'Maintainer' } }));
    const applySaved = vi.spyOn(AccountProfileService.prototype, 'applySaved');
    await setup();

    expect(updateUserProfile).toHaveBeenCalledWith({ user_metadata: { job_title: 'Maintainer' } });
    expect(applySaved).toHaveBeenCalledWith({ job_title: 'Maintainer' });
    applySaved.mockRestore();
  });

  it('handles a Flow C error return, as the hub did', async () => {
    queryParams = { error: 'profile_auth_failed' };
    await setup();

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: PROFILE_AUTH_ERROR_MESSAGES['profile_auth_failed'] }));
  });
});

describe('AccountLayoutComponent — with the real router', () => {
  @Component({ selector: 'lfx-test-page', template: '' })
  class TestPageComponent {}

  it('builds on the way in from another page, then reads the landing state once the child has activated', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'profile', component: TestPageComponent },
          {
            path: 'account',
            component: AccountLayoutComponent,
            children: [
              { path: '', component: TestPageComponent },
              { path: 'identities', component: TestPageComponent },
            ],
          },
        ]),
        provideNoopAnimations(),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: UserService, useValue: { impersonating: signal(false), user: signal(null) } },
        { provide: ProfileSaveSyncService, useValue: { apply: vi.fn() } },
        { provide: NavbarCollapseService, useValue: { railAtAnyWidth: signal(true) } },
        { provide: MessageService, useValue: { add: vi.fn(), messageObserver: of(), clearObserver: of() } },
        { provide: AccountUnsavedChangesService, useValue: { dirty: signal(false), saving: signal(false), save: vi.fn(), revert: vi.fn() } },
      ],
    });
    const harness = await RouterTestingHarness.create('/profile');

    await harness.navigateByUrl('/account');
    expect(harness.routeNativeElement?.ownerDocument.querySelector('[data-testid="account-layout-nav"]')).toBeNull();

    await harness.navigateByUrl('/account/identities');
    expect(harness.routeNativeElement?.ownerDocument.querySelector('[data-testid="account-layout-nav"]')).not.toBeNull();
  });
});
