// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfilePanelComponent } from './profile-panel.component';

/**
 * Guards the impersonation regression these fixes target (#2399, #2400): both "Edit profile" and
 * "Public profile settings" must open their drawers even while impersonating — the drawers themselves
 * render read-only rather than the buttons blocking them from opening at all.
 */
describe('ProfilePanelComponent — impersonation (#2399, #2400)', () => {
  let fixture: ComponentFixture<ProfilePanelComponent>;
  let comp: ProfilePanelComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ProfilePanelComponent] });
    fixture = TestBed.createComponent(ProfilePanelComponent);
    comp = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('emits editRequested while impersonating', () => {
    fixture.componentRef.setInput('impersonating', true);
    const editRequested = vi.fn();
    comp.editRequested.subscribe(editRequested);

    comp.onEdit();

    expect(editRequested).toHaveBeenCalledTimes(1);
  });

  it('emits visibilityRequested while impersonating', () => {
    fixture.componentRef.setInput('impersonating', true);
    const visibilityRequested = vi.fn();
    comp.visibilityRequested.subscribe(visibilityRequested);

    comp.onVisibility();

    expect(visibilityRequested).toHaveBeenCalledTimes(1);
  });

  it('emits visibilityRequested when not impersonating', () => {
    fixture.componentRef.setInput('impersonating', false);
    const visibilityRequested = vi.fn();
    comp.visibilityRequested.subscribe(visibilityRequested);

    comp.onVisibility();

    expect(visibilityRequested).toHaveBeenCalledTimes(1);
  });
});
