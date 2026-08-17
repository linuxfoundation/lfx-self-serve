// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PROFILE_VISIBILITY_DEFAULTS, PROFILE_VISIBILITY_KEYS } from '@lfx-one/shared/constants';
import { ProfileVisibility, ProfileVisibilitySections, ProfileVisibilityUpdateRequest } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';

import { ProfileVisibilityDrawerComponent } from './profile-visibility-drawer.component';
import { ProfileVisibilityDrawerService } from './profile-visibility-drawer.service';

/**
 * Guards the cascade / auto-save state machine of the public-profile visibility drawer (LFXV2-2629):
 * the parent↔child cascade, seedForm's enable/patch alignment, and buildPayload's raw serialization.
 * Template is overridden empty so the class logic runs without the drawer/toggle/select children.
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

  let fixture: ComponentFixture<ProfileVisibilityDrawerComponent>;
  let comp: ProfileVisibilityDrawerComponent;
  let updateProfileVisibility: Mock;
  let messageAdd: Mock;

  async function setup(visibility: ProfileVisibility | null, opts?: { loadError?: boolean }): Promise<void> {
    const getProfileVisibility = vi.fn(() => (opts?.loadError ? throwError(() => new Error('boom')) : of(visibility)));
    updateProfileVisibility = vi.fn((data: ProfileVisibilityUpdateRequest) => of({ ...data, preferenceId: 'p1' } as ProfileVisibility));
    messageAdd = vi.fn();
    const drawer = new ProfileVisibilityDrawerService();

    TestBed.configureTestingModule({
      imports: [ProfileVisibilityDrawerComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: UserService, useValue: { getProfileVisibility, updateProfileVisibility } },
        { provide: MessageService, useValue: { add: messageAdd } },
        { provide: ProfileVisibilityDrawerService, useValue: drawer },
      ],
    });
    // Empty template: exercise the class without rendering the toggle/select/drawer children.
    TestBed.overrideComponent(ProfileVisibilityDrawerComponent, { set: { template: '', imports: [] } });

    fixture = TestBed.createComponent(ProfileVisibilityDrawerComponent);
    comp = fixture.componentInstance;
    // Opening the drawer emits the username context, which drives the initial load + seedForm.
    drawer.open('ada');
    fixture.detectChanges();
    await fixture.whenStable();
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
