// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfilePanelComponent } from './profile-panel.component';

/**
 * Guards the impersonation regression this component's fix targets (#2399): "Edit profile" must open
 * the drawer even while impersonating — the drawer itself renders read-only rather than the button
 * blocking it from opening at all. "Public profile settings" keeps the opposite (blocked) behavior for
 * now, tracked separately in #2400.
 */
describe('ProfilePanelComponent — impersonation (#2399)', () => {
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

  it('does not emit visibilityRequested while impersonating', () => {
    fixture.componentRef.setInput('impersonating', true);
    const visibilityRequested = vi.fn();
    comp.visibilityRequested.subscribe(visibilityRequested);

    comp.onVisibility();

    expect(visibilityRequested).not.toHaveBeenCalled();
  });

  it('emits visibilityRequested when not impersonating', () => {
    fixture.componentRef.setInput('impersonating', false);
    const visibilityRequested = vi.fn();
    comp.visibilityRequested.subscribe(visibilityRequested);

    comp.onVisibility();

    expect(visibilityRequested).toHaveBeenCalledTimes(1);
  });
});
