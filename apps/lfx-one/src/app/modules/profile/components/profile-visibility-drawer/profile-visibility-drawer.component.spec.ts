// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PROFILE_VISIBILITY_DEFAULTS, PROFILE_VISIBILITY_KEYS } from '@lfx-one/shared/constants';
import { ProfileVisibility, ProfileVisibilitySections, ProfileVisibilityUpdateRequest } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';

import { ProfileVisibilityDrawerComponent } from './profile-visibility-drawer.component';
import { ProfileVisibilityDrawerService } from './profile-visibility-drawer.service';

interface Harness {
  fixture: ComponentFixture<ProfileVisibilityDrawerComponent>;
  comp: ProfileVisibilityDrawerComponent;
  updateProfileVisibility: Mock;
  messageAdd: Mock;
  impersonating: WritableSignal<boolean>;
  drawer: ProfileVisibilityDrawerService;
}

/**
 * Shared harness for both describe blocks below: wires the mocked `UserService`/`MessageService`,
 * overrides the template empty (exercises the class without the drawer/toggle/select children), and
 * opens the drawer so the initial load + seedForm run. `impersonating` must always be provided to the
 * `UserService` mock — the component reads it unconditionally at field init.
 */
async function createHarness(
  visibility: ProfileVisibility | null,
  opts?: { loadError?: boolean; loadErrorResponse?: unknown; impersonating?: boolean }
): Promise<Harness> {
  const getProfileVisibility = vi.fn(() => (opts?.loadError ? throwError(() => opts.loadErrorResponse ?? new Error('boom')) : of(visibility)));
  const updateProfileVisibility = vi.fn((data: ProfileVisibilityUpdateRequest) => of({ ...data, preferenceId: 'p1' } as ProfileVisibility));
  const messageAdd = vi.fn();
  const impersonating = signal(opts?.impersonating ?? false);
  const drawer = new ProfileVisibilityDrawerService();

  TestBed.configureTestingModule({
    imports: [ProfileVisibilityDrawerComponent],
    providers: [
      { provide: PLATFORM_ID, useValue: 'browser' },
      { provide: UserService, useValue: { getProfileVisibility, updateProfileVisibility, impersonating } },
      { provide: MessageService, useValue: { add: messageAdd } },
      { provide: ProfileVisibilityDrawerService, useValue: drawer },
    ],
  });
  TestBed.overrideComponent(ProfileVisibilityDrawerComponent, { set: { template: '', imports: [] } });

  const fixture = TestBed.createComponent(ProfileVisibilityDrawerComponent);
  const comp = fixture.componentInstance;
  // Opening the drawer emits the username context, which drives the initial load + seedForm.
  drawer.open('ada');
  fixture.detectChanges();
  await fixture.whenStable();

  return { fixture, comp, updateProfileVisibility, messageAdd, impersonating, drawer };
}

/**
 * Guards the cascade / auto-save state machine of the public-profile visibility drawer (LFXV2-2629):
 * the parent↔child cascade, seedForm's enable/patch alignment, and buildPayload's raw serialization.
 */
