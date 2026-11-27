// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { PROFILE_SETTINGS_DRAWER_COPY, PROFILE_VISIBILITY_DEFAULTS, PROFILE_VISIBILITY_SECTIONS } from '@lfx-one/shared/constants';
import { ProfileVisibility } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProfileVisibilityDrawerService } from '../profile-visibility-drawer/profile-visibility-drawer.service';
import { ProfileSettingsDrawerComponent } from './profile-settings-drawer.component';

@Component({
  selector: 'lfx-test-settings-drawer-host',
  imports: [ProfileSettingsDrawerComponent],
  providers: [ProfileVisibilityDrawerService],
  template: '<lfx-profile-settings-drawer />',
})
class HostComponent {
  public readonly drawer = inject(ProfileVisibilityDrawerService);
}

const visibility = (isPublic: boolean, shown: Partial<ProfileVisibility['sections']> = {}): ProfileVisibility => ({
  isPublic,
  sections: { ...PROFILE_VISIBILITY_DEFAULTS, ...shown },
  preferenceId: 'pref-1',
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ProfileSettingsDrawerComponent', () => {
  afterEach(() => document.querySelectorAll('.cdk-overlay-container').forEach((container) => (container.innerHTML = '')));

  async function render(
    read: () => Observable<ProfileVisibility>,
    update = vi.fn((body: { isPublic: boolean }): Observable<ProfileVisibility> => of(visibility(body.isPublic))),
    impersonating = false
  ) {
    const getProfileVisibility = vi.fn(read);
    const add = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: UserService, useValue: { impersonating: signal(impersonating), getProfileVisibility, updateProfileVisibility: update } },
        { provide: MessageService, useValue: { add } },
      ],
    });
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const drawer = fixture.componentInstance.drawer;
    const query = <T extends HTMLElement = HTMLElement>(testId: string) => document.querySelector<T>(`[data-testid="${testId}"]`);
    const open = async () => {
      drawer.open('ada');
      fixture.detectChanges();
      await fixture.whenStable();
      await settle();
      fixture.detectChanges();
    };
    const button = (testId: string) => query(testId)?.querySelector('button') as HTMLButtonElement;
    const toggle = (key: string) => query(`profile-settings-drawer-row-${key}`)?.querySelector('input') as HTMLInputElement;
    const flush = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      await settle();
      fixture.detectChanges();
    };
    return { fixture, drawer, getProfileVisibility, update, add, query, open, button, toggle, flush };
  }

  it('reads the stored settings on open, with every section the hub drawer has, and Save off until something changes', async () => {
    const { getProfileVisibility, query, open, button, toggle } = await render(() => of(visibility(true, { badges: true })));
    await open();

    expect(getProfileVisibility).toHaveBeenCalledTimes(1);
    expect(query('profile-settings-drawer')?.textContent).toContain(PROFILE_SETTINGS_DRAWER_COPY.title);
    expect(toggle('badges').checked).toBe(true);
    expect(toggle('technical_contribution').checked).toBe(false);
    for (const section of PROFILE_VISIBILITY_SECTIONS.filter((row) => row.key !== 'basic' && !row.parent)) {
      expect(query(`profile-settings-drawer-row-${section.key}`)?.textContent).toContain(section.name);
    }
    expect(button('profile-settings-drawer-save').disabled).toBe(true);
  });

  it('saves a changed block with "Save changes", says so and closes', async () => {
    const { drawer, update, add, query, open, button, toggle, flush } = await render(() => of(visibility(true, { basic: true, badges: true })));
    await open();

    toggle('technical_contribution').click();
    await flush();
    button('profile-settings-drawer-save').click();
    await flush();

    expect(update).toHaveBeenCalledWith({
      isPublic: true,
      sections: { ...PROFILE_VISIBILITY_DEFAULTS, basic: true, badges: true, technical_contribution: true },
    });
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', detail: PROFILE_SETTINGS_DRAWER_COPY.saved }));
    expect(drawer.isOpen()).toBe(false);
    expect(query('profile-settings-drawer')).toBeNull();
  });

  it('locks the blocks while private, and going public turns on the general information as today', async () => {
    const { update, add, query, open, button, toggle, flush } = await render(() => of(visibility(false)));
    await open();

    expect(toggle('badges').disabled).toBe(true);
    expect(query('profile-settings-drawer-tabs')?.classList).toContain('opacity-50');

    (query('profile-settings-drawer-public')?.querySelector('input') as HTMLInputElement).click();
    await flush();

    expect(toggle('badges').disabled).toBe(false);
    expect(query('profile-settings-drawer-tabs')?.classList).not.toContain('opacity-50');
    button('profile-settings-drawer-save').click();
    await flush();

    expect(update).toHaveBeenCalledWith({ isPublic: true, sections: { ...PROFILE_VISIBILITY_DEFAULTS, basic: true, aboutMe: true, personalInfo: true } });
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ detail: PROFILE_SETTINGS_DRAWER_COPY.nowPublic }));
  });

  it('discards the changes on Cancel and reads them again on the next open', async () => {
    const { drawer, update, getProfileVisibility, open, button, toggle, flush } = await render(() => of(visibility(true, { badges: true })));
    await open();

    toggle('badges').click();
    await flush();
    button('profile-settings-drawer-cancel').click();
    await flush();

    expect(update).not.toHaveBeenCalled();
    expect(drawer.isOpen()).toBe(false);

    await open();

    expect(getProfileVisibility).toHaveBeenCalledTimes(2);
    expect(toggle('badges').checked).toBe(true);
  });

  it('says the settings could not load, and tries again', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let fail = true;
    const { query, open, button, toggle, flush } = await render(() => (fail ? throwError(() => new Error('boom')) : of(visibility(true))));
    await open();

    expect(query('profile-settings-drawer-error')?.textContent).toContain(PROFILE_SETTINGS_DRAWER_COPY.loadFailed);

    fail = false;
    button('profile-settings-drawer-retry').click();
    await flush();

    expect(query('profile-settings-drawer-error')).toBeNull();
    expect(toggle('badges')).not.toBeNull();
  });

  it('switches About me and Personal information with General profile information, as the hub drawer does', async () => {
    const { query, open, toggle, flush } = await render(() => of(visibility(true, { basic: true, aboutMe: true, personalInfo: true })));
    await open();
    (query('ui-tab-personal') as HTMLButtonElement).click();
    await flush();

    toggle('basic').click();
    await flush();
    expect([toggle('aboutMe').checked, toggle('personalInfo').checked]).toEqual([false, false]);

    toggle('aboutMe').click();
    await flush();
    expect(toggle('basic').checked).toBe(true);
  });

  it('hides every section on going private, and says so once saved', async () => {
    const { update, add, query, open, button, flush } = await render(() => of(visibility(true, { basic: true, badges: true })));
    await open();

    (query('profile-settings-drawer-private')?.querySelector('input') as HTMLInputElement).click();
    await flush();
    button('profile-settings-drawer-save').click();
    await flush();

    expect(update).toHaveBeenCalledWith({ isPublic: false, sections: { ...PROFILE_VISIBILITY_DEFAULTS } });
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ detail: PROFILE_SETTINGS_DRAWER_COPY.nowPrivate }));
  });

  it('keeps the drawer open with the changes when a save fails', async () => {
    const update = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 500 })));
    const { drawer, add, open, button, toggle, flush } = await render(() => of(visibility(true)), update);
    await open();

    toggle('badges').click();
    await flush();
    button('profile-settings-drawer-save').click();
    await flush();

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: PROFILE_SETTINGS_DRAWER_COPY.saveFailed }));
    expect(drawer.isOpen()).toBe(true);
    expect(toggle('badges').checked).toBe(true);
    expect(button('profile-settings-drawer-save').disabled).toBe(false);
  });

  it('is read-only while impersonating', async () => {
    const { query, open, button, toggle } = await render(() => of(visibility(true, { badges: true })), undefined, true);
    await open();

    expect(query('profile-settings-drawer-readonly')?.textContent).toContain(PROFILE_SETTINGS_DRAWER_COPY.readOnly);
    expect((query('profile-settings-drawer-public')?.querySelector('input') as HTMLInputElement).disabled).toBe(true);
    expect(toggle('badges').disabled).toBe(true);
    expect(button('profile-settings-drawer-save').disabled).toBe(true);
  });

  it('locks the switches while a save is in flight, so a later change is not lost', async () => {
    const response = new Subject<ProfileVisibility>();
    const { query, open, button, toggle, flush } = await render(
      () => of(visibility(true)),
      vi.fn(() => response)
    );
    await open();

    toggle('badges').click();
    await flush();
    button('profile-settings-drawer-save').click();
    await flush();

    expect(toggle('skills').disabled).toBe(true);
    expect((query('profile-settings-drawer-private')?.querySelector('input') as HTMLInputElement).disabled).toBe(true);
  });
});
