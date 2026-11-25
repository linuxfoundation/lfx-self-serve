// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ACCOUNT_IDENTITIES_PATH, ACCOUNT_PERSONAL_INFORMATION_PATH, ACCOUNT_WORK_HISTORY_PATH, PROFILE_ASIDE_COPY } from '@lfx-one/shared/constants';
import { ProfileVisibility } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { Observable, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ProfileVisibilityDrawerService } from '../../components/profile-visibility-drawer/profile-visibility-drawer.service';
import { ProfileAsideComponent } from './profile-aside.component';

@Component({
  selector: 'lfx-test-profile-aside-host',
  imports: [ProfileAsideComponent],
  template: '<lfx-profile-aside [username]="username()" />',
})
class HostComponent {
  public readonly username = signal('ada');
}

describe('ProfileAsideComponent', () => {
  async function render(...reads: (() => Observable<ProfileVisibility>)[]) {
    const getProfileVisibility = vi.fn();
    for (const read of reads) getProfileVisibility.mockImplementationOnce(read);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        ProfileVisibilityDrawerService,
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: UserService, useValue: { getProfileVisibility } },
      ],
    });
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      getProfileVisibility,
      drawer: TestBed.inject(ProfileVisibilityDrawerService),
      query: (testId: string) => host.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null,
    };
  }

  const visibility = (isPublic: boolean) => () => of({ isPublic, sections: {} } as ProfileVisibility);

  it('asks a private profile to go public, opening Open Profile settings', async () => {
    const { query, drawer } = await render(visibility(false));

    expect(query('profile-openprofile-card')?.textContent).toContain(PROFILE_ASIDE_COPY.privateTitle);
    expect(query('profile-openprofile-status')?.getAttribute('title')).toBe(PROFILE_ASIDE_COPY.privateStatus);
    expect(query('profile-openprofile-link')?.textContent?.replace(/\s+/g, '')).toBe(`${window.location.host}/u/ada`);

    query('profile-openprofile-make-public')?.querySelector('button')?.click();
    expect(drawer.context()).toBe('ada');
  });

  it('links a public profile, with the settings one click away', async () => {
    const { query, drawer } = await render(visibility(true));

    expect(query('profile-openprofile-card')?.textContent).toContain(PROFILE_ASIDE_COPY.publicTitle);
    expect(query('profile-openprofile-status')?.getAttribute('title')).toBe(PROFILE_ASIDE_COPY.publicStatus);
    const view = query('profile-openprofile-view')?.querySelector('a');
    expect(view?.getAttribute('href')).toBe('/u/ada');
    expect(view?.getAttribute('target')).toBe('_blank');

    query('profile-openprofile-settings')?.querySelector('button')?.click();
    expect(drawer.isOpen()).toBe(true);
  });

  it('reads the state again once the settings drawer closes', async () => {
    const { fixture, query, drawer, getProfileVisibility } = await render(visibility(false), visibility(true));

    drawer.open('ada');
    await fixture.whenStable();
    drawer.close();
    await fixture.whenStable();

    expect(getProfileVisibility).toHaveBeenCalledTimes(2);
    expect(query('profile-openprofile-card')?.textContent).toContain(PROFILE_ASIDE_COPY.publicTitle);
  });

  it('shows the private state when the state could not be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { query } = await render(() => throwError(() => new Error('boom')));

    expect(query('profile-openprofile-make-public')).not.toBeNull();
    warn.mockRestore();
  });

  it('links to the Account & Settings pages that edit the profile', async () => {
    const { query } = await render(visibility(false));
    const href = (testId: string) => query(testId)?.querySelector('a')?.getAttribute('href');

    expect(href('profile-aside-edit')).toBe(ACCOUNT_PERSONAL_INFORMATION_PATH);
    expect(href('profile-aside-identities')).toBe(ACCOUNT_IDENTITIES_PATH);
    expect(href('profile-aside-affiliations')).toBe(ACCOUNT_WORK_HISTORY_PATH);
  });
});