describe('ProfileVisibilityDrawerComponent — cascade / auto-save state machine (LFXV2-2629)', () => {
  const sections = (overrides: Partial<ProfileVisibilitySections> = {}): ProfileVisibilitySections =>
    ({ ...PROFILE_VISIBILITY_DEFAULTS, ...overrides }) as ProfileVisibilitySections;

  const PUBLIC_VIS: ProfileVisibility = {
    isPublic: true,
    sections: sections({ basic: true, aboutMe: true, personalInfo: true, badges: true }),
    preferenceId: 'p1',
  };
  const PRIVATE_VIS: ProfileVisibility = { isPublic: false, sections: sections(), preferenceId: null };

  let comp: ProfileVisibilityDrawerComponent;
  let updateProfileVisibility: Mock;
  let messageAdd: Mock;

  async function setup(visibility: ProfileVisibility | null, opts?: { loadError?: boolean }): Promise<void> {
    ({ comp, updateProfileVisibility, messageAdd } = await createHarness(visibility, opts));
  }

  const value = (key: string): boolean => comp.visibilityForm.get(key)!.value;

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  describe('wireCascade', () => {
    it('going public enables sections and defaults the basic group on', async () => {
      await setup(PRIVATE_VIS);

      comp.visibilityForm.get('isPublic')!.setValue(true);

      expect(comp.isPublic()).toBe(true);
      for (const key of ['basic', 'aboutMe', 'personalInfo']) {
        expect(value(key)).toBe(true);
      }
      // A non-default key stays off, but every section control becomes enabled.
      expect(value('badges')).toBe(false);
      expect(comp.visibilityForm.get('badges')!.enabled).toBe(true);
    });

    it('going private zeroes every section and disables the controls', async () => {
      await setup(PUBLIC_VIS);

      comp.visibilityForm.get('isPublic')!.setValue(false);

      expect(comp.isPublic()).toBe(false);
      for (const key of PROFILE_VISIBILITY_KEYS) {
        expect(value(key)).toBe(false);
        expect(comp.visibilityForm.get(key)!.disabled).toBe(true);
      }
    });

    it('mirrors the basic parent down to its children', async () => {
      await setup(PUBLIC_VIS);

      comp.visibilityForm.get('basic')!.setValue(false);
      expect(value('aboutMe')).toBe(false);
      expect(value('personalInfo')).toBe(false);

      comp.visibilityForm.get('basic')!.setValue(true);
      expect(value('aboutMe')).toBe(true);
      expect(value('personalInfo')).toBe(true);
    });

    it('ORs the basic parent back on from its children', async () => {
      await setup(PUBLIC_VIS);

      // One child still on → parent stays on.
      comp.visibilityForm.get('aboutMe')!.setValue(false);
      expect(value('basic')).toBe(true);

      // Both children off → parent turns off.
      comp.visibilityForm.get('personalInfo')!.setValue(false);
      expect(value('basic')).toBe(false);

      // A child back on → parent turns back on.
      comp.visibilityForm.get('aboutMe')!.setValue(true);
      expect(value('basic')).toBe(true);
    });
  });

  describe('seedForm', () => {
    it('applies the fetched public state and enables the sections', async () => {
      await setup(PUBLIC_VIS);

      expect(comp.isPublic()).toBe(true);
      expect(value('isPublic')).toBe(true);
      expect(value('badges')).toBe(true);
      expect(value('technical_contribution')).toBe(false);
      expect(comp.visibilityForm.get('badges')!.enabled).toBe(true);
    });

    it('applies all-private defaults and disables the sections', async () => {
      await setup(PRIVATE_VIS);

      expect(comp.isPublic()).toBe(false);
      for (const key of PROFILE_VISIBILITY_KEYS) {
        expect(value(key)).toBe(false);
        expect(comp.visibilityForm.get(key)!.disabled).toBe(true);
      }
    });

    it('gates the form off and surfaces a toast on load failure', async () => {
      await setup(null, { loadError: true });

      expect(comp.loadError()).toBe(true);
      expect(comp.loadingVisibility()).toBe(false);
      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
    });
  });

  describe('buildPayload', () => {
    it('serializes disabled controls via getRawValue and carries every section key', async () => {
      await setup(PRIVATE_VIS);
      // A disabled-but-true control must still appear in the payload (getRawValue, not value).
      comp.visibilityForm.get('badges')!.setValue(true, { emitEvent: false });
      comp.visibilityForm.get('badges')!.disable({ emitEvent: false });

      const payload = (comp as unknown as { buildPayload(): ProfileVisibilityUpdateRequest }).buildPayload();

      expect(payload.sections.badges).toBe(true);
      expect(Object.keys(payload.sections).sort()).toEqual([...PROFILE_VISIBILITY_KEYS].sort());
    });

    it('persists the resolved cascade payload on a close-time flush', async () => {
      await setup(PRIVATE_VIS);

      // A real change marks the form dirty; onVisibleChange(false) flushes past the debounce.
      comp.visibilityForm.get('isPublic')!.setValue(true);
      comp.onVisibleChange(false);

      expect(updateProfileVisibility).toHaveBeenCalledTimes(1);
      expect(updateProfileVisibility.mock.calls[0][0]).toEqual({
        isPublic: true,
        sections: sections({ basic: true, aboutMe: true, personalInfo: true }),
      });
    });
  });
});

/**
 * Guards the impersonation read-only behavior of the visibility drawer (#2400): the form must stay
 * genuinely disabled — including sections re-synced independently of the impersonation subscription
 * by seedForm/wireCascade (the same class of gap #2399 found in the organization control) — and
 * auto-save must not fire while impersonating.
 */
describe('ProfileVisibilityDrawerComponent — impersonation read-only (#2400)', () => {
  const sections = (overrides: Partial<ProfileVisibilitySections> = {}): ProfileVisibilitySections =>
    ({ ...PROFILE_VISIBILITY_DEFAULTS, ...overrides }) as ProfileVisibilitySections;

  const PUBLIC_VIS: ProfileVisibility = {
    isPublic: true,
    sections: sections({ basic: true, aboutMe: true, personalInfo: true, badges: true }),
    preferenceId: 'p1',
  };

  let fixture: ComponentFixture<ProfileVisibilityDrawerComponent>;
  let comp: ProfileVisibilityDrawerComponent;
  let updateProfileVisibility: Mock;
  let messageAdd: Mock;
  let impersonating: WritableSignal<boolean>;
  let drawer: ProfileVisibilityDrawerService;

  async function setup(
    visibility: ProfileVisibility | null,
    opts?: { impersonating?: boolean; loadError?: boolean; loadErrorResponse?: unknown }
  ): Promise<void> {
    ({ fixture, comp, updateProfileVisibility, messageAdd, impersonating, drawer } = await createHarness(visibility, opts));
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('seeds the form from the fetched (target-scoped) visibility payload while impersonating', async () => {
    // The backend resolves this payload to the impersonation target's data (see UserService's
    // getProfileVisibility token-override); this only guards that the frontend renders whatever it
    // receives, distinct from the PUBLIC_VIS fixture used elsewhere in this file.
    const targetVis: ProfileVisibility = { isPublic: true, sections: sections({ basic: true, badges: true }), preferenceId: 'target-pref' };
    await setup(targetVis, { impersonating: true });

    expect(comp.visibilityForm.get('isPublic')!.value).toBe(true);
    expect(comp.visibilityForm.get('badges')!.value).toBe(true);
    expect(comp.visibilityForm.get('aboutMe')!.value).toBe(false);
  });

  it('surfaces the impersonation-specific message on a 403 IMPERSONATION_READ_ONLY load failure', async () => {
    await setup(null, { loadError: true, loadErrorResponse: { status: 403, error: { code: 'IMPERSONATION_READ_ONLY' } } });

    expect(comp.loadError()).toBe(true);
    expect(messageAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', detail: 'Visibility changes are unavailable while impersonating another user.' })
    );
  });

  it('disables the whole form — including sections once loaded — while impersonating', async () => {
    await setup(PUBLIC_VIS, { impersonating: true });

    expect(comp.visibilityForm.disabled).toBe(true);
    expect(comp.visibilityForm.get('badges')!.disabled).toBe(true);
  });

  it('keeps sections disabled on a reopen while impersonation is already active', async () => {
    await setup(PUBLIC_VIS, { impersonating: true });

    // Regression guard: reopening doesn't re-emit the impersonation signal, so only setSectionsEnabled's
    // own re-check (run from seedForm on every load) can catch this — not the constructor subscription.
    drawer.close();
    drawer.open('ada');
    await fixture.whenStable();

    expect(comp.visibilityForm.get('badges')!.disabled).toBe(true);
  });

  it('re-enables the form and re-syncs sections once impersonation stops', async () => {
    await setup(PUBLIC_VIS, { impersonating: true });

    impersonating.set(false);
    await fixture.whenStable();

    expect(comp.visibilityForm.get('isPublic')!.disabled).toBe(false);
    expect(comp.visibilityForm.get('badges')!.disabled).toBe(false);
  });

  it('does not persist a change made while impersonating', async () => {
    await setup(PUBLIC_VIS, { impersonating: true });

    // Backstop: even a programmatic change (bypassing the disabled form) must not autosave.
    comp.visibilityForm.get('badges')!.setValue(false);
    comp.onVisibleChange(false);

    expect(updateProfileVisibility).not.toHaveBeenCalled();
  });

  it('toasts the impersonation-specific message on a 403 IMPERSONATION_READ_ONLY save response', async () => {
    await setup(PUBLIC_VIS, { impersonating: false });
    updateProfileVisibility.mockReturnValue(throwError(() => ({ status: 403, error: { code: 'IMPERSONATION_READ_ONLY' } })));

    comp.visibilityForm.get('badges')!.setValue(false);
    comp.onVisibleChange(false);
    await fixture.whenStable();

    expect(messageAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', detail: 'Visibility changes are unavailable while impersonating another user.' })
    );
  });

  it('does not re-arm the dirty flag on a terminal 403 read-only rejection', async () => {
    await setup(PUBLIC_VIS, { impersonating: false });
    updateProfileVisibility.mockReturnValue(throwError(() => ({ status: 403, error: { code: 'IMPERSONATION_READ_ONLY' } })));

    comp.visibilityForm.get('badges')!.setValue(false);
    comp.onVisibleChange(false);
    await fixture.whenStable();
    messageAdd.mockClear();

    // Unlike a transient failure, a read-only rejection can't succeed on retry: a later close
    // shouldn't re-flush the same doomed save (which would re-toast) and should close immediately.
    comp.onVisibleChange(false);
    await fixture.whenStable();

    expect(updateProfileVisibility).toHaveBeenCalledTimes(1);
    expect(messageAdd).not.toHaveBeenCalled();
  });

  it('honors a deferred close once an in-flight save comes back as a terminal 403 read-only rejection', async () => {
    await setup(PUBLIC_VIS, { impersonating: false });
    const inFlight$ = new Subject<never>();
    updateProfileVisibility.mockReturnValue(inFlight$);
    const closeSpy = vi.spyOn(drawer, 'close');

    comp.visibilityForm.get('badges')!.setValue(false);
    comp.onVisibleChange(false); // flush -> save goes in flight -> close is deferred, not run yet
    expect(closeSpy).not.toHaveBeenCalled();

    // A read-only rejection can't be retried into success, so the deferred close must proceed instead
    // of wedging the drawer open (the generic-error branch, by contrast, leaves it open — see above).
    inFlight$.error({ status: 403, error: { code: 'IMPERSONATION_READ_ONLY' } });

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
